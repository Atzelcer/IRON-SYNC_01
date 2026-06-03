import { defineConfig } from 'vite';
import { MEGA_SENSOR_INDEX_ORDER, routeSensorBlock } from './src/core/sensorRegistry.js';
import { parseIronSyncPacket } from './src/io/ironSyncPacket.js';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UNREAL_RELAY_PORT = 8766;
const UNREAL_UDP_HOST = '127.0.0.1';
const UNREAL_UDP_PORT = 7000;
const ARDUINO_RELAY_PORT = 8767;
const ARDUINO_UDP_LISTEN_PORT = 5005;
const ESP32_UDP_HOST = '255.255.255.255';
const ESP32_UDP_PORT = 5006;
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Re-kick RUN_START solo si el stream murió (no spam tras calibrar). */
const STREAM_KICK_MIN_MS = 20000;
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CONFIG_DIR, '../..');
const IA_IRON_SYNC_ROOT = path.join(REPO_ROOT, 'IA-IRON-SYNC');
const IMUS_VEN_ROOT = IA_IRON_SYNC_ROOT;
/** Colecciones de entrenamiento: artifacts/colecciones/<fecha_hora>/<movimiento>/ */
const COLLECTIONS_DIR = path.join(REPO_ROOT, 'artifacts', 'colecciones');
const MASTER_CALIBRATION_DIR = path.resolve(process.cwd(), '../../artifacts/IRON_SYNC_CALIBRATION_PROFILES');
const PPO_TRAIN_SCRIPT = path.join(IMUS_VEN_ROOT, 'PPO', 'entrenar_ppo.py');
const PPO_INFERENCE_CLI = path.join(IMUS_VEN_ROOT, 'PPO', 'inferencia_ppo_cli.py');
const KALMAN_PARAMS_PATH = path.join(IMUS_VEN_ROOT, 'KALMAN', 'config', 'kalman_params.json');
let ppoTrainingProcess = null;
let ppoLiveTimer = null;
const PPO_LIVE_STATE_PATH = path.join(IMUS_VEN_ROOT, 'PPO', 'reports', 'ppo_live_state.json');
const PYTHON_BIN = process.env.IRONSYNC_PYTHON
  || (process.platform === 'win32' ? 'python' : 'python3');

export default defineConfig({
  plugins: [ironSyncLabApi(), ironSyncUnrealRelay(), ironSyncArduinoRelay()],
  assetsInclude: ['**/*.FBX', '**/*.fbx'],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});

function ironSyncLabApi() {
  return {
    name: 'ironsync-lab-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';

        if (url === '/ironsync/api/verify-models' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}');
              const items = Array.isArray(payload.items) ? payload.items : [];
              const results = items.map((item) => {
                const rel = item.path || '';
                const full = resolveRepoPath(rel);
                const ok = full && fs.existsSync(full);
                return {
                  id: item.id,
                  ok,
                  path: full || rel,
                  message: ok ? 'Cargado' : `No encontrado: ${full || rel}`,
                };
              });
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ results }));
            } catch (error) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: error.message }));
            }
          });
          return;
        }

        if (url === '/ironsync/api/verify-tcn') {
            const parsed = new URL(req.url, 'http://127.0.0.1');
            const rel = parsed.searchParams.get('path')
              || 'IA-IRON-SYNC/TCN/models/tcn_sanitizer_best.pt';
            const full = resolveRepoPath(rel)
              || path.join(IMUS_VEN_ROOT, 'TCN', 'models', 'tcn_sanitizer_best.pt');
            const ok = fs.existsSync(full);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok,
              path: full,
              message: ok ? 'TCN listo' : `No encontrado: ${full}`,
            }));
            return;
          }

          if (url === '/ironsync/api/start-ppo-training' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body || '{}');
                if (ppoTrainingProcess) {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ ok: false, state: 'busy' }));
                  return;
                }
                startPpoTrainingProcess(payload);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true, state: 'started' }));
              } catch (error) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, message: error.message }));
              }
            });
            return;
          }

          if (url === '/ironsync/api/stop-ppo-training' && req.method === 'POST') {
            if (ppoTrainingProcess) {
              ppoTrainingProcess.kill();
              ppoTrainingProcess = null;
              clearInterval(ppoLiveTimer);
              ppoLiveTimer = null;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, state: 'stopped' }));
            return;
          }

          if (url === '/ironsync/api/ppo-live-frame') {
            res.setHeader('Content-Type', 'application/json');
            if (!fs.existsSync(PPO_LIVE_STATE_PATH)) {
              res.end('null');
              return;
            }
            try {
              res.end(fs.readFileSync(PPO_LIVE_STATE_PATH, 'utf8'));
            } catch {
              res.end('null');
            }
            return;
          }

          if (url === '/ironsync/api/ppo-live-sse') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const sendFrame = () => {
              if (!fs.existsSync(PPO_LIVE_STATE_PATH)) return;
              try {
                const frame = fs.readFileSync(PPO_LIVE_STATE_PATH, 'utf8');
                res.write(`data: ${frame}\n\n`);
              } catch { /* escritura concurrente */ }
            };
            sendFrame();
            const iv = setInterval(sendFrame, 50);
            req.on('close', () => clearInterval(iv));
            return;
          }

        if (url === '/ironsync/api/collections') {
          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              collections: listTrainingCollections(),
              baseDir: COLLECTIONS_DIR,
              relativePath: 'artifacts/colecciones',
            }));
            return;
          }
          if (req.method === 'POST') {
            try {
              const created = createTrainingCollection();
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, collection: created }));
            } catch (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, message: error.message }));
            }
            return;
          }
        }

        const collectionLoadMatch = url.match(/^\/ironsync\/api\/collections\/([^/]+)\/load$/);
        if (collectionLoadMatch && req.method === 'GET') {
          try {
            const stamp = decodeURIComponent(collectionLoadMatch[1]);
            const loaded = loadTrainingCollection(stamp);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, ...loaded }));
          } catch (error) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, message: error.message }));
          }
          return;
        }

        if (url === '/ironsync/api/collections/save-dataset' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}');
              const saved = saveTrainingDataset(payload);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, saved }));
            } catch (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, message: error.message }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

/** Inicia proceso PPO y polling live (compartido WS + HTTP). */
function startPpoTrainingProcess(payload, broadcastFn = null) {
  const trainArgs = buildPpoTrainArgs(payload);
  ppoTrainingProcess = spawn(
    PYTHON_BIN,
    trainArgs,
    { cwd: path.join(IMUS_VEN_ROOT, 'PPO'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  let lastLiveMtime = 0;
  clearInterval(ppoLiveTimer);
  ppoLiveTimer = setInterval(() => {
    if (!fs.existsSync(PPO_LIVE_STATE_PATH)) return;
    try {
      const stat = fs.statSync(PPO_LIVE_STATE_PATH);
      if (stat.mtimeMs <= lastLiveMtime) return;
      lastLiveMtime = stat.mtimeMs;
      const frame = JSON.parse(fs.readFileSync(PPO_LIVE_STATE_PATH, 'utf8'));
      if (broadcastFn) broadcastFn({ type: 'ppo-live-frame', frame });
    } catch { /* ignore */ }
  }, 33);
  ppoTrainingProcess.stdout.on('data', (chunk) => { log += chunk.toString(); });
  ppoTrainingProcess.stderr.on('data', (chunk) => { log += chunk.toString(); });
  ppoTrainingProcess.on('close', (code) => {
    clearInterval(ppoLiveTimer);
    ppoLiveTimer = null;
    ppoTrainingProcess = null;
    const status = {
      type: 'ppo-training-status',
      state: code === 0 ? 'done' : 'error',
      exitCode: code,
      log: log.slice(-8000),
    };
    if (broadcastFn) broadcastFn(status);
    if (broadcastFn) broadcastFn({ type: 'ppo-live-frame', frame: null, ended: true });
  });
}

function ironSyncUnrealRelay() {
  let relay = null;

  return {
    name: 'ironsync-unreal-relay',
    configureServer() {
      relay ??= startUnrealRelay();
    },
  };
}

function ironSyncArduinoRelay() {
  let relay = null;

  return {
    name: 'ironsync-arduino-relay',
    configureServer() {
      relay ??= startArduinoRelay();
    },
  };
}

function startUnrealRelay() {
  const udp = dgram.createSocket('udp4');
  const clients = new Set();
  let frameCount = 0;

  const server = createWebSocketRelay((socket, payload) => {
    if (payload.type !== 'frame' || !Array.isArray(payload.rotations)) return;
    const actionMessage = formatIronAction(payload.action, payload.frame);
    if (actionMessage) {
      udp.send(Buffer.from(actionMessage, 'utf8'), UNREAL_UDP_PORT, UNREAL_UDP_HOST);
    }
    const message = formatIronFrame(payload.rotations);
    if (!message) return;
    udp.send(Buffer.from(message, 'utf8'), UNREAL_UDP_PORT, UNREAL_UDP_HOST);
    frameCount += 1;
    sendWebSocket(socket, {
      type: 'status',
      state: 'streaming',
      frames: frameCount,
      udp: `${UNREAL_UDP_HOST}:${UNREAL_UDP_PORT}`,
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[IRON-SYNC] Unreal relay ya esta usando ws://127.0.0.1:${UNREAL_RELAY_PORT}`);
      return;
    }
    console.warn(`[IRON-SYNC] Unreal relay error: ${error.message}`);
  });
  server.listen(UNREAL_RELAY_PORT, '127.0.0.1', () => {
    console.log(`[IRON-SYNC] Unreal relay ws://127.0.0.1:${UNREAL_RELAY_PORT} -> udp://${UNREAL_UDP_HOST}:${UNREAL_UDP_PORT}`);
  });
  server.on('connection', (socket) => clients.add(socket));
  server.on('close', () => {
    clients.clear();
    udp.close();
  });
  return { server, udp, clients };
}

function startArduinoRelay() {
  const udp = dgram.createSocket('udp4');
  const clients = new Set();
  let frameCount = 0;
  let heartbeatTimer = null;
  let responseTimer = null;
  let esp32Target = { host: ESP32_UDP_HOST, port: ESP32_UDP_PORT, discovered: false };
  /** Sesión UI↔Mega vía CONNECT_HARDWARE (no confundir con relay WS abierto). */
  let hardwareSessionActive = false;
  let pendingHardwareConnect = false;
  let transferActive = false;
  let megaCalibrating = false;
  /** true solo entre start-calibration explícito y CAL_OK / error / abort. */
  let calibrationRequested = false;
  /** true tras CAL_OK en la sesión actual (evita re-calibrar por líneas CAL_* residuales). */
  let sessionCalibrated = false;
  /** Usuario pulso Detener datos — no reenviar RUN_START hasta reanudar. */
  let streamPausedByUser = false;
  let lastStreamKickAt = 0;
  let lastEsp32Command = { text: '', at: 0 };
  let udpLineCount = 0;
  let udpIsCount = 0;
  let udpIsParseFail = 0;
  let lastUdpLine = '';
  let lastIsAt = 0;
  let streamKickCounter = 0;
  let relayStatsTimer = null;
  let udpBindFailed = false;
  /** Sesión hardware: solo se cierra con disconnect-hardware o close-relay (no al cerrar pestaña). */

  function resetRelayStreamCounters() {
    frameCount = 0;
    udpIsCount = 0;
    udpIsParseFail = 0;
    lastIsAt = 0;
    lastUdpLine = '';
    streamKickCounter = 0;
  }

  function relayHasClients() {
    return clients.size > 0;
  }

  /**
   * Reenvía IS al lab solo si el usuario completó Calibrar/iniciar en esta sesión
   * y no pulso Detener datos.
   */
  function canForwardIsToLab() {
    return relayHasClients()
      && hardwareSessionActive
      && !streamPausedByUser
      && !calibrationRequested
      && !megaCalibrating
      && esp32Target.discovered
      && !udpBindFailed;
  }

  function allowLiveStream() {
    return hardwareSessionActive && sessionCalibrated && !streamPausedByUser && !calibrationRequested;
  }

  function broadcastRelayStats() {
    if (!relayHasClients()) return;
    broadcastWebSocket(clients, {
      type: 'relay-stats',
      udpLines: udpLineCount,
      udpIs: udpIsCount,
      parsedOk: frameCount,
      parseFail: udpIsParseFail,
      lastIsAgeMs: lastIsAt ? Date.now() - lastIsAt : null,
      udpBindFailed,
      ...relayStatusExtras(),
    });
  }

  function startRelayStatsTimer() {
    if (relayStatsTimer) return;
    relayStatsTimer = setInterval(broadcastRelayStats, 2000);
    broadcastRelayStats();
  }

  function stopRelayStatsTimer() {
    if (relayStatsTimer) clearInterval(relayStatsTimer);
    relayStatsTimer = null;
  }

  function sendEsp32(command, { force = false, minGapMs = 320, allowRunStart = false } = {}) {
    const text = String(command ?? '').trim();
    if (!text) return;
    if (text === 'RUN_START' && !allowRunStart) {
      return;
    }
    const target = esp32Target.discovered
      ? esp32Target
      : { host: ESP32_UDP_HOST, port: ESP32_UDP_PORT };
    const now = Date.now();
    if (!force && text === 'RUN_START') {
      if (streamPausedByUser) return;
      if (lastEsp32Command.text === text && now - lastEsp32Command.at < minGapMs) return;
    }
    if (!force && text === lastEsp32Command.text && now - lastEsp32Command.at < 150) return;
    lastEsp32Command.text = text;
    lastEsp32Command.at = now;
    udp.send(Buffer.from(text, 'utf8'), target.port || ESP32_UDP_PORT, target.host || ESP32_UDP_HOST);
  }

  function suspendRelaySession({ notifyMega = true } = {}) {
    clearTimeout(responseTimer);
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    resetRelayStreamCounters();
    stopRelayStatsTimer();
    transferActive = false;
    megaCalibrating = false;
    calibrationRequested = false;
    sessionCalibrated = false;
    streamPausedByUser = false;
    lastStreamKickAt = 0;
    lastEsp32Command = { text: '', at: 0 };
    pendingHardwareConnect = false;
    if (notifyMega && hardwareSessionActive && esp32Target.discovered) {
      sendEsp32('DISCONNECT', { force: true });
    }
    hardwareSessionActive = false;
  }

  function relayStatusExtras() {
    return {
      hardwareSession: hardwareSessionActive,
      esp32Discovered: esp32Target.discovered,
      transferActive,
      megaCalibrating,
      calibrationRequested,
      sessionCalibrated,
      streamPausedByUser,
      relayParsedIs: frameCount,
      relayIsAgeMs: lastIsAt ? Date.now() - lastIsAt : null,
    };
  }

  function sendRunStartNow() {
    if (!allowLiveStream() || megaCalibrating || !esp32Target.discovered) {
      return;
    }
    sendEsp32('RUN_START', { minGapMs: 800, allowRunStart: true });
    lastStreamKickAt = Date.now();
    transferActive = true;
  }

  function markMegaCalibrating(active, { force = false } = {}) {
    if (!active) {
      megaCalibrating = false;
      return;
    }
    if (!force && !calibrationRequested) {
      return;
    }
    if (lastIsAt > 0 && Date.now() - lastIsAt < 3000) {
      return;
    }
    megaCalibrating = true;
    transferActive = false;
  }

  function finishCalibrationSession({ ok = true } = {}) {
    calibrationRequested = false;
    megaCalibrating = false;
    if (ok) {
      sessionCalibrated = true;
      streamPausedByUser = false;
      transferActive = true;
      sendRunStartNow();
    }
  }

  udp.on('message', (data, remote) => {
    clearTimeout(responseTimer);
    responseTimer = null;
    const payload = data.toString('utf8');
    const lines = payload.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    if (!lines.length) return;

    for (const line of lines) {
      processUdpLine(line);
    }
  });

  function processUdpLine(line) {
    udpLineCount += 1;
    lastUdpLine = line.slice(0, 120);

    if (line.startsWith('LOG,')) {
      const megaPayload = line.slice(4);
      broadcastWebSocket(clients, {
        type: 'mega-serial',
        line: megaPayload,
        ts: Date.now(),
      });
      line = megaPayload;
    }

    if (line === 'MEGA_HB_OK') {
      return;
    }

    if (
      line === 'CAL_STARTED'
      || line.startsWith('CAL_WAIT')
      || line.startsWith('CAL_PROGRESS')
      || line.startsWith('CAL_SENSOR,')
      || line.startsWith('CAL_STAGE')
    ) {
      markMegaCalibrating(true);
    } else if (
      line === 'CAL_OK'
      || line === 'CALIBRATION_DONE'
      || line === 'ESP32_STREAM_READY'
      || line.startsWith('CAL_ERROR')
      || line === 'CAL_ABORTED'
      || line.startsWith('WARN,CAL_PARTIAL')
    ) {
      if (calibrationRequested) {
        if (line === 'CAL_OK' || line === 'CALIBRATION_DONE') {
          finishCalibrationSession({ ok: true });
        } else if (line.startsWith('WARN,CAL_PARTIAL')) {
          finishCalibrationSession({ ok: true });
        } else {
          finishCalibrationSession({ ok: false });
        }
      } else {
        markMegaCalibrating(false);
      }
    }

    if (
      line === 'RUNNING'
      || line.startsWith('STATUS,STREAM_STARTED')
      || line.startsWith('STATUS,cal=1,run=1')
    ) {
      markMegaCalibrating(false);
      if (hardwareSessionActive && !streamPausedByUser) {
        sessionCalibrated = true;
        calibrationRequested = false;
        transferActive = true;
      }
    }

    if (line.startsWith('ECG,') || line.startsWith('EMG,')) {
      return;
    }

    if (line.startsWith('ESP32_PC_REGISTERED')) {
      markMegaCalibrating(false);
    }

    const hello = parseEsp32Hello(line);
    if (hello) {
      esp32Target = {
        host: hello.ip,
        port: hello.port,
        gateway: hello.gateway,
        broadcast: hello.broadcast,
        discovered: true,
      };
      if (pendingHardwareConnect) {
        registerPcAndConnectEsp32(sendEsp32, esp32Target);
      }
      broadcastWebSocket(clients, {
        type: 'status',
        state: hardwareSessionActive
          ? 'ESP32 en red — sesion hardware activa'
          : 'ESP32 en red — pulsa Conectar hardware',
        progress: hardwareSessionActive ? undefined : 0,
        frames: frameCount,
        esp32: `${esp32Target.host}:${esp32Target.port}`,
        udp: `${esp32Target.host}:${esp32Target.port}`,
        ...relayStatusExtras(),
      });
      return;
    }

    if (line.startsWith('IS,')) {
      udpIsCount += 1;
      const frame = parseIronSyncPacket(line);
      if (frame?.rotations?.length) {
        // Si ya llega IS real desde ESP32/Mega, aceptamos stream activo aunque
        // el flag local sessionCalibrated se haya desincronizado por ruido de estado.
        if (
          hardwareSessionActive
          && !streamPausedByUser
          && !calibrationRequested
          && !megaCalibrating
          && !sessionCalibrated
        ) {
          sessionCalibrated = true;
        }
        if (!canForwardIsToLab()) {
          if (udpIsCount <= 3 || udpIsCount % 200 === 0) {
            console.warn(
              `[IRON-SYNC] IS bloqueado — sesion=${hardwareSessionActive ? 1 : 0} `
              + `cal=${sessionCalibrated ? 1 : 0} pausa=${streamPausedByUser ? 1 : 0} `
              + `req=${calibrationRequested ? 1 : 0} megaCal=${megaCalibrating ? 1 : 0} `
              + `esp=${esp32Target.discovered ? 1 : 0} ws=${relayHasClients() ? 1 : 0} `
              + `udpBusy=${udpBindFailed ? 1 : 0}`,
            );
          }
          return;
        }
        markMegaCalibrating(false);
        transferActive = true;
        lastIsAt = Date.now();
        frameCount += 1;
        broadcastWebSocket(clients, {
          ...frame,
          frames: frameCount,
          relayParsedIs: frameCount,
          live: true,
          ...relayStatusExtras(),
        });
      } else {
        udpIsParseFail += 1;
        if (udpIsParseFail <= 8) {
          console.warn(
            `[IRON-SYNC] IS sin rotaciones (len=${line.length}, fail=${udpIsParseFail}) — `
            + `cabecera+mux o linea truncada; esperado IS,frame,ms,mask,active,ecg,emg,...;70,ch,key,rx,ry,rz`,
          );
        }
      }
      return;
    }

    const sensor = parseSensorState(line);
    if (sensor) {
      if (Array.isArray(sensor)) {
        for (const item of sensor) broadcastWebSocket(clients, item);
      } else {
        broadcastWebSocket(clients, sensor);
      }
      return;
    }

    const progress = parseCalibrationProgress(line);
    if (progress) {
      if (line.startsWith('CAL_PROGRESS')) {
        markMegaCalibrating(true);
      }
      if (progress.transferStopped) transferActive = false;
      broadcastWebSocket(clients, {
        ...progress,
        calibrationStage: progress.calibrationStage ?? inferCalibrationStage(line),
        ...relayStatusExtras(),
      });
      return;
    }

    if (line.startsWith('ESP32_PC_REGISTERED')) {
      markMegaCalibrating(false);
      const freshConnect = pendingHardwareConnect;
      pendingHardwareConnect = false;
      hardwareSessionActive = true;
      startHeartbeat();
      if (freshConnect) {
        sessionCalibrated = false;
        streamPausedByUser = false;
        transferActive = false;
        calibrationRequested = false;
      }
    }

    const status = parseHardwareStatus(line);
    if (status) {
      if (status.hardwareSession) {
        pendingHardwareConnect = false;
        hardwareSessionActive = true;
        startHeartbeat();
      }
      if (status.streamConfirmed === true && hardwareSessionActive && !streamPausedByUser) {
        sessionCalibrated = true;
        calibrationRequested = false;
        megaCalibrating = false;
        transferActive = true;
      }
      if (status.disconnected) {
        pendingHardwareConnect = false;
        hardwareSessionActive = false;
        transferActive = false;
        calibrationRequested = false;
        sessionCalibrated = false;
      }
      if (status.transferStopped) transferActive = false;
      broadcastWebSocket(clients, {
        ...status,
        frames: frameCount,
        esp32: `${esp32Target.host}:${esp32Target.port}`,
        ...relayStatusExtras(),
      });
      return;
    }

    if (line.startsWith('STATUS,')) {
      const status = parseHardwareStatus(line);
      if (status) {
        if (status.hardwareSession) hardwareSessionActive = true;
        if (status.transferStopped) transferActive = false;
        broadcastWebSocket(clients, {
          ...status,
          frames: frameCount,
          esp32: `${esp32Target.host}:${esp32Target.port}`,
          ...relayStatusExtras(),
        });
        return;
      }
    }

    broadcastWebSocket(clients, {
      type: 'status',
      state: line,
      relayParsedIs: frameCount,
      esp32: `${esp32Target.host}:${esp32Target.port}`,
      ...relayStatusExtras(),
    });
  }

  udp.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      udpBindFailed = true;
      console.warn(
        `[IRON-SYNC] CRITICO: UDP ${ARDUINO_UDP_LISTEN_PORT} en uso (bridge Python?). `
        + 'Cierra: python -m ironsync_runtime.websocket_bridge — sin esto NO hay IS vivo.',
      );
      broadcastWebSocket(clients, {
        type: 'relay-stats',
        udpBindFailed: true,
        state: `ERROR: puerto UDP ${ARDUINO_UDP_LISTEN_PORT} ocupado — cierra bridge Python`,
      });
      return;
    }
    console.warn(`[IRON-SYNC] Arduino UDP error: ${error.message}`);
  });
  udp.bind(ARDUINO_UDP_LISTEN_PORT, '0.0.0.0', () => {
    udpBindFailed = false;
    udp.setBroadcast(true);
    console.log(`[IRON-SYNC] Arduino relay udp://0.0.0.0:${ARDUINO_UDP_LISTEN_PORT} <-> ${ESP32_UDP_HOST}:${ESP32_UDP_PORT}`);
  });

  const server = createWebSocketRelay((socket, payload) => {
    if (payload.type === 'connect-hardware') {
      resetRelayStreamCounters();
      pendingHardwareConnect = true;
      transferActive = false;
      calibrationRequested = false;
      sessionCalibrated = false;
      streamPausedByUser = false;
      lastStreamKickAt = 0;
      hardwareSessionActive = false;
      ensureHeartbeat();
      const target = esp32Target.discovered
        ? esp32Target
        : { host: ESP32_UDP_HOST, port: ESP32_UDP_PORT };
      registerPcAndConnectEsp32(sendEsp32, target);
      sendWebSocket(socket, {
        type: 'status',
        state: esp32Target.discovered ? 'Conectando hardware' : 'Buscando ESP32 por broadcast',
        progress: 0,
        udp: `${esp32Target.host}:${esp32Target.port}`,
        esp32: `${esp32Target.host}:${esp32Target.port}`,
      });
      clearTimeout(responseTimer);
      responseTimer = setTimeout(() => {
        pendingHardwareConnect = false;
        broadcastWebSocket(clients, {
          type: 'status',
          state: 'Sin respuesta ESP32 al conectar',
          progress: 0,
          frames: frameCount,
          esp32: `${esp32Target.host}:${esp32Target.port}`,
        });
      }, 4500);
      return;
    }

    if (payload.type === 'start-calibration') {
      if (!hardwareSessionActive) {
        sendWebSocket(socket, {
          type: 'status',
          state: 'Conecta hardware antes de calibrar',
          progress: 0,
          frames: frameCount,
          esp32: `${esp32Target.host}:${esp32Target.port}`,
        });
        return;
      }
      if (calibrationRequested) {
        sendWebSocket(socket, {
          type: 'status',
          state: 'Calibracion ya en curso — espera CAL_OK',
          progress: 1,
          frames: frameCount,
          megaCalibrating: true,
          calibrationRequested: true,
          esp32: `${esp32Target.host}:${esp32Target.port}`,
        });
        return;
      }
      calibrationRequested = true;
      sessionCalibrated = false;
      streamPausedByUser = false;
      transferActive = false;
      markMegaCalibrating(true, { force: true });
      sendEsp32('CAL_START', { force: true });
      broadcastWebSocket(clients, {
        type: 'status',
        state: 'Calibrando sensores',
        progress: 1,
        frames: frameCount,
        megaCalibrating: true,
        calibrationRequested: true,
        ...relayStatusExtras(),
      });
      clearTimeout(responseTimer);
      responseTimer = setTimeout(() => {
        broadcastWebSocket(clients, {
          type: 'status',
          state: 'Sin respuesta de calibracion',
          progress: 1,
          frames: frameCount,
          esp32: `${esp32Target.host}:${esp32Target.port}`,
        });
      }, 12000);
      return;
    }

    if (payload.type === 'stop-data') {
      transferActive = false;
      streamPausedByUser = true;
      sessionCalibrated = false;
      calibrationRequested = false;
      sendEsp32('STOP', { force: true, minGapMs: 0 });
      sendWebSocket(socket, {
        type: 'status',
        state: 'Datos en pausa — pulsa Calibrar/iniciar para volver a calibrar',
        frames: frameCount,
        transferStopped: true,
        streamPausedByUser: true,
        sessionCalibrated,
        esp32: `${esp32Target.host}:${esp32Target.port}`,
        ...relayStatusExtras(),
      });
      return;
    }

    if (payload.type === 'disconnect-hardware') {
      suspendRelaySession({ notifyMega: true });
      sendWebSocket(socket, {
        type: 'status',
        state: 'Desconectando: doble pitido → pausa roja → reset Mega → ESP32 enviara HELLO',
        frames: frameCount,
        transferStopped: true,
        disconnected: true,
        hardwareSession: false,
        esp32: `${esp32Target.host}:${esp32Target.port}`,
      });
      return;
    }

    if (payload.type === 'close-relay') {
      suspendRelaySession({ notifyMega: hardwareSessionActive });
      sendWebSocket(socket, {
        type: 'status',
        state: 'Relay cerrado — sin comandos al traje',
        frames: frameCount,
        transferStopped: true,
        disconnected: !hardwareSessionActive,
        hardwareSession: false,
        esp32: `${esp32Target.host}:${esp32Target.port}`,
      });
      return;
    }

    if (payload.type === 'command' && payload.command) {
      const cmd = String(payload.command).trim();
      if (cmd === 'RUN_START') {
        sendWebSocket(socket, {
          type: 'status',
          state: streamPausedByUser
            ? 'Stream en pausa — pulsa Calibrar/iniciar'
            : 'Calibra con Calibrar/iniciar antes de iniciar stream',
          frames: frameCount,
          streamPausedByUser,
          sessionCalibrated,
          ...relayStatusExtras(),
        });
        return;
      }
      sendEsp32(cmd, { force: cmd === 'DISCONNECT' || cmd === 'STOP', minGapMs: 200 });
      sendWebSocket(socket, { type: 'status', state: `Comando enviado: ${payload.command}`, frames: frameCount });
      return;
    }

    if (payload.type === 'save-training-dataset') {
      try {
        const saved = saveTrainingDataset(payload);
        sendWebSocket(socket, {
          type: 'status',
          state: `Dataset entrenamiento guardado: ${saved.dir}`,
          frames: frameCount,
          saved,
        });
      } catch (error) {
        sendWebSocket(socket, {
          type: 'status',
          state: `ERROR guardando dataset: ${error.message}`,
          frames: frameCount,
        });
      }
      return;
    }

    if (payload.type === 'list-training-collections') {
      try {
        const collections = listTrainingCollections();
        sendWebSocket(socket, {
          type: 'training-collections',
          collections,
          frames: frameCount,
        });
      } catch (error) {
        sendWebSocket(socket, {
          type: 'status',
          state: `ERROR listando colecciones: ${error.message}`,
          frames: frameCount,
        });
      }
      return;
    }

    if (payload.type === 'create-training-collection') {
      try {
        const created = createTrainingCollection();
        sendWebSocket(socket, {
          type: 'training-collection-created',
          collection: created,
          frames: frameCount,
        });
      } catch (error) {
        sendWebSocket(socket, {
          type: 'status',
          state: `ERROR creando coleccion: ${error.message}`,
          frames: frameCount,
        });
      }
      return;
    }

    if (payload.type === 'load-training-collection') {
      try {
        const loaded = loadTrainingCollection(payload.stamp);
        sendWebSocket(socket, {
          type: 'training-collection-loaded',
          ...loaded,
          frames: frameCount,
        });
      } catch (error) {
        sendWebSocket(socket, {
          type: 'status',
          state: `ERROR cargando coleccion: ${error.message}`,
          frames: frameCount,
        });
      }
      return;
    }

    if (payload.type === 'save-master-calibration') {
      try {
        const saved = saveMasterCalibration(payload);
        sendWebSocket(socket, {
          type: 'status',
          state: `Calibracion maestra guardada: ${saved.dir}`,
          frames: frameCount,
          saved,
        });
      } catch (error) {
        sendWebSocket(socket, {
          type: 'status',
          state: `ERROR guardando calibracion maestra: ${error.message}`,
          frames: frameCount,
        });
      }
      return;
    }

    if (payload.type === 'verify-tcn-model') {
      const tcnPath = resolveRepoPath(payload.tcnPath)
        || path.join(IMUS_VEN_ROOT, 'TCN', 'models', 'tcn_sanitizer_best.pt');
      const ok = fs.existsSync(tcnPath);
      sendWebSocket(socket, {
        type: 'tcn-model-status',
        ok,
        path: tcnPath,
        message: ok ? 'TCN listo en disco' : `No encontrado: ${tcnPath}`,
      });
      return;
    }

    if (payload.type === 'stop-ppo-training') {
      if (ppoTrainingProcess) {
        ppoTrainingProcess.kill();
        ppoTrainingProcess = null;
        clearInterval(ppoLiveTimer);
        ppoLiveTimer = null;
      }
      sendWebSocket(socket, { type: 'ppo-training-status', state: 'stopped', message: 'Entrenamiento detenido' });
      return;
    }

    if (payload.type === 'start-ppo-training') {
      if (ppoTrainingProcess) {
        sendWebSocket(socket, { type: 'ppo-training-status', state: 'busy', message: 'Entrenamiento PPO ya en curso' });
        return;
      }
      startPpoTrainingProcess(payload, (msg) => broadcastWebSocket(clients, msg));
      sendWebSocket(socket, { type: 'ppo-training-status', state: 'started', script: PPO_TRAIN_SCRIPT });
      return;
    }

    if (payload.type === 'imu-inference') {
      runImuInference(payload)
        .then((result) => sendWebSocket(socket, { type: 'imu-inference-result', ok: true, result }))
        .catch((error) => sendWebSocket(socket, { type: 'imu-inference-result', ok: false, error: error.message }));
      return;
    }

    if (payload.type === 'get-ppo-metrics') {
      const metricsPath = path.join(IMUS_VEN_ROOT, 'PPO', 'reports', 'training_metrics.json');
      let data = [];
      if (fs.existsSync(metricsPath)) {
        try {
          data = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
        } catch {
          data = [];
        }
      }
      sendWebSocket(socket, { type: 'ppo-metrics', data });
      return;
    }

    if (payload.type === 'save-kalman-config') {
      try {
        fs.mkdirSync(path.dirname(KALMAN_PARAMS_PATH), { recursive: true });
        fs.writeFileSync(KALMAN_PARAMS_PATH, JSON.stringify(payload.config ?? {}, null, 2), 'utf8');
        sendWebSocket(socket, { type: 'status', state: `Kalman guardado: ${KALMAN_PARAMS_PATH}` });
      } catch (error) {
        sendWebSocket(socket, { type: 'status', state: `ERROR Kalman: ${error.message}` });
      }
      return;
    }

    if (payload.type === 'diagnostics') {
      sendEsp32('STRESS_STATUS');
      sendEsp32('QUALITY');
      sendEsp32('ESP32_STATS');
      sendWebSocket(socket, {
        type: 'status',
        state: `Diag UDP lineas=${udpLineCount} is=${udpIsCount} ok=${frameCount} fail=${udpIsParseFail} vivo=${lastIsAt ? Math.round((Date.now() - lastIsAt) / 1000) : '-'}s transfer=${transferActive ? 1 : 0} sesion=${hardwareSessionActive ? 1 : 0} tgt=${esp32Target.host}:${esp32Target.port} last=${lastUdpLine}`,
        relayParsedIs: frameCount,
        esp32: `${esp32Target.host}:${esp32Target.port}`,
        ...relayStatusExtras(),
      });
    }
  }, {
    connectedPayload: {
      type: 'status',
      state: 'Relay WebSocket listo — aun no hay sesion con el traje',
      hardwareSession: false,
      esp32Discovered: false,
      udp: `${esp32Target.host}:${esp32Target.port}`,
    },
    onSocketOpen(socket) {
      clients.add(socket);
      ensureHeartbeat();
      startRelayStatsTimer();
      if (hardwareSessionActive) {
        sendWebSocket(socket, {
          type: 'status',
          state: 'Relay reconectado — hardware sigue activo',
          progress: 100,
          frames: frameCount,
          hardwareSession: true,
          transferActive,
          esp32: `${esp32Target.host}:${esp32Target.port}`,
        });
      }
    },
    onSocketClose(socket) {
      clients.delete(socket);
      if (clients.size === 0) {
        stopRelayStatsTimer();
      }
    },
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[IRON-SYNC] Arduino relay ya esta usando ws://127.0.0.1:${ARDUINO_RELAY_PORT}`);
      return;
    }
    console.warn(`[IRON-SYNC] Arduino relay error: ${error.message}`);
  });
  server.listen(ARDUINO_RELAY_PORT, '127.0.0.1', () => {
    console.log(`[IRON-SYNC] Arduino relay ws://127.0.0.1:${ARDUINO_RELAY_PORT} -> udp://${ESP32_UDP_HOST}:${ESP32_UDP_PORT}`);
  });
  server.on('close', () => {
    clearTimeout(responseTimer);
    suspendRelaySession();
    clients.clear();
    udp.close();
  });
  return { server, udp, clients };

  function ensureHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (!hardwareSessionActive || !esp32Target.discovered) return;
      sendEsp32('HB', { minGapMs: 400 });
    }, 500);
    if (hardwareSessionActive && esp32Target.discovered) {
      sendEsp32('HB', { minGapMs: 0 });
    }
  }

  function startHeartbeat() {
    ensureHeartbeat();
  }
}

function createWebSocketRelay(onPayload, options = {}) {
  const server = net.createServer((socket) => {
    socket.once('data', (chunk) => {
      const request = chunk.toString('latin1');
      const key = request.match(/Sec-WebSocket-Key: (.+)\r?$/mi)?.[1]?.trim();
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = crypto.createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      sendWebSocket(socket, options.connectedPayload ?? {
        type: 'status',
        state: 'connected',
        udp: `${UNREAL_UDP_HOST}:${UNREAL_UDP_PORT}`,
      });
      options.onSocketOpen?.(socket);
      socket.on('close', () => {
        options.onSocketClose?.(socket);
      });
      socket.on('data', (data) => {
        for (const text of decodeWebSocketFrames(data)) {
          try {
            onPayload(socket, JSON.parse(text));
          } catch {
            sendWebSocket(socket, { type: 'status', state: 'invalid-packet' });
          }
        }
      });
      socket.on('error', () => {});
    });
  });
  return server;
}

function pickLocalIpv4ForHost(host) {
  const parts = String(host ?? '').split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;

  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const ip = entry.address.split('.').map(Number);
      if (ip[0] === parts[0] && ip[1] === parts[1] && ip[2] === parts[2]) {
        return entry.address;
      }
    }
  }
  return null;
}

function registerPcAndConnectEsp32(sendFn, target) {
  const host = target?.host || ESP32_UDP_HOST;
  const port = target?.port || ESP32_UDP_PORT;
  const localIp = pickLocalIpv4ForHost(host);
  if (localIp) {
    sendFn(`REGISTER_PC,${localIp}`, { force: true });
    return;
  }
  sendFn('CONNECT_HARDWARE', { force: true });
}

function sendArduinoCommand(udp, command, target = { host: ESP32_UDP_HOST, port: ESP32_UDP_PORT }) {
  udp.send(Buffer.from(command, 'utf8'), target.port || ESP32_UDP_PORT, target.host || ESP32_UDP_HOST);
}

function broadcastWebSocket(clients, payload) {
  for (const socket of clients) sendWebSocket(socket, payload);
}

function parseSensorState(line) {
  if (line.startsWith('SCAN_DONE,')) {
    const mask = Number(line.match(/mask=(\d+)/)?.[1] ?? 0);
    return sensorStatesFromMask(mask);
  }
  if (line.startsWith('SENSOR_BIND,')) {
    const parts = line.split(',');
    const tcaToken = String(parts[1] ?? '').trim();
    const channel = Number(parts[2]);
    const firmwareKey = parts[3] ?? '';
    const alias = routeSensorBlock({ tca: tcaToken, channel, firmwareKey })?.alias;
    if (!alias) return null;
    return {
      type: 'sensor-state',
      alias,
      tca: tcaToken ? parseInt(tcaToken, 16) : null,
      channel,
      firmwareKey,
      state: 'BIND',
      online: true,
    };
  }
  if (line.startsWith('SENSOR,')) {
    const parts = line.split(',');
    const alias = parts[1];
    const state = parts.at(-1);
    if (!alias) return null;
    return {
      type: 'sensor-state',
      alias,
      state: state ?? 'UNKNOWN',
      online: state === 'OK',
    };
  }
  if (!line.startsWith('SENSOR_STATE,')) return null;
  const [, alias, state] = line.split(',');
  if (!alias) return null;
  return {
    type: 'sensor-state',
    alias,
    state: state ?? 'UNKNOWN',
    online: state !== 'OFFLINE' && state !== 'LOST',
  };
}

function sensorStatesFromMask(mask) {
  return MEGA_SENSOR_INDEX_ORDER.map((alias, index) => {
    const online = (mask & (1 << index)) !== 0;
    return {
      type: 'sensor-state',
      alias,
      state: online ? 'OK' : 'OFFLINE',
      online,
    };
  });
}

function parseCalibrationProgress(line) {
  if (line.startsWith('CAL_PROGRESS,')) {
    return {
      type: 'status',
      state: 'Calibrando sensores',
      progress: Number(line.split(',')[1]) || 0,
    };
  }
  if (line === 'CALIBRATION_DONE') {
    return { type: 'status', state: 'Calibracion y sincronizacion completada', progress: 100, transferActive: true };
  }
  if (line === 'CAL_OK') {
    return { type: 'status', state: 'Calibracion OK. Transferencia activa', progress: 100, transferActive: true };
  }
  if (line.startsWith('WARN,CAL_PARTIAL')) {
    return {
      type: 'status',
      state: `Calibracion parcial (${line})`,
      progress: 100,
      transferActive: true,
      calibrationStage: 'mega_partial',
    };
  }
  if (line.startsWith('MOUNT,')) {
    return { type: 'status', state: line, calibrationStage: 'mount' };
  }
  if (line.startsWith('CAL_SENSOR_DONE,')) {
    const [, alias, result] = line.split(',');
    return {
      type: 'status',
      state: `Recalibrado ${alias}: ${result}`,
      calibrationStage: 'sensor_done',
    };
  }
  if (line.startsWith('CAL_ERROR') || line.startsWith('ERROR_CAL')) {
    return { type: 'status', state: line, progress: 0 };
  }
  if (line.startsWith('CAL_STAGE_DONE,')) {
    const [, stage] = line.split(',');
    return { type: 'status', state: `Etapa ${stage}/3 calibrada`, progress: undefined };
  }
  return null;
}

function inferCalibrationStage(line) {
  if (line.startsWith('CAL_PROGRESS,')) return 'mega_progress';
  if (line === 'CALIBRATION_DONE' || line === 'CAL_OK') return 'mega_done';
  if (line.startsWith('WARN,CAL_PARTIAL')) return 'mega_partial';
  return null;
}

function parseEsp32Hello(line) {
  if (!line.startsWith('ESP32_HELLO,')) return null;
  const [, ip, port, gateway, broadcast] = line.split(',');
  if (!ip) return null;
  return {
    ip,
    port: Number(port) || ESP32_UDP_PORT,
    gateway: gateway || '',
    broadcast: broadcast || '',
  };
}

function parseHardwareStatus(line) {
  if (line.startsWith('ESP32_PC_REGISTERED')) {
    return {
      type: 'status',
      state: 'Hardware conectado — pulsa Calibrar/iniciar (sin datos hasta calibrar)',
      progress: 0,
      hardwareSession: true,
      transferActive: false,
    };
  }
  if (line.startsWith('ESP32_DISCONNECTED') || line.startsWith('ESP32_DISCONNECTING')) {
    return {
      type: 'status',
      state: line,
      disconnected: true,
      transferStopped: true,
    };
  }
  if (line === 'ESP32_STREAM_READY') {
    return {
      type: 'status',
      state: 'Stream IS listo (Mega → ESP32 → PC)',
      hardwareSession: true,
      transferActive: true,
      streamConfirmed: true,
    };
  }
  if (line === 'ESP32_CAL_START_SENT') {
    return {
      type: 'status',
      state: 'Orden de calibracion enviada',
      progress: 1,
    };
  }
  if (line === 'ESP32_STOP_SENT') {
    return {
      type: 'status',
      state: 'Transferencia detenida',
      transferStopped: true,
    };
  }
  if (line === 'STOPPED') {
    return {
      type: 'status',
      state: 'Transferencia detenida',
      transferStopped: true,
    };
  }
  if (line.startsWith('ESP32_DISCONNECTED')) {
    return {
      type: 'status',
      state: line,
      progress: 0,
      disconnected: true,
    };
  }
  if (line === 'ESP32_PONG') {
    return {
      type: 'status',
      state: 'Relay UDP ↔ ESP32 activo',
    };
  }
  if (line.startsWith('STATUS,')) {
    const cal = line.match(/cal=(\d+)/)?.[1];
    const run = line.match(/run=(\d+)/)?.[1];
    const active = line.match(/activeSensors=(\d+)/)?.[1];
    const streaming = cal === '1' && run === '1';
    const streamStarted = line.includes('STREAM_STARTED');
    return {
      type: 'status',
      state: streamStarted
        ? `Stream Mega activo (${active ?? '?'} sensores)`
        : streaming
          ? `Mega listo ${active ?? '?'}/15 sensores`
          : line,
      hardwareSession: true,
      transferActive: streaming || streamStarted,
      streamConfirmed: streaming || streamStarted,
    };
  }
  return null;
}

function formatIronFrame(rotations) {
  const blocks = rotations
    .filter((item) => item?.alias && item?.bone)
    .map((item) => [
      item.alias,
      item.bone,
      fmt(item.rx),
      fmt(item.ry),
      fmt(item.rz),
      fmt(item.tx ?? 0),
      fmt(item.ty ?? 0),
      fmt(item.tz ?? 0),
    ].join(','));
  return blocks.length ? `IRON_FRAME;${blocks.join(';')}` : '';
}

function formatIronAction(action, frame = 0) {
  if (!action?.id) return '';
  const execution = action.execution ?? {};
  return [
    'IRON_ACTION',
    sanitizeUdpToken(action.id),
    sanitizeUdpToken(action.label || action.id),
    fmt(action.confidence ?? 0),
    Number(frame) || 0,
    fmt(execution.intensity ?? 0),
    fmt(execution.velocity ?? 0),
    fmt(execution.amplitude ?? 0),
    fmt(execution.force ?? 0),
    Math.round(Number(execution.durationMs ?? 0) || 0),
  ].join(',');
}

function sanitizeUdpToken(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 48) || 'NA';
}

function fmt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : '0.000';
}

function listTrainingCollections() {
  if (!fs.existsSync(COLLECTIONS_DIR)) {
    fs.mkdirSync(COLLECTIONS_DIR, { recursive: true });
    return [];
  }
  return fs.readdirSync(COLLECTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const stamp = entry.name;
      const sessionDir = path.join(COLLECTIONS_DIR, stamp);
      const movements = fs.readdirSync(sessionDir, { withFileTypes: true })
        .filter((sub) => sub.isDirectory())
        .map((sub) => sub.name);
      return { stamp, movementCount: movements.length, movements, sessionDir };
    })
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

function createTrainingCollection() {
  if (!fs.existsSync(COLLECTIONS_DIR)) {
    fs.mkdirSync(COLLECTIONS_DIR, { recursive: true });
  }
  const stamp = localTimestampForFolder();
  const sessionDir = path.join(COLLECTIONS_DIR, stamp);
  fs.mkdirSync(sessionDir, { recursive: true });
  const manifest = {
    schema: 'ironsync.collection.v1',
    stamp,
    createdAt: new Date().toISOString(),
    relativePath: `artifacts/colecciones/${stamp}`,
  };
  fs.writeFileSync(path.join(sessionDir, 'collection.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { stamp, sessionDir, relativePath: manifest.relativePath, movementCount: 0, movements: [] };
}

function loadTrainingCollection(stamp) {
  const safeStamp = sanitizePathSegment(stamp);
  const sessionDir = path.join(COLLECTIONS_DIR, safeStamp);
  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Coleccion no encontrada: ${safeStamp}`);
  }
  const movements = [];
  const animations = [];
  for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const datasetPath = path.join(sessionDir, entry.name, 'dataset.json');
    if (!fs.existsSync(datasetPath)) continue;
    const raw = fs.readFileSync(datasetPath, 'utf8');
    const dataset = JSON.parse(raw);
    const folder = entry.name;
    movements.push({
      folder,
      animationId: dataset.animationId || dataset.animations?.[0]?.animationId,
      animationName: dataset.animationName || dataset.animations?.[0]?.animationName,
      approved: Boolean(dataset.approved ?? dataset.animations?.[0]?.approved),
    });
    const block = Array.isArray(dataset.animations) ? dataset.animations : [];
    if (block.length) {
      animations.push(...block.map((animation) => ({
        ...animation,
        masterTrajectory: animation.masterTrajectory ?? animation.augmented?.masterTrajectory ?? null,
        holdWindow: animation.holdWindow ?? animation.augmented?.holdWindow ?? null,
        sequenceProfile: animation.sequenceProfile ?? animation.augmented?.sequenceProfile ?? null,
        durationMs: animation.durationMs ?? animation.augmented?.durationMs ?? null,
      })));
    } else if (dataset.animationId) {
      animations.push({
        animationId: dataset.animationId,
        animationName: dataset.animationName,
        activeBones: dataset.activeBones,
        recognition: dataset.recognition,
        approved: dataset.approved,
        template: dataset.template,
        samples: dataset.samples,
        masterTrajectory: dataset.masterTrajectory ?? null,
        holdWindow: dataset.holdWindow ?? null,
        sequenceProfile: dataset.sequenceProfile ?? null,
        durationMs: dataset.durationMs ?? null,
      });
    }
  }
  return {
    stamp: safeStamp,
    sessionDir,
    relativePath: `artifacts/colecciones/${safeStamp}`,
    movements,
    animations,
    profileCount: animations.length,
  };
}

function saveTrainingDataset(payload) {
  const sessionStamp = sanitizePathSegment(payload.sessionStamp || payload.stamp || localTimestampForFolder());
  const movementFolder = sanitizePathSegment(
    payload.movementFolder
    || payload.dataset?.movementFolder
    || payload.dataset?.animationName
    || payload.dataset?.animationId
    || 'movimiento',
  );
  const sessionDir = path.join(COLLECTIONS_DIR, sessionStamp);
  const dir = path.join(sessionDir, movementFolder);
  fs.mkdirSync(dir, { recursive: true });

  const files = {
    dataset: path.join(dir, 'dataset.json'),
    samplesCsv: path.join(dir, 'samples.csv'),
    summaryCsv: path.join(dir, 'summary.csv'),
    trajectoryCsv: path.join(dir, 'trajectory.csv'),
    masterTrajectoryCsv: path.join(dir, 'master_trajectory.csv'),
    augmentedSamplesCsv: path.join(dir, 'augmented_samples.csv'),
    discriminatorsCsv: path.join(dir, 'discriminators.csv'),
    envelopesCsv: path.join(dir, 'envelopes.csv'),
  };

  fs.writeFileSync(files.dataset, JSON.stringify(payload.dataset ?? {}, null, 2), 'utf8');
  fs.writeFileSync(files.samplesCsv, String(payload.samplesCsv ?? ''), 'utf8');
  fs.writeFileSync(files.summaryCsv, String(payload.summaryCsv ?? ''), 'utf8');
  fs.writeFileSync(files.trajectoryCsv, String(payload.trajectoryCsv ?? ''), 'utf8');
  fs.writeFileSync(files.masterTrajectoryCsv, String(payload.masterTrajectoryCsv ?? ''), 'utf8');
  fs.writeFileSync(files.augmentedSamplesCsv, String(payload.augmentedSamplesCsv ?? ''), 'utf8');
  fs.writeFileSync(files.discriminatorsCsv, String(payload.discriminatorsCsv ?? ''), 'utf8');
  fs.writeFileSync(files.envelopesCsv, String(payload.envelopesCsv ?? ''), 'utf8');

  return {
    sessionDir,
    dir,
    movementFolder,
    relativePath: `artifacts/colecciones/${sessionStamp}/${movementFolder}`,
    files,
  };
}

function saveMasterCalibration(payload) {
  const stamp = sanitizePathSegment(payload.stamp || localTimestampForFolder());
  const masterId = sanitizePathSegment(payload.bundle?.masterSnapshot?.id || 'master');
  const dir = path.join(MASTER_CALIBRATION_DIR, `${stamp}_${masterId}`);
  fs.mkdirSync(dir, { recursive: true });

  const files = {
    bundle: path.join(dir, 'master_calibration_bundle.json'),
    masterSnapshot: path.join(dir, 'master_snapshot.json'),
    sensorCalibration: path.join(dir, 'sensor_calibration.json'),
    manifest: path.join(dir, 'manifest.json'),
  };

  const bundle = payload.bundle ?? {};
  const manifest = {
    schema: 'ironsync.master-calibration.manifest.v1',
    createdAt: new Date().toISOString(),
    stamp,
    masterId,
    source: bundle.source ?? 'biomech-lab',
    hasSensorCalibration: Boolean(bundle.sensorCalibration),
    bundleSchema: bundle.schema ?? null,
    masterSchema: bundle.masterSnapshot?.schema ?? null,
    files: {
      bundle: path.basename(files.bundle),
      masterSnapshot: path.basename(files.masterSnapshot),
      sensorCalibration: path.basename(files.sensorCalibration),
    },
  };

  fs.writeFileSync(files.bundle, JSON.stringify(bundle, null, 2), 'utf8');
  fs.writeFileSync(files.masterSnapshot, JSON.stringify(bundle.masterSnapshot ?? {}, null, 2), 'utf8');
  fs.writeFileSync(files.sensorCalibration, JSON.stringify(bundle.sensorCalibration ?? {}, null, 2), 'utf8');
  fs.writeFileSync(files.manifest, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    dir,
    files,
    masterId,
    stamp,
  };
}

function localTimestampForFolder() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function resolveRepoPath(relPath) {
  if (!relPath) return null;
  const value = String(relPath).trim();
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('IMUS_VEN/')) {
    return path.resolve(REPO_ROOT, normalized.replace(/^IMUS_VEN\//, 'IA-IRON-SYNC/'));
  }
  if (normalized.startsWith('models/best/')) {
    const migrated = path.resolve(REPO_ROOT, normalized.replace(/^models\/best\//, 'models/'));
    if (fs.existsSync(migrated)) return migrated;
  }
  return path.resolve(REPO_ROOT, normalized);
}

function buildPpoTrainArgs(payload = {}) {
  const configPath = resolveRepoPath(payload.configPath)
    || path.join(IMUS_VEN_ROOT, 'PPO', 'configuracion_hiperparametros.yaml');
  const args = [PPO_TRAIN_SCRIPT, '--config', configPath];

  const tcn = resolveRepoPath(payload.tcnPath);
  if (tcn) args.push('--modelo-tcn', tcn);

  const actor = resolveRepoPath(payload.actorPath);
  if (actor) args.push('--salida-actor', actor);

  const reports = resolveRepoPath(payload.reportsPath);
  if (reports) args.push('--carpeta-reportes', reports);

  if (payload.numEnvs != null && payload.numEnvs !== '') args.push('--num-entornos', String(payload.numEnvs));
  if (payload.totalSteps != null && payload.totalSteps !== '') args.push('--pasos-totales', String(payload.totalSteps));
  if (payload.rolloutSteps != null && payload.rolloutSteps !== '') args.push('--pasos-por-rollout', String(payload.rolloutSteps));
  if (payload.actionScale != null && payload.actionScale !== '') args.push('--escala-accion', String(payload.actionScale));
  if (payload.noiseMax != null && payload.noiseMax !== '') args.push('--ruido-max', String(payload.noiseMax));
  if (payload.driftMax != null && payload.driftMax !== '') args.push('--drift-max', String(payload.driftMax));
  if (payload.jitterMax != null && payload.jitterMax !== '') args.push('--jitter-max', String(payload.jitterMax));
  if (payload.missingMax != null && payload.missingMax !== '') args.push('--perdida-sensores-max', String(payload.missingMax));
  if (payload.frozenMax != null && payload.frozenMax !== '') args.push('--sensores-congelados-max', String(payload.frozenMax));
  if (payload.visualLab === false) args.push('--sin-visual-lab');

  return args;
}

function runImuInference(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      window: payload.window,
      mask: payload.mask,
      tcnPath: resolveRepoPath(payload.tcnPath) || path.join(IMUS_VEN_ROOT, 'TCN', 'models', 'tcn_sanitizer_best.pt'),
      ppoPath: resolveRepoPath(payload.ppoPath) || path.join(IMUS_VEN_ROOT, 'PPO', 'models', 'BEST_PPO.pt'),
    });
    const proc = spawn(
      PYTHON_BIN,
      [PPO_INFERENCE_CLI],
      { cwd: path.join(IMUS_VEN_ROOT, 'PPO'), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `inferencia_ppo_cli exit ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.salida && !parsed.final) {
          parsed.final = parsed.salida;
        }
        resolve(parsed);
      } catch (error) {
        reject(new Error(`JSON inferencia invalido: ${error.message}`));
      }
    });
    proc.stdin.write(body);
    proc.stdin.end();
  });
}

function sanitizePathSegment(value) {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 120) || 'dataset';
}

function decodeWebSocketFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset++];
    const second = buffer[offset++];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    const masked = (second & 0x80) !== 0;
    if (length === 126) {
      if (offset + 2 > buffer.length) break;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (offset + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    if (offset + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    offset += length;
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    if (opcode === 0x1) messages.push(payload.toString('utf8'));
  }
  return messages;
}

function sendWebSocket(socket, payload) {
  if (socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = data.length < 126
    ? Buffer.from([0x81, data.length])
    : Buffer.concat([Buffer.from([0x81, 126]), uint16(data.length)]);
  socket.write(Buffer.concat([header, data]));
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}
