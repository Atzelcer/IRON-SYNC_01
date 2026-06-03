import { BONE_ORDER, BONE_LABELS, MEGA_SENSOR_INDEX_ORDER } from '../core/boneMap.js';

const STALE_SENSOR_MS = 1500;

export class ArduinoConnection {
  constructor({ onPacket, onStatus, onRelayStats, onSensors, onSerialLog, onRelayEvent } = {}) {
    this.socket = null;
    this.connected = false;
    this.frameCount = 0;
    this.lastFrameAt = 0;
    this.sensorState = Object.fromEntries(BONE_ORDER.map((alias) => [alias, {
      alias,
      label: BONE_LABELS[alias] ?? alias,
      online: false,
      lastSeen: 0,
      state: 'sin datos',
    }]));
    this.onPacket = onPacket;
    this.onStatus = onStatus;
    this.onRelayStats = onRelayStats;
    this.onSensors = onSensors;
    this.onSerialLog = onSerialLog;
    this.onRelayEvent = onRelayEvent;
    this.staleTimer = null;
  }

  connect(url) {
    this.disconnect();
    this.socket = new WebSocket(url);
    this.onStatus?.({ state: 'Conectando', progress: 0, frames: this.frameCount });

    this.socket.addEventListener('open', () => {
      this.connected = true;
      this.onStatus?.({ state: 'Relay conectado. Esperando ESP32_HELLO', progress: 0, frames: this.frameCount });
      this.staleTimer = window.setInterval(() => this.#markStaleSensors(), 500);
    });

    this.socket.addEventListener('message', (event) => this.#handleMessage(event.data));
    this.socket.addEventListener('close', () => {
      this.connected = false;
      window.clearInterval(this.staleTimer);
      this.onStatus?.({ state: 'Desconectado', progress: 0, frames: this.frameCount });
    });
    this.socket.addEventListener('error', () => {
      this.onStatus?.({ state: 'Error conexion Arduino', progress: 0, frames: this.frameCount });
    });
  }

  disconnect() {
    window.clearInterval(this.staleTimer);
    if (this.socket) this.socket.close();
    this.socket = null;
    this.connected = false;
  }

  connectHardware() {
    this.#send({ type: 'connect-hardware' });
  }

  startCalibration() {
    this.#send({ type: 'start-calibration' });
  }

  stopData() {
    this.#send({ type: 'stop-data' });
  }

  disconnectHardware() {
    this.#send({ type: 'disconnect-hardware' });
  }

  closeRelay() {
    this.#send({ type: 'close-relay' });
  }

  endHardwareSession() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.stopData();
      this.disconnectHardware();
    }
  }

  tearDownSession() {
    this.endHardwareSession();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.closeRelay();
    }
  }

  resetSensors() {
    this.#send({ type: 'command', command: 'RESET_IMUS' });
  }

  status() {
    this.#send({ type: 'command', command: 'STATUS' });
  }

  diagnostics() {
    this.#send({ type: 'diagnostics' });
  }

  sendCommand(command) {
    const value = String(command ?? '').trim();
    if (!value) return;
    this.#send({ type: 'command', command: value });
  }

  saveTrainingDataset(payload) {
    this.#send({ type: 'save-training-dataset', ...payload });
  }

  listTrainingCollections() {
    this.#send({ type: 'list-training-collections' });
  }

  createTrainingCollection() {
    this.#send({ type: 'create-training-collection' });
  }

  loadTrainingCollection(stamp) {
    const value = String(stamp ?? '').trim();
    if (!value) return;
    this.#send({ type: 'load-training-collection', stamp: value });
  }

  saveMasterCalibration(payload) {
    this.#send({ type: 'save-master-calibration', ...payload });
  }

  startPpoTraining(options = {}) {
    this.#send({ type: 'start-ppo-training', ...options });
  }

  stopPpoTraining() {
    this.#send({ type: 'stop-ppo-training' });
  }

  verifyTcnModel(tcnPath) {
    this.#send({ type: 'verify-tcn-model', tcnPath });
  }

  runImuInference(payload) {
    this.#send({ type: 'imu-inference', ...payload });
  }

  saveKalmanConfig(config) {
    this.#send({ type: 'save-kalman-config', config });
  }

  fetchPpoMetrics() {
    this.#send({ type: 'get-ppo-metrics' });
  }

  rescan() {
    this.#send({ type: 'command', command: 'RESCAN' });
  }

  #send(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  #handleMessage(raw) {
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload.type === 'mega-serial') {
      this.onSerialLog?.(payload);
      return;
    }

    if (
      payload.type === 'ppo-training-status'
      || payload.type === 'ppo-live-frame'
      || payload.type === 'tcn-model-status'
      || payload.type === 'imu-inference-result'
      || payload.type === 'ppo-metrics'
    ) {
      this.onRelayEvent?.(payload);
      return;
    }

    if (payload.type === 'relay-stats') {
      this.onRelayStats?.(payload);
      return;
    }

    if (
      payload.type === 'training-collections'
      || payload.type === 'training-collection-created'
      || payload.type === 'training-collection-loaded'
    ) {
      this.onRelayEvent?.(payload);
      return;
    }

    if (payload.type === 'status') {
      this.onStatus?.(payload);
      return;
    }

    if (payload.type === 'sensor-state') {
      this.#setSensorState(payload.alias, payload.state, payload.online);
      return;
    }

    if (payload.type === 'frame') {
      const rotationCount = Array.isArray(payload.rotations) ? payload.rotations.length : 0;
      if (rotationCount === 0) {
        return;
      }

      this.frameCount += 1;
      this.lastFrameAt = performance.now();
      this.#touchActiveSensorsFromMask(payload);
      this.#touchActiveSensors(payload);
      this.onPacket?.(payload);
      this.onStatus?.({
        type: 'frame',
        state: payload.activeSensors === BONE_ORDER.length
          ? `Stream IS ${rotationCount} rot · 15 sensores`
          : `Stream IS ${rotationCount} rot · ${payload.activeSensors}/15`,
        progress: undefined,
        frames: this.frameCount,
        relayParsedIs: payload.relayParsedIs,
        liveFrame: true,
      });
    }
  }

  #touchActiveSensorsFromMask(packet) {
    const mask = Number(packet.mask) || 0;
    const now = performance.now();

    for (let i = 0; i < MEGA_SENSOR_INDEX_ORDER.length; i++) {
      const alias = MEGA_SENSOR_INDEX_ORDER[i];
      if (!this.sensorState[alias]) continue;
      if ((mask & (1 << i)) === 0) continue;

      this.sensorState[alias] = {
        ...this.sensorState[alias],
        online: true,
        lastSeen: now,
        state: 'datos ok',
      };
    }
  }

  #touchActiveSensors(packet) {
    const now = performance.now();
    for (const item of packet.rotations ?? []) {
      if (!item.alias || !this.sensorState[item.alias]) continue;
      this.sensorState[item.alias] = {
        ...this.sensorState[item.alias],
        online: true,
        lastSeen: now,
        state: 'datos ok',
      };
    }
    this.#emitSensors();
  }

  #setSensorState(alias, state, online = state !== 'OFFLINE' && state !== 'LOST') {
    if (!this.sensorState[alias]) return;
    this.sensorState[alias] = {
      ...this.sensorState[alias],
      online,
      lastSeen: online ? performance.now() : this.sensorState[alias].lastSeen,
      state: translateState(state),
    };
    this.#emitSensors();
  }

  #markStaleSensors() {
    const now = performance.now();
    let changed = false;
    for (const alias of BONE_ORDER) {
      const item = this.sensorState[alias];
      if (item.online && now - item.lastSeen > STALE_SENSOR_MS) {
        this.sensorState[alias] = { ...item, online: false, state: 'sin datos' };
        changed = true;
      }
    }
    if (changed) this.#emitSensors();
  }

  #emitSensors() {
    this.onSensors?.(BONE_ORDER.map((alias) => this.sensorState[alias]));
  }
}

function translateState(state) {
  const value = String(state ?? '').toUpperCase();
  if (value === 'CAL_OK') return 'calibrado';
  if (value === 'RECOVERED') return 'recuperado';
  if (value === 'LOST') return 'perdido';
  if (value === 'OFFLINE') return 'desconectado';
  return String(state ?? 'sin datos').toLowerCase();
}
