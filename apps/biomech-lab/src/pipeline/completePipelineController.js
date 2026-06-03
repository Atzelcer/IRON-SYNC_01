/**
 * Controlador del pipeline completo: verifica modelos, coordina etapas y
 * expone una salida de orquestador compatible con Unreal.
 */
import { FUSION_ACTIONS, PIPELINE_MODEL_SLOTS } from './completePipelineCatalog.js';
import { verifyModelsHttp } from '../io/ppoLabApi.js';

const COMBAT_ACTIONS = new Set(['PUNCH_RIGHT', 'PUNCH_LEFT', 'KICK_RIGHT', 'KICK_LEFT']);

export class CompletePipelineController {
  constructor() {
    this.slots = Object.fromEntries(
      PIPELINE_MODEL_SLOTS.map((s) => [s.id, { ...s, status: 'pending', message: '' }]),
    );
    this.paths = Object.fromEntries(PIPELINE_MODEL_SLOTS.map((s) => [s.id, s.path]));
    this.active = false;
    this.paused = false;
    this.mode = 'idle'; // idle | hardware | synthetic
    this.frameIndex = 0;
    this.orchestrator = {
      action: '-',
      actionEs: '-',
      confidence: 0,
      missing: [],
      vectorPreview: '',
      execution: null,
      attention: null,
    };
    this.stageOutputs = {
      tcn: null,
      ppo: null,
      emg: null,
      ecg: null,
      fusion: null,
      kalman: null,
    };
    this.kalmanEnabled = true;
  }

  allRequiredLoaded() {
    return PIPELINE_MODEL_SLOTS.filter((s) => s.required).every((s) => this.slots[s.id].status === 'ok');
  }

  async loadAll(getPathFn) {
    const items = PIPELINE_MODEL_SLOTS.map((slot) => ({
      id: slot.id,
      path: getPathFn(slot.id) || slot.path,
    }));
    for (const item of items) {
      this.slots[item.id].status = 'loading';
      this.slots[item.id].message = 'Verificando...';
    }
    const results = await verifyModelsHttp(items);
    for (const row of results) {
      if (!this.slots[row.id]) continue;
      this.slots[row.id].status = row.ok ? 'ok' : 'error';
      this.slots[row.id].message = row.message ?? (row.ok ? 'OK' : 'Falta archivo');
      this.paths[row.id] = row.path;
    }
    this.#updateMissing();
    return this.allRequiredLoaded();
  }

  #updateMissing() {
    this.orchestrator.missing = PIPELINE_MODEL_SLOTS
      .filter((s) => s.required && this.slots[s.id].status !== 'ok')
      .map((s) => s.label);
  }

  start(mode = 'hardware') {
    if (!this.allRequiredLoaded()) return false;
    this.active = true;
    this.paused = false;
    this.mode = mode;
    this.frameIndex = 0;
    return true;
  }

  stop() {
    this.active = false;
    this.paused = false;
    this.mode = 'idle';
  }

  pause() {
    if (this.active) this.paused = true;
  }

  resume() {
    if (this.active) this.paused = false;
  }

  tickSynthetic({ imuPoseWindow, emgRaw = 0.5, ecgStress = 0.3 }) {
    this.frameIndex += 1;
    const t = this.frameIndex / 50;

    this.stageOutputs.tcn = { ok: true, snr: 0.88 + Math.sin(t) * 0.04 };
    this.stageOutputs.ppo = {
      ok: true,
      deltaNorm: 2.1 + Math.cos(t * 1.3),
      pose: imuPoseWindow?.at(-1) ?? null,
    };
    this.stageOutputs.emg = {
      ok: true,
      probs: this.#softmax3([0.2 + emgRaw * 0.2, 0.35, 0.45 + emgRaw * 0.3]),
      label: ['LOW', 'MID', 'HIGH'],
    };
    this.stageOutputs.ecg = {
      ok: true,
      probs: this.#softmax3([0.5 - ecgStress * 0.2, 0.25, 0.25 + ecgStress * 0.35]),
      label: ['CALM', 'TENSION', 'STRESS'],
    };

    const profile = this.#syntheticMotionProfile(t);
    return this.#commitFusion({
      scores: this.#scoreFusionActions({
        emgProbs: this.stageOutputs.emg.probs,
        ecgProbs: this.stageOutputs.ecg.probs,
        ...profile,
      }),
      profile,
      emgProbs: this.stageOutputs.emg.probs,
      ecgProbs: this.stageOutputs.ecg.probs,
      source: 'synthetic',
    });
  }

  ingestHardwareFrame({ imuResult, emgPacket, ecgPacket }) {
    this.frameIndex += 1;
    this.stageOutputs.tcn = { ok: Boolean(imuResult?.tcn), frame: imuResult?.tcn?.length ?? 0 };
    this.stageOutputs.ppo = { ok: Boolean(imuResult?.ppo ?? imuResult?.final), frame: imuResult?.final?.length ?? 0 };
    if (emgPacket) {
      this.stageOutputs.emg = { ok: true, raw: emgPacket.raw, intensity: emgPacket.intensity };
    }
    if (ecgPacket) {
      this.stageOutputs.ecg = {
        ok: true,
        raw: ecgPacket.raw,
        stress: Number(ecgPacket.loPlus ?? 0) - Number(ecgPacket.loMinus ?? 0),
      };
    }

    const motion = Math.min(1, Math.max(0, Number(emgPacket?.intensity ?? 0)));
    const stress = ecgPacket
      ? Math.min(1, Math.max(0, Number(ecgPacket.loPlus ?? 0) - Number(ecgPacket.loMinus ?? 0) + 0.5))
      : 0.35;
    const emgProbs = this.#softmax3([0.55 - motion, 0.25 + motion * 0.4, 0.2 + motion]);
    const ecgProbs = this.#softmax3([0.6 - stress, 0.25 + stress * 0.3, 0.15 + stress]);
    const profile = {
      legEnergy: motion,
      armEnergy: Math.min(1, motion * 0.9 + stress * 0.25),
      torsoEnergy: Math.min(1, motion * 0.45),
      symmetry: 0.75,
      verticalBurst: motion > 0.82 ? motion : 0,
      stanceLow: motion > 0.35 && motion < 0.62 ? 0.45 : 0.1,
    };

    return this.#commitFusion({
      scores: this.#scoreFusionActions({ emgProbs, ecgProbs, ...profile }),
      profile,
      emgProbs,
      ecgProbs,
      source: 'hardware',
    });
  }

  #commitFusion({ scores, profile, emgProbs, ecgProbs, source }) {
    const idx = scores.indexOf(Math.max(...scores));
    const conf = confidenceFromScores(scores, idx);
    const action = FUSION_ACTIONS[idx] ?? FUSION_ACTIONS[0];
    this.orchestrator.action = action.id;
    this.orchestrator.actionEs = action.es;
    this.orchestrator.confidence = conf;
    this.orchestrator.execution = this.#executionParamsFor(action.id, conf, profile);
    this.orchestrator.attention = this.#attentionWeights(profile, emgProbs, ecgProbs);
    this.stageOutputs.fusion = {
      ok: true,
      scores,
      action: action.id,
      execution: this.orchestrator.execution,
      attention: this.orchestrator.attention,
    };
    this.stageOutputs.kalman = { ok: this.kalmanEnabled, smoothed: this.kalmanEnabled };
    this.orchestrator.vectorPreview = [
      `${source} IMU/PPO L:${profile.legEnergy.toFixed(2)} A:${profile.armEnergy.toFixed(2)}`,
      `EMG ${emgProbs.map((x) => x.toFixed(2)).join('/')}`,
      `ECG ${ecgProbs.map((x) => x.toFixed(2)).join('/')}`,
      `MLP ${action.es} ${(conf * 100).toFixed(0)}%`,
    ].join(' | ');
    return {
      action: action.id,
      actionEs: action.es,
      confidence: conf,
      execution: this.orchestrator.execution,
      attention: this.orchestrator.attention,
      stages: { ...this.stageOutputs },
    };
  }

  #syntheticMotionProfile(t) {
    const gait = Math.abs(Math.sin(t * 2.4));
    const fastGait = Math.abs(Math.sin(t * 4.6));
    const arms = Math.abs(Math.sin(t * 1.7 + 0.8));
    const burst = Math.max(0, Math.sin(t * 0.73 - 0.4));
    return {
      legEnergy: Math.min(1, 0.18 + gait * 0.55 + fastGait * 0.2),
      armEnergy: Math.min(1, 0.16 + arms * 0.62 + burst * 0.18),
      torsoEnergy: Math.min(1, 0.12 + Math.abs(Math.sin(t * 1.1)) * 0.38),
      symmetry: 1 - Math.min(0.55, Math.abs(Math.sin(t * 0.51)) * 0.55),
      verticalBurst: Math.max(0, Math.sin(t * 1.35)) ** 4,
      stanceLow: Math.max(0, Math.sin(t * 0.67 + 1.3)) ** 3,
    };
  }

  #scoreFusionActions({ emgProbs, ecgProbs, legEnergy, armEnergy, torsoEnergy, symmetry, verticalBurst, stanceLow }) {
    const emgLow = emgProbs[0] ?? 0;
    const emgMid = emgProbs[1] ?? 0;
    const emgHigh = emgProbs[2] ?? 0;
    const calm = ecgProbs[0] ?? 0;
    const tension = ecgProbs[1] ?? 0;
    const stress = ecgProbs[2] ?? 0;
    const lowMotion = 1 - Math.min(1, (legEnergy + armEnergy + torsoEnergy) / 2.2);
    const asymmetry = 1 - symmetry;
    const byId = {
      IDLE: lowMotion * 0.95 + emgLow * 0.45 + calm * 0.35,
      WALK: legEnergy * 0.62 + symmetry * 0.28 + emgMid * 0.3 + calm * 0.12,
      RUN: legEnergy * 0.82 + emgHigh * 0.45 + stress * 0.22,
      JUMP: verticalBurst * 0.9 + legEnergy * 0.35 + emgHigh * 0.25,
      CROUCH: stanceLow * 0.78 + torsoEnergy * 0.24 + emgMid * 0.2,
      PUNCH_RIGHT: armEnergy * 0.52 + asymmetry * 0.34 + emgHigh * 0.36 + stress * 0.18,
      PUNCH_LEFT: armEnergy * 0.5 + asymmetry * 0.3 + emgHigh * 0.34 + tension * 0.18,
      KICK_RIGHT: legEnergy * 0.55 + asymmetry * 0.28 + emgHigh * 0.3 + tension * 0.16,
      KICK_LEFT: legEnergy * 0.52 + asymmetry * 0.26 + emgHigh * 0.28 + stress * 0.15,
      BLOCK: armEnergy * 0.34 + torsoEnergy * 0.28 + emgHigh * 0.28 + stress * 0.32,
      WAVE: armEnergy * 0.42 + emgMid * 0.28 + calm * 0.24 + lowMotion * 0.2,
      SHOOT: armEnergy * 0.36 + lowMotion * 0.32 + stress * 0.45 + emgMid * 0.2,
      FLY: armEnergy * 0.5 + torsoEnergy * 0.32 + symmetry * 0.22 + tension * 0.18,
    };
    return FUSION_ACTIONS.map((action) => Math.max(0.001, byId[action.id] ?? 0.001));
  }

  #executionParamsFor(action, confidence, profile) {
    const energy = Math.min(1, Math.max(profile.legEnergy ?? 0, profile.armEnergy ?? 0, profile.torsoEnergy ?? 0));
    const fast = action === 'RUN' || COMBAT_ACTIONS.has(action);
    return {
      intensity: Number(Math.min(1, 0.35 + energy * 0.5 + confidence * 0.15).toFixed(3)),
      durationMs: fast ? 620 : action === 'WALK' ? 980 : action === 'FLY' ? 1350 : 820,
      velocity: Number((fast ? 0.86 : 0.52 + energy * 0.25).toFixed(3)),
      amplitude: Number((0.45 + energy * 0.45).toFixed(3)),
      smoothing: this.kalmanEnabled ? 0.72 : 0.35,
      force: Number((0.2 + confidence * 0.55 + energy * 0.25).toFixed(3)),
    };
  }

  #attentionWeights(profile, emgP, ecgP) {
    const raw = [
      0.35 + profile.legEnergy + profile.torsoEnergy * 0.35,
      0.25 + (emgP[2] ?? 0) + profile.armEnergy * 0.35,
      0.18 + (ecgP[2] ?? 0) * 0.9,
      0.2 + profile.symmetry * 0.4 + profile.verticalBurst * 0.3,
    ];
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    return raw.map((x) => Number((x / sum).toFixed(3)));
  }

  #softmax3(v) {
    const m = Math.max(...v);
    const ex = v.map((x) => Math.exp(x - m));
    const s = ex.reduce((a, b) => a + b, 0);
    return ex.map((x) => x / s);
  }
}

function confidenceFromScores(scores, winnerIndex) {
  const top = scores[winnerIndex] ?? 0;
  const sorted = [...scores].sort((a, b) => b - a);
  const second = sorted[1] ?? 0;
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const contrast = top / (mean * 1.6 + 1e-6);
  const margin = Math.max(0, top - second) / (top + 1e-6);
  return Math.min(0.95, Math.max(0.35, 0.45 + contrast * 0.35 + margin * 0.2));
}
