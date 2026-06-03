/**
 * Pipeline inferencia IMU: calibrado → TCN → PPO → Kalman opcional.
 * Kalman solo aplica suavizado configurable (no entrenado).
 */
import { BONE_ORDER } from '../core/boneMap.js';

const WINDOW = 30;

export class ImuAiPipeline {
  constructor(options = {}) {
    this.tcnPath = options.tcnPath ?? '';
    this.ppoPath = options.ppoPath ?? '';
    this.kalmanEnabled = Boolean(options.kalmanEnabled);
    this.kalmanConfig = options.kalmanConfig ?? null;
    this.minActiveSensors = options.minActiveSensors ?? 12;
    this.active = false;
    this.paused = false;
    this.buffer = [];
    this.frameIndex = 0;
    this.lastLatencyMs = 0;
    this.lastStages = {
      raw: null,
      calibrated: null,
      tcn: null,
      ppo: null,
      kalman: null,
      final: null,
    };
    this.sensorStatus = BONE_ORDER.map((bone) => ({ bone, active: false, frozen: false }));
    this.logs = [];
  }

  configure({ tcnPath, ppoPath, kalmanEnabled, kalmanConfig }) {
    if (tcnPath !== undefined) this.tcnPath = tcnPath;
    if (ppoPath !== undefined) this.ppoPath = ppoPath;
    if (kalmanEnabled !== undefined) this.kalmanEnabled = kalmanEnabled;
    if (kalmanConfig !== undefined) this.kalmanConfig = kalmanConfig;
    this.#log('Configuracion actualizada');
  }

  start() {
    this.active = true;
    this.paused = false;
    this.buffer = [];
    this.frameIndex = 0;
    this.#log('Simulacion IA activada — esperando 15 IMU');
  }

  pause() {
    this.paused = true;
    this.#log('Simulacion IA en pausa');
  }

  resume() {
    this.paused = false;
    this.#log('Simulacion IA reanudada');
  }

  stop() {
    this.active = false;
    this.paused = false;
    this.#log('Simulacion IA detenida');
  }

  resetFilters() {
    this.buffer = [];
    this.frameIndex = 0;
    this.#log('Filtros y buffer reiniciados');
  }

  /**
   * @param {object} packet — pose calibrada { calibratedPose, mask, rotations }
   * @param {function} inferFn — async (window, mask) => stages dict (desde relay Python)
   */
  async ingestCalibratedPacket(packet, inferFn) {
    if (!this.active || this.paused) return null;
    const t0 = performance.now();
    const pose = packet?.calibratedPose ?? packet?.rotations ?? null;
    const mask = packet?.mask ?? [];
    if (!pose) return null;

    this.#updateSensorStatus(mask);
    const activeCount = this.sensorStatus.filter((s) => s.active).length;
    if (activeCount < this.minActiveSensors) {
      this.#log(`Esperando sensores: ${activeCount}/15 activos`);
      return null;
    }

    const frame = this.#poseToArray(pose);
    this.buffer.push({ frame, mask: [...mask] });
    if (this.buffer.length > WINDOW) this.buffer.shift();
    this.frameIndex += 1;

    this.lastStages.raw = frame;
    this.lastStages.calibrated = frame;

    if (this.buffer.length < WINDOW || typeof inferFn !== 'function') {
      this.lastLatencyMs = performance.now() - t0;
      return { ...this.lastStages, waitingWindow: this.buffer.length, frameIndex: this.frameIndex };
    }

    const window = this.buffer.map((b) => b.frame);
    const maskWindow = this.buffer.map((b) => b.mask);
    try {
      const result = await inferFn({ window, mask: maskWindow, tcnPath: this.tcnPath, ppoPath: this.ppoPath, kalman: this.kalmanEnabled, kalmanConfig: this.kalmanConfig });
      const last = result?.final?.[WINDOW - 1] ?? result?.ppo?.[WINDOW - 1] ?? result?.tcn?.[WINDOW - 1] ?? frame;
      this.lastStages.tcn = result?.tcn?.[WINDOW - 1] ?? frame;
      this.lastStages.ppo = result?.ppo?.[WINDOW - 1] ?? this.lastStages.tcn;
      this.lastStages.kalman = this.kalmanEnabled ? (result?.kalman?.[WINDOW - 1] ?? this.lastStages.ppo) : null;
      this.lastStages.final = last;
    } catch (error) {
      this.#log(`Inferencia: ${error.message}`);
      this.lastStages.tcn = frame;
      this.lastStages.ppo = frame;
      this.lastStages.final = frame;
    }

    this.lastLatencyMs = performance.now() - t0;
    return {
      ...this.lastStages,
      frameIndex: this.frameIndex,
      latencyMs: this.lastLatencyMs,
      activeSensors: activeCount,
    };
  }

  exportLogs() {
    return {
      schema: 'ironsync.imus_ven.ia_simulation_log.v1',
      exportedAt: new Date().toISOString(),
      tcnPath: this.tcnPath,
      ppoPath: this.ppoPath,
      kalmanEnabled: this.kalmanEnabled,
      entries: [...this.logs],
    };
  }

  #poseToArray(pose) {
    const out = [];
    for (const bone of BONE_ORDER) {
      const r = pose[bone] ?? { rx: 0, ry: 0, rz: 0 };
      out.push([Number(r.rx) || 0, Number(r.ry) || 0, Number(r.rz) || 0]);
    }
    return out;
  }

  #updateSensorStatus(mask) {
    for (let i = 0; i < this.sensorStatus.length; i += 1) {
      this.sensorStatus[i].active = Number(mask[i]) > 0;
    }
  }

  #log(message) {
    this.logs.push({ t: Date.now(), message });
    if (this.logs.length > 500) this.logs.shift();
  }
}
