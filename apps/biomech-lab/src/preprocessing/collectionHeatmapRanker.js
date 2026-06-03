/**
 * Mapa de calor y ranking de toda la coleccion (todos los dataset.json cargados).
 * Asigna hasta 3 slots de ejecucion sin huesos activos en comun.
 */

import {
  computeMotionPeak,
  isNearBasePose,
  scorePoseAgainstKeyframe,
} from './sequenceTemporalTracker.js';

export const MAX_EXECUTION_SLOTS = 3;

/** Score maximo del gesto vs cada keyframe de la secuencia (mapa de calor 0..31). */
export function scoreProfilePeakHeat(profile, pose, minPeak = 6) {
  const heatmap = [];
  let bestScore = 0;
  let bestIndex = 0;
  for (let i = 0; i < profile.sequence.length; i++) {
    const score = scorePoseAgainstKeyframe(
      pose,
      profile.sequence[i],
      profile.activeBones,
      minPeak,
    );
    heatmap.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return {
    score: round(bestScore),
    bestIndex,
    heatmap,
    heatPeak: round(bestScore),
  };
}

/**
 * Ranking con contexto de movimiento: en reposo no infla el % buscando cualquier keyframe.
 */
export function scoreProfileForRanking(profile, pose, options = {}) {
  const minPeak = Number(options.minPeak) || 8;
  const baseReturnDeg = Number(options.baseReturnDeg) || 5;
  const motionPeak = Number.isFinite(options.motionPeak)
    ? options.motionPeak
    : computeMotionPeak(pose, profile.activeBones);
  const bones = profile.activeBones ?? [];
  const atRest = motionPeak < minPeak * 1.15;

  if (atRest) {
    if (!isNearBasePose(pose, bones, baseReturnDeg)) {
      return { score: 0, bestIndex: 0, heatmap: [], heatPeak: 0, atRest: true };
    }
    const start = scorePoseAgainstKeyframe(pose, profile.sequence[0], bones, minPeak);
    const end = scorePoseAgainstKeyframe(pose, profile.sequence.at(-1), bones, minPeak);
    const raw = Math.min(start, end) * 0.5;
    const score = round(applyDiscriminatorAdjust(profile, pose, raw, { atRest: true, motionPeak }));
    return { score, bestIndex: 0, heatmap: [score], heatPeak: score, atRest: true };
  }

  const lastMotionIdx = Math.max(1, Math.floor((profile.sequence?.length ?? 1) * 0.55));
  const heatmap = [];
  let bestScore = 0;
  let bestIndex = 0;
  for (let i = 0; i <= lastMotionIdx; i++) {
    const score = scorePoseAgainstKeyframe(pose, profile.sequence[i], bones, minPeak);
    heatmap.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  let adjusted = applyDiscriminatorAdjust(profile, pose, bestScore, { atRest: false, motionPeak });
  if (motionPeak < minPeak * 2 && bestIndex > (profile.sequence?.length ?? 1) * 0.3) {
    adjusted *= 0.6;
  }
  return {
    score: round(adjusted),
    bestIndex,
    heatmap,
    heatPeak: round(adjusted),
    atRest: false,
  };
}

/**
 * Ranking de toda la coleccion para el frame actual.
 */
export function buildCollectionHeatmap(profiles, pose, options = {}) {
  const minPeak = Number(options.minPeak) || 8;
  const threshold = Number(options.threshold) || 70;
  const baseReturnDeg = Number(options.baseReturnDeg) || 5;
  const allBones = profiles.flatMap((p) => p.activeBones ?? []);
  const motionPeak = Number.isFinite(options.motionPeak)
    ? options.motionPeak
    : computeMotionPeak(pose, allBones);

  const rows = profiles.map((profile) => {
    const { score, bestIndex, heatmap, heatPeak, atRest } = scoreProfileForRanking(profile, pose, {
      minPeak,
      motionPeak,
      baseReturnDeg,
    });
    return {
      profileId: profile.id,
      name: profile.name,
      activeBones: [...(profile.activeBones ?? [])],
      score,
      heatPeak,
      bestIndex,
      heatmap,
      atRest,
      aboveThreshold: !atRest && score >= threshold,
      level: scoreToLevel(score, threshold, atRest),
    };
  });
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/**
 * Slots 1..N: mayor score primero; sin repetir huesos activos entre slots.
 * @param {object[]} ranking - filas de buildCollectionHeatmap (ordenadas)
 * @param {Set<string>} lockedProfileIds - gestos ya en tracking/hold (siempre pasan)
 */
export function assignExecutionSlots(ranking, maxSlots = MAX_EXECUTION_SLOTS, lockedProfileIds = new Set()) {
  const slots = [];
  const usedBones = new Set();

  const lockedRows = ranking
    .filter((row) => lockedProfileIds.has(row.profileId))
    .sort((a, b) => b.score - a.score);

  for (const row of lockedRows) {
    if (slots.length >= maxSlots) break;
    row.activeBones.forEach((alias) => usedBones.add(alias));
    slots.push(slotFromRow(row, slots.length + 1, true));
  }

  for (const row of ranking) {
    if (slots.length >= maxSlots) break;
    if (lockedProfileIds.has(row.profileId)) continue;
    if (row.atRest || !row.aboveThreshold) continue;
    if (row.activeBones.some((alias) => usedBones.has(alias))) continue;
    row.activeBones.forEach((alias) => usedBones.add(alias));
    slots.push(slotFromRow(row, slots.length + 1, false));
  }

  return slots;
}

function applyDiscriminatorAdjust(profile, pose, score, { atRest, motionPeak }) {
  const discs = profile.discriminators ?? profile.recognition?.discriminators;
  if (!discs || !score) return score;
  let penalty = 0;
  for (const [alias, rule] of Object.entries(discs)) {
    const rot = pose[alias] ?? {};
    const axis = rule.primaryAxis || 'rx';
    const val = Number(rot[axis]) || 0;
    const minDisc = Number(rule.minPeak) || 6;
    if (atRest && minDisc >= 8) penalty += 12;
    if (!atRest && motionPeak >= minDisc * 0.5) {
      if (rule.expectedSign === '+' && val < minDisc * 0.35) penalty += 18;
      if (rule.expectedSign === '-' && val > -minDisc * 0.35) penalty += 18;
    }
  }
  return Math.max(0, score - penalty);
}

function slotFromRow(row, slotNumber, locked) {
  return {
    slot: slotNumber,
    level: slotNumber,
    profileId: row.profileId,
    name: row.name,
    score: row.score,
    heatPeak: row.heatPeak,
    activeBones: row.activeBones,
    locked,
  };
}

function scoreToLevel(score, threshold, atRest) {
  if (atRest) return 0;
  if (score >= threshold + 15) return 1;
  if (score >= threshold + 5) return 2;
  if (score >= threshold) return 3;
  if (score >= threshold - 12) return 4;
  return 0;
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
