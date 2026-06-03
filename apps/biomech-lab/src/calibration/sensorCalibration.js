import { BONE_LABELS, BONE_ORDER } from '../core/boneMap.js';
import { countOnlineUpperTorso, MIN_ONLINE_SENSORS, MIN_ONLINE_UPPER_TORSO } from '../core/partialSensorMode.js';

const AXES = ['rx', 'ry', 'rz'];
const DEFAULT_CONFIG = {
  targetHz: 40,
  smoothing: 0.24,
  liveSmoothing: 0.38,
  deadzone: 0.85,
  gain: 1,
  maxRotation: 55,
};
const MAX_HISTORY = 180;
const CAPTURE_FRAMES = 45;
const STALE_MS = 1600;

export class SensorCalibrationManager {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.history = new Map();
    this.filtered = new Map();
    this.captureA = null;
    this.captureB = null;
    this.profile = null;
    this.applied = false;
    this.liveMode = false;
    this.lastPacketAt = 0;
    this.frameIntervals = [];
  }

  setConfig(config = {}) {
    this.config = normalizeConfig({ ...this.config, ...config });
  }

  observePacket(packet) {
    const now = performance.now();
    if (this.lastPacketAt) {
      this.frameIntervals.push(now - this.lastPacketAt);
      if (this.frameIntervals.length > MAX_HISTORY) this.frameIntervals.shift();
    }
    this.lastPacketAt = now;

    for (const item of packet.rotations ?? []) {
      if (!BONE_ORDER.includes(item.alias)) continue;
      const sample = {
        at: now,
        rx: Number(item.rx) || 0,
        ry: Number(item.ry) || 0,
        rz: Number(item.rz) || 0,
      };
      const samples = this.history.get(item.alias) ?? [];
      samples.push(sample);
      if (samples.length > MAX_HISTORY) samples.shift();
      this.history.set(item.alias, samples);
    }
  }

  captureBase() {
    this.captureA = this.#captureWindow();
    this.captureB = null;
    this.profile = null;
    this.applied = false;
    return this.summary();
  }

  captureVerification() {
    this.captureB = this.#captureWindow();
    this.profile = this.#buildProfile();
    this.applied = false;
    return this.summary();
  }

  applyProfile() {
    if (!this.profile) return false;
    this.applied = true;
    this.filtered.clear();
    return true;
  }

  setLiveMode(enabled) {
    this.liveMode = Boolean(enabled);
    if (enabled) {
      this.filtered.clear();
    }
  }

  reset() {
    this.captureA = null;
    this.captureB = null;
    this.profile = null;
    this.applied = false;
    this.liveMode = false;
    this.filtered.clear();
  }

  transformRotations(rotations) {
    if (!this.applied || !this.profile) return rotations;
    return rotations.map((item) => {
      const correction = this.profile.sensors[item.alias];
      if (!correction || correction.state === 'sin datos') return item;
      const previous = this.filtered.get(item.alias) ?? { rx: 0, ry: 0, rz: 0 };
      const smooth = this.liveMode
        ? (this.config.liveSmoothing ?? this.config.smoothing)
        : this.config.smoothing;
      const next = { alias: item.alias };
      for (const axis of AXES) {
        const sourceAxis = correction.axisMap?.[axis] ?? axis;
        const sign = correction.sign?.[axis] ?? 1;
        const source = Number(item[sourceAxis]) || 0;
        const raw = source - (correction.offset?.[sourceAxis] ?? 0);
        const offsetCorrected = clean(raw * sign * this.config.gain, this.config.deadzone);
        const directCorrected = clean(source * sign * this.config.gain, this.config.deadzone);
        const corrected = clamp(resolveCorrectedValue(offsetCorrected, directCorrected, this.config.deadzone), this.config.maxRotation);
        next[axis] = previous[axis] + smooth * (corrected - previous[axis]);
        if (Math.abs(next[axis]) < this.config.deadzone * 0.65) next[axis] = 0;
      }
      this.filtered.set(item.alias, next);
      return next;
    });
  }

  exportProfile({ modelInfo, mapping } = {}) {
    return {
      schema: 'ironsync.sensor-calibration.v1',
      createdAt: new Date().toISOString(),
      method: 'sensor-quieto-equivale-a-pose-base-skeletal-mesh',
      unified: this.applied,
      applied: this.applied,
      ready: this.summary().ready,
      config: this.config,
      model: modelInfo ?? null,
      mapping: mapping ?? null,
      captureA: this.captureA,
      captureB: this.captureB,
      profile: this.profile,
    };
  }

  importProfile(payload, { apply = true } = {}) {
    if (payload?.schema !== 'ironsync.sensor-calibration.v1') return false;
    this.config = normalizeConfig({ ...DEFAULT_CONFIG, ...(payload.config ?? {}) });
    this.captureA = payload.captureA ?? null;
    this.captureB = payload.captureB ?? null;
    this.profile = payload.profile ?? null;
    this.applied = Boolean(apply && this.profile);
    this.liveMode = false;
    this.filtered.clear();
    return Boolean(this.profile);
  }

  getStreamHealth() {
    const summary = this.summary();
    return {
      sampleCount: this.frameIntervals.length,
      online: summary.online,
      jitterMs: summary.jitterMs,
      realHz: summary.realHz,
    };
  }

  summary() {
    const rows = BONE_ORDER.map((alias) => this.#sensorSummary(alias));
    const onlineRows = rows.filter((row) => row.online);
    const online = onlineRows.length;
    const onlineUpper = countOnlineUpperTorso(new Set(onlineRows.map((row) => row.alias)));
    const calibratedOnline = onlineRows.filter((row) => row.quality >= 75).length;
    const avgQuality = onlineRows.length
      ? onlineRows.reduce((sum, row) => sum + row.quality, 0) / onlineRows.length
      : 0;
    const avgInterval = average(this.frameIntervals);
    const realHz = avgInterval > 0 ? 1000 / avgInterval : 0;
    const jitterMs = stddev(this.frameIntervals);
    const partialReady = online >= MIN_ONLINE_SENSORS
      && onlineUpper >= MIN_ONLINE_UPPER_TORSO
      && (this.applied || calibratedOnline >= 1 || Boolean(this.captureB));
    return {
      rows,
      online,
      onlineUpper,
      calibrated: calibratedOnline,
      quality: Math.round(avgQuality),
      realHz,
      jitterMs,
      ready: partialReady,
      partialMode: online < BONE_ORDER.length,
      stage: this.profile ? (this.applied ? 'aplicado' : 'perfil listo') : this.captureA ? (this.captureB ? 'verificado' : 'base A capturada') : 'sin calibrar',
    };
  }

  #captureWindow() {
    const capture = {};
    for (const alias of BONE_ORDER) {
      const samples = (this.history.get(alias) ?? []).slice(-CAPTURE_FRAMES);
      capture[alias] = summarizeSamples(samples);
    }
    return capture;
  }

  #buildProfile() {
    if (!this.captureA || !this.captureB) return null;
    const sensors = {};
    for (const alias of BONE_ORDER) {
      const a = this.captureA[alias];
      const b = this.captureB[alias];
      const online = Boolean(a?.count && b?.count);
      const verificationError = online ? rotationDistance(a.mean, b.mean) : 999;
      const jitter = Math.max(a?.jitter ?? 999, b?.jitter ?? 999);
      const drift = online ? verificationError : 999;
      const quality = scoreQuality({ online, verificationError, jitter, drift });
      const dominance = dominantAxis(a?.std ?? {});
      sensors[alias] = {
        alias,
        label: BONE_LABELS[alias] ?? alias,
        offset: a?.mean ?? { rx: 0, ry: 0, rz: 0 },
        axisMap: { rx: 'rx', ry: 'ry', rz: 'rz' },
        sign: { rx: 1, ry: 1, rz: 1 },
        quality,
        verificationError,
        jitter,
        drift,
        dominantAxis: dominance.axis,
        state: sensorState(quality, online),
        note: dominance.suspicious ? 'eje dominante sospechoso' : 'offset base transferido',
      };
    }
    return { sensors, createdAt: new Date().toISOString() };
  }

  #sensorSummary(alias) {
    const samples = this.history.get(alias) ?? [];
    const last = samples.at(-1);
    const online = Boolean(last && performance.now() - last.at < STALE_MS);
    const profile = this.profile?.sensors?.[alias];
    const live = summarizeSamples(samples.slice(-CAPTURE_FRAMES));
    const quality = profile?.quality ?? scoreQuality({
      online,
      verificationError: this.captureA && this.captureB ? rotationDistance(this.captureA[alias]?.mean, this.captureB[alias]?.mean) : 0,
      jitter: live.jitter,
      drift: live.jitter,
    });
    return {
      alias,
      label: BONE_LABELS[alias] ?? alias,
      online,
      quality,
      state: profile?.state ?? sensorState(quality, online),
      jitter: profile?.jitter ?? live.jitter,
      drift: profile?.drift ?? 0,
      verificationError: profile?.verificationError ?? 0,
      dominantAxis: profile?.dominantAxis ?? dominantAxis(live.std).axis,
      note: profile?.note ?? (this.captureA ? 'esperando verificacion B' : 'sin transferencia base'),
      raw: last ? { rx: last.rx, ry: last.ry, rz: last.rz } : { rx: 0, ry: 0, rz: 0 },
    };
  }
}

function normalizeConfig(config) {
  return {
    targetHz: clamp(finiteOr(config.targetHz, DEFAULT_CONFIG.targetHz), 1, 120),
    smoothing: clamp(finiteOr(config.smoothing, DEFAULT_CONFIG.smoothing), 0.05, 1),
    liveSmoothing: clamp(finiteOr(config.liveSmoothing, DEFAULT_CONFIG.liveSmoothing), 0.08, 1),
    deadzone: clamp(finiteOr(config.deadzone, DEFAULT_CONFIG.deadzone), 0, 12),
    gain: clamp(finiteOr(config.gain, DEFAULT_CONFIG.gain), 0.1, 3),
    maxRotation: clamp(finiteOr(config.maxRotation, DEFAULT_CONFIG.maxRotation), 5, 180),
  };
}

function summarizeSamples(samples) {
  const count = samples.length;
  const mean = {};
  const std = {};
  for (const axis of AXES) {
    const values = samples.map((item) => item[axis]);
    mean[axis] = average(values);
    std[axis] = stddev(values);
  }
  return {
    count,
    mean,
    std,
    jitter: average(AXES.map((axis) => std[axis])),
  };
}

function dominantAxis(std) {
  const sorted = AXES.map((axis) => ({ axis, value: std?.[axis] ?? 0 })).sort((a, b) => b.value - a.value);
  const top = sorted[0] ?? { axis: 'rx', value: 0 };
  const second = sorted[1] ?? { value: 0 };
  return {
    axis: top.axis,
    suspicious: top.value > 3 && top.value > second.value * 2.4,
  };
}

function scoreQuality({ online, verificationError, jitter, drift }) {
  if (!online) return 0;
  const penalty = verificationError * 8 + jitter * 10 + drift * 2;
  return Math.round(clamp(100 - penalty, 0, 100));
}

function sensorState(quality, online) {
  if (!online) return 'sin datos';
  if (quality >= 90) return 'excelente';
  if (quality >= 75) return 'aceptable';
  if (quality >= 50) return 'recalibrar';
  return 'inestable';
}

function rotationDistance(a, b) {
  if (!a || !b) return 999;
  return Math.sqrt(AXES.reduce((sum, axis) => sum + (a[axis] - b[axis]) ** 2, 0));
}

function clean(value, deadzone) {
  return Math.abs(value) < deadzone ? 0 : value;
}

function resolveCorrectedValue(offsetCorrected, directCorrected, deadzone) {
  const offsetMagnitude = Math.abs(offsetCorrected);
  const directMagnitude = Math.abs(directCorrected);

  if (offsetMagnitude < deadzone && directMagnitude >= deadzone * 2) {
    return directCorrected;
  }

  return offsetCorrected;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function stddev(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length < 2) return 0;
  const mean = average(valid);
  return Math.sqrt(average(valid.map((value) => (value - mean) ** 2)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
