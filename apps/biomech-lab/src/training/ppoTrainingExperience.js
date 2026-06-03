import { BONE_ORDER } from '../core/boneMap.js';

/** Duracion visual del entrenamiento en el lab (~1 h). */
export const PPO_TRAINING_DURATION_MS = 60 * 60 * 1000;

/** Precision objetivo: al llegar aqui termina el entrenamiento visual. */
export const PPO_TARGET_PRECISION_PCT = 70;

const PPO_INFER_START_PCT = 54;

const CASTIGO_LABELS = {
  suavidad: 'Jitter / suavidad',
  fidelidad: 'Desviacion del target limpio',
  reposo: 'Movimiento en reposo',
  spike: 'Salto brusco (>15°)',
  limite_articular: 'Limite articular',
  velocidad: 'Velocidad angular alta',
  padre_hijo: 'Incoherencia padre-hijo',
  colision: 'Colision entre huesos',
  sobre_suavizado: 'Sobre-suavizado en gesto',
};

const BONUS_LABELS = {
  bonus_estabilidad: 'Estabilidad (sin colision)',
  bonus_pose_valida: 'Pose valida',
};

export class PpoTrainingSession {
  constructor() {
    this.active = false;
    this.startedAt = 0;
    this.durationMs = PPO_TRAINING_DURATION_MS;
    this.lastRewardView = null;
    this.incidents = [];
    this.rollout = 0;
    this.step = 0;
    this.inferenciaPct = PPO_INFER_START_PCT;
    this.targetReached = false;
  }

  start(durationMs = PPO_TRAINING_DURATION_MS) {
    this.active = true;
    this.startedAt = performance.now();
    this.durationMs = durationMs;
    this.incidents = [];
    this.lastRewardView = null;
    this.rollout = 0;
    this.step = 0;
    this.inferenciaPct = PPO_INFER_START_PCT;
    this.targetReached = false;
  }

  stop() {
    this.active = false;
  }

  correctionStrength() {
    const span = PPO_TARGET_PRECISION_PCT - PPO_INFER_START_PCT;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (this.inferenciaPct - PPO_INFER_START_PCT) / span));
  }

  hasReachedTarget() {
    return this.inferenciaPct >= PPO_TARGET_PRECISION_PCT || this.targetReached;
  }

  progress(now = performance.now()) {
    if (!this.active) return { ratio: 0, remainingMs: this.durationMs, done: true };
    const elapsed = now - this.startedAt;
    const timeRatio = Math.min(1, elapsed / this.durationMs);
    const inferRatio = Math.min(
      1,
      (this.inferenciaPct - PPO_INFER_START_PCT) / (PPO_TARGET_PRECISION_PCT - PPO_INFER_START_PCT),
    );
    const ratio = Math.max(timeRatio, inferRatio);
    const done = timeRatio >= 1 || this.hasReachedTarget();
    return {
      ratio,
      remainingMs: Math.max(0, this.durationMs - elapsed),
      done,
    };
  }

  formatEta(remainingMs) {
    const totalMin = Math.ceil(remainingMs / 60_000);
    if (totalMin >= 120) return `Restante: ${totalMin} min`;
    if (totalMin <= 1) return 'Restante: < 1 min';
    return `Restante: ${totalMin} min`;
  }

  formatElapsed(now = performance.now()) {
    const elapsed = Math.max(0, now - this.startedAt);
    const min = Math.floor(elapsed / 60_000);
    const sec = Math.floor((elapsed % 60_000) / 1000);
    return `${min} min ${sec} s`;
  }

  buildChaoticPose(basePoseRows, timeSec, intensity = 1) {
    const pose = {};
    const amp = 6 + intensity * 14;
    BONE_ORDER.forEach((alias, i) => {
      const row = basePoseRows?.[i] ?? [0, 0, 0];
      const phase = i * 0.73;
      pose[alias] = {
        rx: row[0] + Math.sin(timeSec * 4.2 + phase) * amp + Math.cos(timeSec * 1.1) * amp * 0.4,
        ry: row[1] + Math.cos(timeSec * 3.5 + phase * 1.2) * amp * 0.85,
        rz: row[2] + Math.sin(timeSec * 5.1 + phase * 0.6) * amp * 0.7,
      };
    });
    return pose;
  }

  /** Mezcla ruido (TCN sucio) hacia target limpio segun precision — correccion PPO. */
  buildTrainingPose(basePoseRows, targetPoseRows, timeSec, intensity, correctionStrength) {
    const chaotic = this.buildChaoticPose(basePoseRows, timeSec, intensity * (1 - correctionStrength * 0.85));
    if (!targetPoseRows || correctionStrength <= 0.02) return chaotic;
    const pose = {};
    const w = correctionStrength;
    BONE_ORDER.forEach((alias, i) => {
      const tgt = targetPoseRows[i] ?? [0, 0, 0];
      const c = chaotic[alias];
      pose[alias] = {
        rx: c.rx * (1 - w) + tgt[0] * w,
        ry: c.ry * (1 - w) + tgt[1] * w,
        rz: c.rz * (1 - w) + tgt[2] * w,
      };
    });
    return pose;
  }

  buildRewardView(breakdown = {}, labCollisions = [], ppoCollisions = []) {
    const bd = breakdown ?? {};
    const total = Number(bd.recompensa_total ?? bd.reward ?? 0);
    const penalties = [];
    const rewards = [];

    for (const [key, label] of Object.entries(CASTIGO_LABELS)) {
      const v = Number(bd[key]);
      if (v < -0.05) penalties.push({ name: label, value: v });
    }
    for (const [key, label] of Object.entries(BONUS_LABELS)) {
      const v = Number(bd[key]);
      if (v > 0.05) rewards.push({ name: label, value: v });
    }

    for (const hit of labCollisions) {
      penalties.push({
        name: hit.label ?? `${hit.a} ↔ ${hit.b}`,
        value: hit.severity === 'critical' ? -10 : hit.severity === 'high' ? -7 : -4,
      });
    }
    for (const hit of ppoCollisions) {
      if (!labCollisions.some((c) => c.a === hit.a && c.b === hit.b)) {
        penalties.push({
          name: `[PPO] ${hit.label ?? `${hit.a}-${hit.b}`}`,
          value: hit.severity === 'critical' ? -10 : -7,
        });
      }
    }

    const components = {
      reward_limits: Number(bd.limite_articular ?? 0) >= 0 ? 0 : bd.limite_articular,
      reward_smoothness: Number(bd.suavidad ?? 0),
      reward_collision: Number(bd.colision ?? 0),
      reward_velocity: Number(bd.velocidad ?? 0),
      reward_stability: Number(bd.bonus_estabilidad ?? 0),
    };

    return {
      reward_total: total,
      ...components,
      rewards,
      penalties,
      valid: penalties.length === 0 && total > -20,
    };
  }

  recordIncidents(breakdown, labCollisions, ppoCollisions, rollout, step) {
    const now = new Date().toLocaleTimeString('es-BO', { hour12: false });
    const push = (tipo, detalle, valor) => {
      this.incidents.unshift({ ts: now, tipo, detalle, valor, rollout, step });
      if (this.incidents.length > 48) this.incidents.pop();
    };

    for (const [key, label] of Object.entries(CASTIGO_LABELS)) {
      const v = Number(breakdown?.[key]);
      if (v < -1) push('castigo', label, v.toFixed(2));
    }
    for (const hit of labCollisions) {
      push('colision', `${hit.severity}: ${hit.label}`, hit.penetration?.toFixed(3) ?? '');
    }
    for (const hit of ppoCollisions) {
      push('colision', `[proxy] ${hit.label}`, hit.severity);
    }
  }

  /** Inferencia sube ~1 h: 54% → 70% (objetivo de parada). */
  updateInferencia(progressRatio, jitter = 0) {
    const span = PPO_TARGET_PRECISION_PCT - PPO_INFER_START_PCT;
    this.inferenciaPct = PPO_INFER_START_PCT + progressRatio * span + jitter;
    if (this.inferenciaPct >= PPO_TARGET_PRECISION_PCT) {
      this.inferenciaPct = PPO_TARGET_PRECISION_PCT;
      this.targetReached = true;
    }
  }
}
