import { BONE_LABELS } from '../core/boneMap.js';
import {
  assignExecutionSlots,
  buildCollectionHeatmap,
  MAX_EXECUTION_SLOTS,
} from './collectionHeatmapRanker.js';
import {
  computeMotionDelta,
  computeMotionPeak,
  createTrackingSession,
  enrichProfileSequence,
  isNearBasePose,
  trackProfileFrame,
} from './sequenceTemporalTracker.js';

const POSE_BUFFER_SIZE = 8;

export const RUNTIME_MATCH_THRESHOLD = 70;
export const RUNTIME_START_THRESHOLD_RATIO = 0.86;
export const RUNTIME_DEFAULT_MIN_PEAK = 8;
export const RUNTIME_DEFAULT_HOLD_STILL = 2;
export const RUNTIME_DEFAULT_BASE_RETURN = 5;
export const MAX_CONCURRENT_MOVEMENTS = MAX_EXECUTION_SLOTS;

/**
 * Coleccion completa: mapa de calor siempre visible + slots 1..3 + secuencia temporal.
 */
export class MultiMovementRecognizer {
  constructor() {
    this.profiles = [];
    this.threshold = RUNTIME_MATCH_THRESHOLD;
    this.minPeak = RUNTIME_DEFAULT_MIN_PEAK;
    this.holdStillDeg = RUNTIME_DEFAULT_HOLD_STILL;
    this.baseReturnDeg = RUNTIME_DEFAULT_BASE_RETURN;
    this.sessions = new Map();
    this.poseBuffer = [];
    this.lastMatches = [];
    this.lastCollectionHeatmap = [];
    this.lastExecutionSlots = [];
    this.lastMotionPeak = 0;
  }

  loadProfiles(profiles) {
    this.profiles = profiles.filter(Boolean).map((p) => enrichProfileSequence(p));
    this.sessions.clear();
    this.poseBuffer = [];
    this.lastMatches = [];
    this.lastCollectionHeatmap = [];
    this.lastExecutionSlots = [];
    this.lastMotionPeak = 0;
  }

  setConfig({ threshold, minPeak, holdStillDeg, baseReturnDeg } = {}) {
    if (Number.isFinite(Number(threshold))) this.threshold = Number(threshold);
    if (Number.isFinite(Number(minPeak))) this.minPeak = Number(minPeak);
    if (Number.isFinite(Number(holdStillDeg))) this.holdStillDeg = Number(holdStillDeg);
    if (Number.isFinite(Number(baseReturnDeg))) this.baseReturnDeg = Number(baseReturnDeg);
  }

  resetSession() {
    this.sessions.clear();
    this.poseBuffer = [];
    this.lastMatches = [];
    this.lastCollectionHeatmap = [];
    this.lastExecutionSlots = [];
    this.lastMotionPeak = 0;
  }

  recognize(pose, now = performance.now()) {
    return this.#recognizeAll(pose, now);
  }

  recognizePrimary(pose, now = performance.now()) {
    return this.#recognizeAll(pose, now)[0] ?? null;
  }

  #recognizeAll(pose, now) {
    if (!this.profiles.length || !pose) {
      this.lastMatches = [];
      return [];
    }

    this.#pushPose(pose, now);
    const config = this.#config();
    this.lastMotionPeak = computeMotionPeak(pose, this.profiles.flatMap((p) => p.activeBones));

    const lockedProfileIds = new Set();
    for (const [profileId, session] of this.sessions.entries()) {
      if (session.phase !== 'idle') lockedProfileIds.add(profileId);
    }

    const ranking = buildCollectionHeatmap(this.profiles, pose, {
      minPeak: this.minPeak,
      threshold: this.threshold,
      motionPeak: this.lastMotionPeak,
      baseReturnDeg: this.baseReturnDeg,
    });
    this.lastCollectionHeatmap = ranking;

    const newSlots = assignExecutionSlots(ranking, MAX_EXECUTION_SLOTS, lockedProfileIds);
    const allowedToRun = new Set([
      ...lockedProfileIds,
      ...newSlots.filter((s) => !s.locked).map((s) => s.profileId),
    ]);

    const candidates = [];

    for (const profile of this.profiles) {
      const atBase = isNearBasePose(pose, profile.activeBones, this.baseReturnDeg);
      const locked = lockedProfileIds.has(profile.id);

      if (!allowedToRun.has(profile.id)) {
        if (!locked) this.sessions.delete(profile.id);
        continue;
      }

      if (atBase) {
        if (this.sessions.has(profile.id)) this.sessions.delete(profile.id);
        continue;
      }

      let session = this.sessions.get(profile.id);
      if (!session) {
        session = createTrackingSession();
        this.sessions.set(profile.id, session);
      }

      const motionDelta = computeMotionDelta(this.poseBuffer, profile.activeBones);
      const tracked = trackProfileFrame(profile, session, pose, config, motionDelta);

      if (tracked?.reset) {
        this.sessions.delete(profile.id);
        continue;
      }
      if (!tracked) {
        if (session.phase === 'idle') this.sessions.delete(profile.id);
        continue;
      }

      const row = ranking.find((r) => r.profileId === profile.id);
      if (row) {
        row.score = Math.max(row.score, tracked.score);
        row.sessionPhase = tracked.phase;
        row.sequenceIndex = tracked.sequenceIndex;
        row.sequenceProgress = tracked.sequenceProgress;
      }

      const trackThreshold = this.threshold * 0.88;
      if (tracked.score >= trackThreshold) {
        candidates.push({ ...tracked, at: now });
      } else if (session.phase === 'hold' || session.phase === 'completing') {
        candidates.push({
          ...tracked,
          at: now,
          score: Math.max(tracked.score, trackThreshold),
        });
      }
    }

    ranking.sort((a, b) => b.score - a.score);
    this.lastCollectionHeatmap = ranking;

    const usedBones = new Set();
    const matches = [];
    candidates.sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      if (matches.length >= MAX_EXECUTION_SLOTS) break;
      if (candidate.profile.activeBones.some((alias) => usedBones.has(alias))) continue;
      candidate.profile.activeBones.forEach((alias) => usedBones.add(alias));
      const slotInfo = newSlots.find((s) => s.profileId === candidate.profile.id);
      matches.push({
        ...candidate,
        slot: slotInfo?.slot ?? matches.length + 1,
        level: slotInfo?.level ?? matches.length + 1,
      });
    }

    this.lastExecutionSlots = newSlots.map((slot) => {
      const live = matches.find((m) => m.profile.id === slot.profileId);
      return {
        ...slot,
        active: Boolean(live),
        phase: live?.phase ?? 'idle',
        sequenceProgress: live?.sequenceProgress ?? 0,
      };
    });

    this.lastMatches = matches;
    return matches;
  }

  #pushPose(pose, now) {
    this.poseBuffer.push({ pose, now });
    if (this.poseBuffer.length > POSE_BUFFER_SIZE) this.poseBuffer.shift();
  }

  #config() {
    return {
      threshold: this.threshold,
      startThreshold: Math.min(99, this.threshold * RUNTIME_START_THRESHOLD_RATIO),
      minPeak: this.minPeak,
      holdStillDeg: this.holdStillDeg,
      baseReturnDeg: this.baseReturnDeg,
    };
  }
}

export { BONE_LABELS };
