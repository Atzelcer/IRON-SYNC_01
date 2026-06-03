import { BONE_ORDER } from '../core/boneMap.js';

export const UNIFIED_STAGES = {
  idle: 'idle',
  prerequisites: 'prerequisites',
  mega_cal: 'mega_cal',
  stabilize: 'stabilize',
  mesh_pose: 'mesh_pose',
  capture_a: 'capture_a',
  capture_b: 'capture_b',
  apply: 'apply',
  ready: 'ready',
  failed: 'failed',
  cancelled: 'cancelled',
};

const STAGE_LABELS = {
  [UNIFIED_STAGES.prerequisites]: 'Comprobando requisitos',
  [UNIFIED_STAGES.mega_cal]: 'Calibrando IMUs (Mega)',
  [UNIFIED_STAGES.stabilize]: 'Estabilizando señal',
  [UNIFIED_STAGES.mesh_pose]: 'Pose base del skeletal mesh',
  [UNIFIED_STAGES.capture_a]: 'Captura A — transferencia base',
  [UNIFIED_STAGES.capture_b]: 'Captura B — verificación',
  [UNIFIED_STAGES.apply]: 'Aplicando corrección al mesh',
  [UNIFIED_STAGES.ready]: 'Listo — mueve el traje',
  [UNIFIED_STAGES.failed]: 'Falló',
  [UNIFIED_STAGES.cancelled]: 'Cancelado',
};

export class UnifiedCalibrationOrchestrator {
  constructor(hooks) {
    this.hooks = hooks;
    this.running = false;
    this.cancelled = false;
    this.stage = UNIFIED_STAGES.idle;
    this.progress = 0;
    this.detail = '';
    this._megaWaiter = null;
  }

  isRunning() {
    return this.running;
  }

  cancel() {
    this.cancelled = true;
    this._rejectMegaWait?.(new Error('cancelled'));
  }

  onArduinoStatus(stateText = '', progress = 0) {
    if (!this._megaWaiter) return false;

    const value = String(stateText).toLowerCase();
    if (value.includes('cal_progress') || value.includes('calibrando') || value.includes('orden de calibracion')) {
      this.#emit(UNIFIED_STAGES.mega_cal, Math.max(this.progress, Number(progress) || 8), stateText);
    }

    if (
      value.includes('calibration_done')
      || value.includes('cal_ok')
      || value.includes('calibracion ok')
      || value.includes('calibracion y sincronizacion completada')
      || value.includes('transferencia activa')
      || value.includes('cal_partial')
      || value.includes('calibracion parcial')
    ) {
      const partial = value.includes('parcial')
        || value.includes('partial')
        || value.includes('cal_partial');
      this._resolveMegaWait?.({ ok: true, partial, stateText });
      return true;
    }

    if (value.includes('cal_error') || value.startsWith('error_cal')) {
      this._resolveMegaWait?.({ ok: false, partial: false, stateText });
      return true;
    }

    return false;
  }

  async run(options = {}) {
    if (this.running) {
      throw new Error('Ya hay una calibracion unificada en curso');
    }

    this.running = true;
    this.cancelled = false;
    this.stage = UNIFIED_STAGES.prerequisites;
    this.progress = 0;
    this.detail = '';

    const referencePose = options.referencePose ?? 'unreal-initial';
    const minOnline = options.minOnline ?? 1;
    const requireHardwareConnected = options.requireHardwareConnected !== false;
    const megaPrimary = options.megaPrimary !== false;

    try {
      this.#emit(UNIFIED_STAGES.prerequisites, 2, 'Comprobando relay, hardware y skeletal mesh');

      const prereq = this.hooks.checkPrerequisites({ requireHardwareConnected });
      if (!prereq.ok) {
        throw new Error(prereq.missing.join(' | '));
      }

      this.#throwIfCancelled();
      this.#emit(UNIFIED_STAGES.mega_cal, 5, 'Ponte el traje y quédate quieto — calibrando Mega (golden)');
      this.hooks.prepareForMegaCalibration?.();
      await this.#waitMegaCalibration({ timeoutMs: options.megaTimeoutMs ?? 95000 });
      this.#throwIfCancelled();

      this.hooks.resumeLiveStream?.();
      await this.hooks.delay(options.streamBootMs ?? 800);

      this.#emit(UNIFIED_STAGES.stabilize, 42, 'Esperando frames IS del ESP32 (relay abierto)');
      await this.#waitStableSignal({
        minFrames: options.minStableFrames ?? 12,
        maxJitter: options.maxJitter ?? 28,
        minOnline,
        timeoutMs: options.stabilizeTimeoutMs ?? 22000,
      });
      this.#throwIfCancelled();

      this.#emit(UNIFIED_STAGES.mesh_pose, 58, `Alineando mesh (${referencePose})`);
      this.hooks.setMeshReferencePose(referencePose);
      await this.hooks.delay(options.poseSettleMs ?? 400);
      this.#throwIfCancelled();

      this.#emit(UNIFIED_STAGES.capture_a, 68, 'Captura A — quieto como el maniquí 3D');
      this.hooks.captureBase();
      await this.hooks.delay(options.captureDelayMs ?? 900);
      this.#throwIfCancelled();

      this.#emit(UNIFIED_STAGES.capture_b, 82, 'Captura B — sigue quieto');
      await this.hooks.delay(options.countdownMs ?? 1200);
      this.hooks.captureVerification();
      await this.hooks.delay(options.captureDelayMs ?? 900);
      this.#throwIfCancelled();

      this.#emit(UNIFIED_STAGES.apply, 92, megaPrimary
        ? 'Guardando base IMU en laboratorio (vectores mesh en el lab)'
        : 'Aplicando offsets al skeletal mesh');
      let applied = this.hooks.applyProfile?.() ?? false;
      if (!applied && megaPrimary) {
        applied = this.hooks.commitMasterFromCaptureA?.() ?? false;
      }
      if (!applied && !megaPrimary) {
        throw new Error('No se pudo aplicar el perfil — capturas A/B incompletas');
      }
      if (!applied && megaPrimary) {
        throw new Error('Mega calibrado pero sin frames para base IMU — quédate quieto y reintenta');
      }

      this.hooks.enableLiveMesh?.();
      const summary = this.hooks.getCalibrationSummary?.() ?? {};
      const lowQuality = (summary.rows ?? []).filter((row) => row.quality < 75).map((row) => row.alias);

      this.#emit(
        UNIFIED_STAGES.ready,
        100,
        lowQuality.length
          ? `Listo con advertencias: revisa ${lowQuality.join(', ')}`
          : 'Traje y mesh alineados — puedes moverte',
      );

      return {
        ok: true,
        referencePose,
        summary,
        lowQuality,
      };
    } catch (error) {
      const cancelled = this.cancelled || error.message === 'cancelled';
      this.#emit(
        cancelled ? UNIFIED_STAGES.cancelled : UNIFIED_STAGES.failed,
        this.progress,
        cancelled ? 'Calibracion cancelada' : error.message,
      );
      return { ok: false, cancelled, error: error.message };
    } finally {
      this.running = false;
      this._megaWaiter = null;
      this._resolveMegaWait = null;
      this._rejectMegaWait = null;
    }
  }

  async #waitMegaCalibration({ timeoutMs }) {
    const result = await new Promise((resolve, reject) => {
      let timer = null;
      this._megaWaiter = true;
      this._resolveMegaWait = (payload) => {
        if (timer) window.clearTimeout(timer);
        this._megaWaiter = false;
        resolve(payload);
      };
      this._rejectMegaWait = reject;
      this.hooks.sendMegaCalibration?.();
      timer = window.setTimeout(() => {
        this._megaWaiter = false;
        reject(new Error('Tiempo agotado esperando CALIBRATION_DONE del Mega'));
      }, timeoutMs);
    }).catch((error) => {
      if (this.cancelled) throw new Error('cancelled');
      throw error;
    });

    if (!result.ok) {
      throw new Error(result.stateText || 'Calibracion Mega fallida');
    }

    if (result.partial) {
      this.detail = 'Calibracion Mega parcial — continuando con sensores activos';
    }
  }

  async #waitStableSignal({ minFrames, maxJitter, minOnline, timeoutMs }) {
    const started = performance.now();

    while (performance.now() - started < timeoutMs) {
      this.#throwIfCancelled();
      const metrics = this.hooks.getStabilityMetrics?.();

      if (
        metrics
        && metrics.sampleCount >= minFrames
        && metrics.online >= minOnline
        && metrics.jitterMs <= maxJitter
      ) {
        return metrics;
      }
      await this.hooks.delay(130);
    }

    const metrics = this.hooks.getStabilityMetrics?.();
    throw new Error(
      metrics?.relayOpen
        ? 'Sin frames IS en el laboratorio — abre relay ws://127.0.0.1:8767, reflashea ESP32 (UDP 1024) y no uses solo el Serial USB del Mega'
        : 'Abre relay ESP32/Mega antes de calibrar',
    );
  }

  #throwIfCancelled() {
    if (this.cancelled) throw new Error('cancelled');
  }

  #emit(stage, progress, detail) {
    this.stage = stage;
    this.progress = Math.max(0, Math.min(100, progress));
    this.detail = detail;
    this.hooks.onStageUpdate?.({
      stage,
      progress: this.progress,
      label: STAGE_LABELS[stage] ?? stage,
      detail,
    });
  }
}

export function countMappedBones(mapper) {
  if (!mapper?.getBones) return 0;
  let count = 0;
  for (const alias of BONE_ORDER) {
    if (mapper.getBones().has(alias)) count += 1;
  }
  return count;
}
