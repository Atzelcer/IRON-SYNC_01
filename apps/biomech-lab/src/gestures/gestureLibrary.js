import { GESTURE_CATALOG_BY_ID } from './gestureCatalog.js';

const AXES = ['rx', 'ry', 'rz'];

export class GestureLibrary {
  constructor() {
    this.profiles = [];
    this.sourceName = '';
    this.masterCalibrationId = null;
  }

  get loaded() {
    return this.profiles.length > 0;
  }

  loadFromTrainingDataset(dataset, sourceName = 'dataset.json', { merge = false } = {}) {
    const schema = dataset?.schema ?? '';
    const supported = schema === 'ironsync.movement-training.v3'
      || schema === 'ironsync.movement-training.v2'
      || schema === 'ironsync.movement-training.v1';
    const incoming = supported
      ? dataset.animations.map((animation) => buildProfileFromAnimation(animation)).filter(Boolean)
      : [];
    if (!incoming.length) {
      if (!merge) this.clear();
      return { loaded: false, profileCount: this.profiles.length };
    }

    this.masterCalibrationId = dataset.masterCalibration?.id ?? this.masterCalibrationId;
    if (merge) {
      const byId = new Map(this.profiles.map((profile) => [profile.id, profile]));
      for (const profile of incoming) byId.set(profile.id, profile);
      this.profiles = [...byId.values()];
      this.sourceName = this.sourceName
        ? `${this.sourceName} + ${sourceName}`
        : sourceName;
    } else {
      this.profiles = incoming;
      this.sourceName = sourceName;
    }
    return {
      loaded: this.profiles.length > 0,
      profileCount: this.profiles.length,
      masterCalibrationId: this.masterCalibrationId,
    };
  }

  clear() {
    this.profiles = [];
    this.sourceName = '';
    this.masterCalibrationId = null;
  }

  summary() {
    return {
      loaded: this.loaded,
      sourceName: this.sourceName,
      profileCount: this.profiles.length,
      masterCalibrationId: this.masterCalibrationId,
      animations: this.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        activeBones: profile.activeBones,
      })),
    };
  }
}

function buildProfileFromAnimation(animation) {
  const catalog = GESTURE_CATALOG_BY_ID[animation.animationId];
  const activeBones = animation.activeBones?.length
    ? animation.activeBones
    : catalog?.activeBones ?? [];
  if (!activeBones.length || animation.animationId === 'cal_still') return null;

  const templateBones = animation.template?.bones ?? {};
  const bones = activeBones.map((alias) => {
    const axes = Object.fromEntries(AXES.map((axis) => {
      const peak = Number(templateBones[alias]?.[axis]?.peak);
      const mean = Number(templateBones[alias]?.[axis]?.mean);
      const value = Number.isFinite(peak) ? peak : mean;
      return [axis, round(value)];
    }));
    const dominant = AXES
      .map((axis) => ({ axis, peak: Math.abs(axes[axis]) }))
      .sort((a, b) => b.peak - a.peak)[0] ?? { axis: 'rx', peak: 0 };
    return { alias, axes, dominant };
  });

  const motion = bones
    .map((bone) => ({ alias: bone.alias, axis: bone.dominant.axis, peak: bone.dominant.peak }))
    .sort((a, b) => Math.abs(b.peak) - Math.abs(a.peak))[0] ?? null;

  return {
    id: animation.animationId,
    name: animation.animationName ?? catalog?.name ?? animation.animationId,
    activeBones,
    bones,
    motion,
    approved: Boolean(animation.approved),
  };
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
