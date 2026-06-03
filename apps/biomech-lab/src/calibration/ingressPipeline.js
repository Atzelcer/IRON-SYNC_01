/**
 * Pipeline de entrada IMU → pose canónica para el skeletal mesh (15 huesos).
 * Calibración: alinea promedios ESP32/Mega con deltas del mesh (unreal-initial).
 */
import { BONE_LABELS, BONE_ORDER, MEGA_SENSOR_MAP_VERSION } from '../core/boneMap.js';
import { clampRotation, BONE_LIMITS } from '../skeleton/boneLimits.js';

export const INGRESS_PIPELINE_SCHEMA = 'ironsync.ingress.v1';
const AXES = ['rx', 'ry', 'rz'];
const STORAGE_KEY = 'ironsync.ingress.latest';

const DEFAULT_CONFIG = {
  deadzone: 0.65,
  smoothing: 0.32,
  maxStepPerFrame: 14,
  referencePose: 'unreal-initial',
};

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function axisVec(value = {}) {
  return {
    rx: Number(value.rx) || 0,
    ry: Number(value.ry) || 0,
    rz: Number(value.rz) || 0,
  };
}

function defaultBoneTransfer(alias) {
  const limits = BONE_LIMITS[alias];
  const scale = { rx: 1, ry: 1, rz: 1 };
  if (limits) {
    for (const axis of AXES) {
      const span = limits[axis][1] - limits[axis][0];
      scale[axis] = clamp(span / 110, 0.4, 2.4);
    }
  }
  return {
    alias,
    label: BONE_LABELS[alias] ?? alias,
    offset: { rx: 0, ry: 0, rz: 0 },
    scale,
    sign: { rx: 1, ry: 1, rz: 1 },
    axisMap: { rx: 'rx', ry: 'ry', rz: 'rz' },
    quality: 0,
    online: false,
  };
}

function emptyPose() {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { rx: 0, ry: 0, rz: 0 }]));
}

export class IngressPipeline {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.profile = null;
    this.active = false;
    this.filtered = new Map();
    this.lastOutput = emptyPose();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.sensorMapVersion && parsed.sensorMapVersion !== MEGA_SENSOR_MAP_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      const ok = this.importProfile(parsed, { activate: false });
      if (ok) this.#normalizeSensorOnlineFlags();
      return ok;
    } catch {
      return null;
    }
  }

  save() {
    const payload = this.exportProfile();
    if (!payload) return null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  }

  reset() {
    this.active = false;
    this.filtered.clear();
    this.lastOutput = emptyPose();
  }

  clearProfile() {
    this.profile = null;
    this.active = false;
    this.filtered.clear();
    localStorage.removeItem(STORAGE_KEY);
  }

  isActive() {
    return Boolean(this.active && this.profile);
  }

  setActive(enabled) {
    this.active = Boolean(enabled && this.profile);
    if (this.active) this.filtered.clear();
  }

  setConfig(config = {}) {
    this.config = {
      ...this.config,
      ...config,
      deadzone: clamp(Number(config.deadzone ?? this.config.deadzone), 0, 8),
      smoothing: clamp(Number(config.smoothing ?? this.config.smoothing), 0.05, 0.95),
      maxStepPerFrame: clamp(Number(config.maxStepPerFrame ?? this.config.maxStepPerFrame), 2, 45),
    };
  }

  /**
   * Ajusta offsets y escalas por hueso: IMU en reposo → deltas del mesh de referencia.
   * @param {object} options
   * @param {Record<string,{rx,ry,rz}>} options.imuBaseline — promedio crudo (Mega/ESP32)
   * @param {Record<string,{rx,ry,rz}>} options.meshTarget — deltas BoneController.read() tras unreal-initial
   */
  fitFromCalibration({ imuBaseline, meshTarget, captureA = null, modelInfo = null, mapping = null } = {}) {
    const sensors = {};
    let online = 0;
    for (const alias of BONE_ORDER) {
      const bone = defaultBoneTransfer(alias);
      const imu = axisVec(imuBaseline?.[alias]);
      const mesh = axisVec(meshTarget?.[alias]);
      const hasImu = (captureA?.[alias]?.count ?? 0) > 0
        || Math.abs(imu.rx) + Math.abs(imu.ry) + Math.abs(imu.rz) > 0.05;
      if (hasImu) online += 1;
      for (const axis of AXES) {
        const scale = bone.scale[axis];
        bone.offset[axis] = round3(imu[axis] - mesh[axis] / scale);
      }
      bone.online = hasImu;
      bone.quality = hasImu ? 92 : 0;
      sensors[alias] = bone;
    }

    this.profile = {
      schema: INGRESS_PIPELINE_SCHEMA,
      sensorMapVersion: MEGA_SENSOR_MAP_VERSION,
      createdAt: new Date().toISOString(),
      method: 'mesh-transfer-static-fit',
      referencePose: this.config.referencePose,
      model: modelInfo,
      mapping,
      sensors,
      meta: { online, boneCount: BONE_ORDER.length },
    };
    this.active = online >= 7;
    this.filtered.clear();
    this.save();
    return this.profile;
  }

  importProfile(payload, { activate = true } = {}) {
    if (payload?.schema !== INGRESS_PIPELINE_SCHEMA || !payload?.sensors) return false;
    this.profile = payload;
    this.#normalizeSensorOnlineFlags();
    this.config.referencePose = payload.referencePose ?? this.config.referencePose;
    this.active = Boolean(activate);
    this.filtered.clear();
    return true;
  }

  /** Perfiles guardados sin `online` → inferir desde offset/calidad para no mostrar 0/15. */
  #normalizeSensorOnlineFlags() {
    if (!this.profile?.sensors) return;
    let online = 0;
    for (const alias of BONE_ORDER) {
      const row = this.profile.sensors[alias];
      if (!row) continue;
      if (row.online === undefined || row.online === null) {
        const off = axisVec(row.offset);
        const offMag = Math.abs(off.rx) + Math.abs(off.ry) + Math.abs(off.rz);
        row.online = (row.quality ?? 0) > 0 || offMag > 0.02;
      }
      if (row.online) online += 1;
    }
    if (this.profile.meta) this.profile.meta.online = online;
  }

  exportProfile() {
    if (!this.profile) return null;
    return {
      ...this.profile,
      active: this.active,
      config: this.config,
    };
  }

  summary() {
    const sensors = this.profile?.sensors ?? {};
    const rows = BONE_ORDER.map((alias) => {
      const row = sensors[alias] ?? defaultBoneTransfer(alias);
      return {
        alias,
        label: row.label,
        online: Boolean(row.online),
        quality: row.quality ?? 0,
        scale: row.scale,
        offset: row.offset,
      };
    });
    const online = rows.filter((r) => r.online).length;
    return {
      active: this.isActive(),
      online,
      rows,
      referencePose: this.config.referencePose,
    };
  }

  /**
   * Procesa pose cruda (post Mega) → pose lista para BoneController.writeMany.
   */
  processPose(rawPose = {}) {
    if (!this.isActive()) {
      this.lastOutput = sanitizePose(rawPose);
      return this.lastOutput;
    }

    const output = {};
    for (const alias of BONE_ORDER) {
      const bone = this.profile.sensors[alias] ?? defaultBoneTransfer(alias);
      const source = axisVec(rawPose[alias]);
      const previous = this.filtered.get(alias) ?? { rx: 0, ry: 0, rz: 0 };
      const next = { rx: 0, ry: 0, rz: 0 };

      for (const axis of AXES) {
        const mapAxis = bone.axisMap?.[axis] ?? axis;
        const sign = bone.sign?.[axis] ?? 1;
        const scale = bone.scale?.[axis] ?? 1;
        const offset = bone.offset?.[axis] ?? 0;
        const raw = (Number(source[mapAxis]) || 0) - offset;
        let value = raw * scale * sign;
        value = applyDeadzone(value, this.config.deadzone);
        value = previous[axis] + this.config.smoothing * (value - previous[axis]);
        const step = clamp(value - previous[axis], -this.config.maxStepPerFrame, this.config.maxStepPerFrame);
        value = previous[axis] + step;
        next[axis] = value;
      }

      this.filtered.set(alias, next);
      output[alias] = clampRotation(alias, {
        rx: round3(next.rx),
        ry: round3(next.ry),
        rz: round3(next.rz),
      });
    }

    this.lastOutput = output;
    return output;
  }

  processRotations(rotations = []) {
    const rawPose = emptyPose();
    for (const item of rotations) {
      if (!BONE_ORDER.includes(item.alias)) continue;
      rawPose[item.alias] = axisVec(item);
    }
    const pose = this.processPose(rawPose);
    return BONE_ORDER.filter((alias) => pose[alias]).map((alias) => ({
      alias,
      ...pose[alias],
    }));
  }
}

export function readMeshReferenceDeltas(controller) {
  if (!controller) return emptyPose();
  const pose = {};
  for (const alias of BONE_ORDER) {
    pose[alias] = axisVec(controller.read(alias));
  }
  return pose;
}

export function imuBaselineFromCaptureA(captureA) {
  const baseline = emptyPose();
  if (!captureA) return baseline;
  for (const alias of BONE_ORDER) {
    baseline[alias] = axisVec(captureA[alias]?.mean);
  }
  return baseline;
}

function sanitizePose(pose) {
  const out = emptyPose();
  for (const alias of BONE_ORDER) {
    out[alias] = axisVec(pose[alias]);
  }
  return out;
}

function applyDeadzone(value, deadzone) {
  if (Math.abs(value) < deadzone) return 0;
  return value > 0 ? value - deadzone : value + deadzone;
}
