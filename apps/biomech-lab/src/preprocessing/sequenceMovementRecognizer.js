import { BONE_LABELS } from '../core/boneMap.js';
import {
  computeMotionDelta,
  createTrackingSession,
  enrichProfileSequence,
  isNearBasePose,
  scorePoseAgainstKeyframe,
  trackProfileFrame,
} from './sequenceTemporalTracker.js';

const AXES = ['rx', 'ry', 'rz'];
const SEQUENCE_STEPS = 32;
const POSE_BUFFER_SIZE = 8;

/**
 * Perfil con secuencia temporal (keyframes 0..1) + envolventes min/max por hueso.
 */
export function buildSequenceProfile(animation) {
  const id = String(animation?.animationId || animation?.id || '').trim();
  if (!id) return null;
  const name = String(animation?.animationName || animation?.name || id).trim();
  const activeBones = Array.isArray(animation?.activeBones)
    ? animation.activeBones.map((alias) => String(alias || '').trim()).filter(Boolean)
    : [];
  if (!activeBones.length) return null;

  const samples = Array.isArray(animation?.samples) ? animation.samples : [];
  const storedProfile = animation?.sequenceProfile ?? animation?.augmented?.sequenceProfile ?? null;
  const masterTrajectory = animation?.masterTrajectory ?? animation?.augmented?.masterTrajectory ?? null;

  let sequence = [];
  if (masterTrajectory?.length) {
    sequence = masterTrajectoryToSequence(masterTrajectory, activeBones, SEQUENCE_STEPS);
  }
  if (!sequence.length) {
    sequence = mergeSampleTrajectories(samples, activeBones, SEQUENCE_STEPS);
  }
  if (!sequence.length && storedProfile?.sequence?.length) {
    sequence = storedProfile.sequence;
  }
  if (!sequence.length) return null;

  const envelopes = storedProfile?.envelopes
    ?? buildEnvelopes(samples, activeBones, animation?.template?.bones);

  return {
    id,
    name,
    activeBones,
    sequence,
    envelopes,
    holdWindow: animation?.holdWindow ?? animation?.augmented?.holdWindow ?? storedProfile?.holdWindow ?? null,
    durationMs: animation?.durationMs ?? animation?.augmented?.durationMs ?? storedProfile?.durationMs ?? null,
    sequenceLength: sequence.length,
    recognition: animation?.recognition ?? null,
    activation: animation?.activation ?? null,
    targetPose: animation?.targetPose ?? animation?.recognition?.targetPose ?? null,
    discriminators: animation?.recognition?.discriminators ?? null,
  };
}

function masterTrajectoryToSequence(masterTrajectory, activeBones, steps) {
  if (masterTrajectory.length === steps) {
    return masterTrajectory.map((frame) => ({
      t: round(Number(frame.t) || 0),
      bones: Object.fromEntries(activeBones.map((alias) => {
        const rot = frame.bones?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
        return [alias, { rx: round(rot.rx), ry: round(rot.ry), rz: round(rot.rz) }];
      })),
    }));
  }
  const durationMs = 2400;
  const frames = masterTrajectory.map((frame, idx) => ({
    t: (Number(frame.t) ?? (idx / Math.max(1, masterTrajectory.length - 1))) * durationMs,
    bones: frame.bones ?? {},
  }));
  return resampleTrajectory(activeBones, frames, steps);
}

export class SequenceMovementRecognizer {
  constructor() {
    this.profiles = [];
    this.threshold = 80;
    this.minPeak = 6;
    this.holdStillDeg = 2.8;
    this.baseReturnDeg = 5;
    this.session = createTrackingSession();
    this.lockedProfileId = null;
    this.poseBuffer = [];
    this.lastMatch = null;
  }

  loadProfiles(profiles) {
    this.profiles = profiles.filter(Boolean).map((p) => enrichProfileSequence(p));
    this.resetSession();
  }

  setConfig({ threshold, minPeak, holdStillDeg, baseReturnDeg } = {}) {
    if (Number.isFinite(Number(threshold))) this.threshold = clamp(Number(threshold), 50, 99.9);
    if (Number.isFinite(Number(minPeak))) this.minPeak = clamp(Number(minPeak), 0, 60);
    if (Number.isFinite(Number(holdStillDeg))) this.holdStillDeg = clamp(Number(holdStillDeg), 0.5, 15);
    if (Number.isFinite(Number(baseReturnDeg))) this.baseReturnDeg = clamp(Number(baseReturnDeg), 2, 25);
  }

  resetSession() {
    this.session = createTrackingSession();
    this.lockedProfileId = null;
    this.poseBuffer = [];
    this.lastMatch = null;
  }

  recognize(pose, now = performance.now()) {
    if (!this.profiles.length || !pose) return null;

    this.#pushPose(pose, now);
    const config = {
      threshold: this.threshold,
      minPeak: this.minPeak,
      holdStillDeg: this.holdStillDeg,
      baseReturnDeg: this.baseReturnDeg,
    };

    let profile = this.#activeProfile();
    if (!profile) {
      const picked = this.#pickStartingProfile(pose, config);
      if (!picked) return null;
      this.lockedProfileId = picked.id;
      profile = picked;
      this.session = createTrackingSession();
    }

    const motionDelta = computeMotionDelta(this.poseBuffer, profile.activeBones);
    const tracked = trackProfileFrame(profile, this.session, pose, config, motionDelta);
    if (tracked?.reset) {
      this.resetSession();
      return null;
    }
    if (!tracked) return null;

    const match = { ...tracked, at: now };
    this.lastMatch = match;
    return match;
  }

  #activeProfile() {
    return this.profiles.find((p) => p.id === this.lockedProfileId) ?? null;
  }

  #pickStartingProfile(pose, config) {
    let best = null;
    for (const profile of this.profiles) {
      if (isNearBasePose(pose, profile.activeBones, this.baseReturnDeg)) continue;
      const trial = createTrackingSession();
      const tracked = trackProfileFrame(profile, trial, pose, config, 999);
      if (!tracked || tracked.score < config.threshold) continue;
      if (!best || tracked.score > best.score) {
        best = profile;
      }
    }
    return best;
  }

  #pushPose(pose, now) {
    this.poseBuffer.push({ pose, now });
    if (this.poseBuffer.length > POSE_BUFFER_SIZE) this.poseBuffer.shift();
  }

}

export function resampleTrajectory(activeBones, frames, steps = SEQUENCE_STEPS) {
  if (!frames?.length || !activeBones?.length) return [];
  const t0 = frames[0].t;
  const duration = Math.max(1, frames.at(-1).t - t0);
  const out = [];
  for (let s = 0; s < steps; s++) {
    const targetT = t0 + (s / Math.max(1, steps - 1)) * duration;
    const sample = interpolateFrames(frames, targetT);
    const bones = {};
    for (const alias of activeBones) {
      bones[alias] = {
        rx: round(Number(sample?.bones?.[alias]?.rx) || 0),
        ry: round(Number(sample?.bones?.[alias]?.ry) || 0),
        rz: round(Number(sample?.bones?.[alias]?.rz) || 0),
      };
    }
    out.push({ t: round(s / Math.max(1, steps - 1)), bones });
  }
  return out;
}

function mergeSampleTrajectories(samples, activeBones, steps) {
  if (!samples.length) return [];
  const trajectories = samples.map((sample) => (
    sample.trajectory?.length
      ? sample.trajectory
      : synthesizeTrajectory(activeBones, sample, steps)
  ));
  const merged = [];
  for (let i = 0; i < steps; i++) {
    const t = round(i / Math.max(1, steps - 1));
    const bones = {};
    for (const alias of activeBones) {
      bones[alias] = { rx: 0, ry: 0, rz: 0 };
      for (const axis of AXES) {
        const vals = trajectories.map((tr) => Number(tr[Math.min(i, tr.length - 1)]?.bones?.[alias]?.[axis]) || 0);
        bones[alias][axis] = round(average(vals));
      }
    }
    merged.push({ t, bones });
  }
  return merged;
}

function synthesizeTrajectory(activeBones, sample, steps = SEQUENCE_STEPS) {
  const out = [];
  for (let s = 0; s < steps; s++) {
    const t = s / Math.max(1, steps - 1);
    const envelope = Math.sin(Math.PI * t);
    const bones = {};
    for (const alias of activeBones) {
      const stats = sample?.bones?.[alias] ?? {};
      bones[alias] = {
        rx: round((stats.rx?.peak ?? 0) * envelope),
        ry: round((stats.ry?.peak ?? 0) * envelope),
        rz: round((stats.rz?.peak ?? 0) * envelope),
      };
    }
    out.push({ t: round(t), bones });
  }
  return out;
}

function buildEnvelopes(samples, activeBones, templateBones) {
  const envelopes = {};
  for (const alias of activeBones) {
    envelopes[alias] = {};
    for (const axis of AXES) {
      const mins = samples.map((s) => Number(s?.bones?.[alias]?.[axis]?.min)).filter(Number.isFinite);
      const maxs = samples.map((s) => Number(s?.bones?.[alias]?.[axis]?.max)).filter(Number.isFinite);
      const peaks = samples.map((s) => Number(s?.bones?.[alias]?.[axis]?.peak)).filter(Number.isFinite);
      const tpl = templateBones?.[alias]?.[axis];
      envelopes[alias][axis] = {
        min: round(mins.length ? Math.min(...mins) : (tpl?.peak ?? 0) * -0.15),
        max: round(maxs.length ? Math.max(...maxs) : (tpl?.peak ?? 0) * 1.15),
        peak: round(peaks.length ? average(peaks) : Number(tpl?.peak) || 0),
      };
    }
  }
  return envelopes;
}

function isWithinEnvelope(pose, profile, sequenceIndex) {
  const env = profile.envelopes;
  if (!env) return false;
  const t = profile.sequenceLength > 1 ? sequenceIndex / (profile.sequenceLength - 1) : 0;
  if (t < 0.12 || t > 0.88) return false;
  let hits = 0;
  let checks = 0;
  for (const alias of profile.activeBones) {
    const rot = pose[alias] ?? {};
    const boneEnv = env[alias];
    if (!boneEnv) continue;
    for (const axis of AXES) {
      const value = Number(rot[axis]) || 0;
      const band = boneEnv[axis];
      if (!band) continue;
      checks += 1;
      const lo = Math.min(band.min, band.max) - 3;
      const hi = Math.max(band.min, band.max) + 3;
      if (value >= lo && value <= hi) hits += 1;
    }
  }
  return checks > 0 && (hits / checks) >= 0.65;
}

function interpolateFrames(frames, targetT) {
  if (!frames.length) return { bones: {} };
  if (targetT <= frames[0].t) return frames[0];
  if (targetT >= frames.at(-1).t) return frames.at(-1);
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t >= targetT) {
      const a = frames[i - 1];
      const b = frames[i];
      const span = Math.max(1, b.t - a.t);
      const alpha = (targetT - a.t) / span;
      const bones = {};
      const keys = new Set([...Object.keys(a.bones ?? {}), ...Object.keys(b.bones ?? {})]);
      for (const alias of keys) {
        bones[alias] = {
          rx: lerp(a.bones?.[alias]?.rx ?? 0, b.bones?.[alias]?.rx ?? 0, alpha),
          ry: lerp(a.bones?.[alias]?.ry ?? 0, b.bones?.[alias]?.ry ?? 0, alpha),
          rz: lerp(a.bones?.[alias]?.rz ?? 0, b.bones?.[alias]?.rz ?? 0, alpha),
        };
      }
      return { t: targetT, bones };
    }
  }
  return frames.at(-1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, v) => sum + v, 0) / clean.length : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

export { BONE_LABELS, AXES };
