import { BONE_ORDER } from '../core/boneMap.js';

export const MASTER_CALIBRATION_SCHEMA = 'ironsync.master-calibration.v1';
const STORAGE_KEY = 'ironsync.master-calibration.latest';

const AXES = ['rx', 'ry', 'rz'];

/** Cero de sesión: valores IMU en pose base tras calibrar (sin pasar vectores al mesh). */
export function extractBaselineFromCalibrationExport(exportPayload) {
  const captureA = exportPayload?.captureA;
  if (captureA) {
    return poseFromCaptureWindow(captureA);
  }

  const profile = exportPayload?.profile?.sensors;
  if (profile) {
    return Object.fromEntries(BONE_ORDER.map((alias) => {
      const offset = profile[alias]?.offset ?? {};
      return [alias, {
        rx: Number(offset.rx) || 0,
        ry: Number(offset.ry) || 0,
        rz: Number(offset.rz) || 0,
      }];
    }));
  }

  return zeroBaseline();
}

export function toRelativePose(pose, baseline) {
  if (!pose || !baseline) return pose ?? {};
  const relative = {};
  for (const alias of BONE_ORDER) {
    const current = pose[alias] ?? { rx: 0, ry: 0, rz: 0 };
    const base = baseline[alias] ?? { rx: 0, ry: 0, rz: 0 };
    relative[alias] = {
      rx: (Number(current.rx) || 0) - (Number(base.rx) || 0),
      ry: (Number(current.ry) || 0) - (Number(base.ry) || 0),
      rz: (Number(current.rz) || 0) - (Number(base.rz) || 0),
    };
  }
  return relative;
}

export class MasterCalibrationStore {
  constructor() {
    this.snapshot = null;
    this.baseline = zeroBaseline();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const snapshot = JSON.parse(raw);
      if (snapshot?.schema !== MASTER_CALIBRATION_SCHEMA) return null;
      this.snapshot = snapshot;
      this.baseline = snapshot.baseline ?? zeroBaseline();
      return snapshot;
    } catch {
      return null;
    }
  }

  save(calibrationExport, meta = {}) {
    const baseline = extractBaselineFromCalibrationExport(calibrationExport);
    const snapshot = {
      schema: MASTER_CALIBRATION_SCHEMA,
      id: `master_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      baseline,
      calibration: calibrationExport,
      meta,
    };
    this.snapshot = snapshot;
    this.baseline = baseline;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot;
  }

  importSnapshot(snapshot) {
    if (snapshot?.schema !== MASTER_CALIBRATION_SCHEMA || !snapshot?.baseline) return false;
    this.snapshot = {
      ...snapshot,
      baseline: normalizeBaseline(snapshot.baseline),
    };
    this.baseline = this.snapshot.baseline;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot));
    return true;
  }

  hasBaseline() {
    return Boolean(this.snapshot?.id);
  }

  getBaseline() {
    return this.baseline;
  }

  getSnapshot() {
    return this.snapshot;
  }

  clear() {
    this.snapshot = null;
    this.baseline = zeroBaseline();
    localStorage.removeItem(STORAGE_KEY);
  }
}

function poseFromCaptureWindow(capture) {
  return Object.fromEntries(BONE_ORDER.map((alias) => {
    const mean = capture[alias]?.mean ?? {};
    return [alias, {
      rx: Number(mean.rx) || 0,
      ry: Number(mean.ry) || 0,
      rz: Number(mean.rz) || 0,
    }];
  }));
}

function zeroBaseline() {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { rx: 0, ry: 0, rz: 0 }]));
}

function normalizeBaseline(baseline) {
  return Object.fromEntries(BONE_ORDER.map((alias) => {
    const source = baseline?.[alias] ?? {};
    return [alias, {
      rx: Number(source.rx) || 0,
      ry: Number(source.ry) || 0,
      rz: Number(source.rz) || 0,
    }];
  }));
}
