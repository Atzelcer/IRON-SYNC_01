/**
 * Seguimiento temporal estricto inicio→fin sobre la secuencia del dataset (JSON).
 * - Avance monotono (no salta al final si te quedas a la mitad).
 * - En quietud: congela keyframe actual (animacion en la mitad).
 * - Interpolacion sub-frame entre keyframes para suavidad.
 */

const AXES = ['rx', 'ry', 'rz'];
const FORWARD_WINDOW = 5;
const MAX_BACKWARD = 1;
const START_WINDOW_MAX = 4;

export function enrichProfileSequence(profile) {
  if (!profile?.sequence?.length || profile._motionCurve) return profile;
  let cumulative = 0;
  const motionCurve = profile.sequence.map((frame, index) => {
    const mag = frameMotionMagnitude(frame, profile.activeBones);
    cumulative += index === 0 ? mag : Math.abs(mag - frameMotionMagnitude(profile.sequence[index - 1], profile.activeBones));
    return round(cumulative);
  });
  const peak = motionCurve.at(-1) || 1;
  profile._motionCurve = motionCurve.map((v) => round(v / peak));
  profile._peakMagnitude = peak;
  return profile;
}

export function createTrackingSession() {
  return {
    phase: 'idle',
    sequenceIndex: 0,
    subProgress: 0,
    lostFrames: 0,
    holdFrames: 0,
    lastScore: 0,
  };
}

/**
 * Un frame de seguimiento para un perfil (gesto) ya bloqueado o candidato.
 */
export function trackProfileFrame(profile, session, pose, config, motionDelta) {
  const threshold = Number(config.threshold) || 58;
  const startThreshold = Number(config.startThreshold) || threshold * 0.78;
  const minPeak = Number(config.minPeak) ?? 4;
  const holdStillDeg = Number(config.holdStillDeg) ?? 2.8;
  const baseReturnDeg = Number(config.baseReturnDeg) ?? 8;
  const trackThreshold = threshold * 0.88;
  const lastIndex = profile.sequence.length - 1;

  enrichProfileSequence(profile);

  const motionPeak = computeMotionPeak(pose, profile.activeBones);
  const held = motionDelta <= holdStillDeg;

  if (session.phase !== 'idle' && isNearBasePose(pose, profile.activeBones, baseReturnDeg)) {
    return { reset: true };
  }

  if (session.phase === 'idle') {
    const start = scoreBestInWindow(profile, pose, 0, Math.min(START_WINDOW_MAX, lastIndex), minPeak);
    if (start.score < startThreshold || motionPeak < minPeak) {
      return null;
    }
    session.phase = 'tracking';
    session.sequenceIndex = start.index;
    session.subProgress = 0;
    session.lostFrames = 0;
    session.holdFrames = 0;
    session.lastScore = start.score;
    return buildMatch(profile, session, pose, start.score, motionPeak, motionDelta, held);
  }

  const prevIndex = session.sequenceIndex;

  if (!held) {
    const winStart = Math.max(0, prevIndex - MAX_BACKWARD);
    const winEnd = Math.min(lastIndex, prevIndex + FORWARD_WINDOW);
    const windowBest = scoreBestInWindow(profile, pose, winStart, winEnd, minPeak);
    const curveIndex = estimateIndexFromMotionCurve(profile, pose, prevIndex, winEnd);
    let nextIndex = Math.max(prevIndex, windowBest.index);
    if (curveIndex >= prevIndex && curveIndex <= winEnd) {
      nextIndex = Math.max(nextIndex, curveIndex);
    }
    if (windowBest.score >= trackThreshold) {
      session.sequenceIndex = nextIndex;
      session.subProgress = estimateSubProgress(profile, pose, session.sequenceIndex, minPeak);
      session.lastScore = windowBest.score;
      session.lostFrames = 0;
    } else if (session.phase === 'hold' || session.phase === 'tracking') {
      session.lostFrames += 1;
      if (session.lostFrames > 14 && session.phase !== 'hold') {
        return { reset: true };
      }
      if (session.lostFrames > 28 && session.phase === 'hold') {
        return { reset: true };
      }
    }
  } else {
    session.holdFrames += 1;
    session.lostFrames = 0;
  }

  if (held) {
    session.phase = 'hold';
  } else if (session.sequenceIndex >= lastIndex - 1) {
    session.phase = 'completing';
    session.sequenceIndex = lastIndex;
    session.subProgress = 0;
  } else {
    session.phase = 'tracking';
    session.holdFrames = 0;
  }

  const score = held
    ? Math.max(session.lastScore, trackThreshold)
    : scorePoseAgainstKeyframe(pose, profile.sequence[session.sequenceIndex], profile.activeBones, minPeak);

  return buildMatch(profile, session, pose, score, motionPeak, motionDelta, held);
}

export function interpolateSequencePose(profile, index, subProgress = 0) {
  const sequence = profile.sequence;
  if (!sequence?.length) return {};
  const i = clamp(Math.floor(index), 0, sequence.length - 1);
  const alpha = clamp(Number(subProgress) || 0, 0, 1);
  if (i >= sequence.length - 1 || alpha <= 0.001) {
    return { ...(sequence[i]?.bones ?? {}) };
  }
  const a = sequence[i].bones ?? {};
  const b = sequence[i + 1].bones ?? {};
  const bones = {};
  for (const alias of profile.activeBones ?? []) {
    const ra = a[alias] ?? { rx: 0, ry: 0, rz: 0 };
    const rb = b[alias] ?? { rx: 0, ry: 0, rz: 0 };
    bones[alias] = {
      rx: round(lerp(ra.rx, rb.rx, alpha)),
      ry: round(lerp(ra.ry, rb.ry, alpha)),
      rz: round(lerp(ra.rz, rb.rz, alpha)),
    };
  }
  return bones;
}

function buildMatch(profile, session, pose, score, motionPeak, motionDelta, held) {
  const seqIdx = session.sequenceIndex;
  const keyframe = profile.sequence[seqIdx];
  const displayPose = interpolateSequencePose(profile, seqIdx, session.subProgress);
  const heatmap = buildHeatmap(profile, pose);

  return {
    profile,
    mode: profile.id,
    name: profile.name,
    score: round(score),
    motionPeak: round(motionPeak),
    motionDelta: round(motionDelta),
    phase: session.phase,
    held: held || session.phase === 'hold',
    sequenceIndex: seqIdx,
    sequenceLength: profile.sequenceLength,
    sequenceProgress: round(profile.sequenceLength > 1 ? (seqIdx + session.subProgress) / (profile.sequenceLength - 1) : 0),
    subProgress: round(session.subProgress),
    targetKeyframe: keyframe,
    targetPose: displayPose,
    displayPose,
    heatmap,
    holdWindow: profile.holdWindow ?? null,
  };
}

function buildHeatmap(profile, pose) {
  const minPeak = 6;
  return profile.sequence.map((frame) => (
    scorePoseAgainstKeyframe(pose, frame, profile.activeBones, minPeak)
  ));
}

function scoreBestInWindow(profile, pose, start, end, minPeak) {
  let best = { index: start, score: 0 };
  for (let i = start; i <= end; i++) {
    const score = scorePoseAgainstKeyframe(pose, profile.sequence[i], profile.activeBones, minPeak);
    if (score > best.score) {
      best = { index: i, score };
    }
  }
  return best;
}

function estimateIndexFromMotionCurve(profile, pose, minIndex, maxIndex) {
  const curve = profile._motionCurve;
  if (!curve?.length) return minIndex;
  const liveMag = poseMotionMagnitude(pose, profile.activeBones);
  const target = profile._peakMagnitude > 0
    ? clamp(liveMag / profile._peakMagnitude, 0, 1)
    : 0;
  let best = minIndex;
  let bestDist = Infinity;
  for (let i = minIndex; i <= maxIndex; i++) {
    const dist = Math.abs((curve[i] ?? 0) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function estimateSubProgress(profile, pose, index, minPeak) {
  if (index >= profile.sequence.length - 1) return 0;
  const scoreA = scorePoseAgainstKeyframe(pose, profile.sequence[index], profile.activeBones, minPeak);
  const scoreB = scorePoseAgainstKeyframe(pose, profile.sequence[index + 1], profile.activeBones, minPeak);
  const distA = Math.max(0.5, 100 - scoreA);
  const distB = Math.max(0.5, 100 - scoreB);
  return clamp(distA / (distA + distB), 0, 1);
}

export function scorePoseAgainstKeyframe(pose, keyframe, activeBones, minPeak = 6) {
  const scores = [];
  for (const alias of activeBones) {
    const target = keyframe?.bones?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
    const current = pose[alias] ?? { rx: 0, ry: 0, rz: 0 };
    for (const axis of AXES) {
      const expected = Number(target[axis]) || 0;
      const value = Number(current[axis]) || 0;
      if (Math.abs(expected) < minPeak * 0.35 && Math.abs(value) < minPeak * 0.35) continue;
      const denom = Math.max(Math.abs(expected), minPeak, 4);
      scores.push(clamp(100 - (Math.abs(value - expected) / denom) * 100, 0, 100));
    }
  }
  return round(scores.length ? average(scores) : 0);
}

export function computeMotionPeak(pose, activeBones) {
  let peak = 0;
  for (const alias of activeBones) {
    const rot = pose[alias] ?? {};
    for (const axis of AXES) {
      peak = Math.max(peak, Math.abs(Number(rot[axis]) || 0));
    }
  }
  return peak;
}

export function computeMotionDelta(buffer, activeBones) {
  if (!buffer || buffer.length < 2) return 0;
  const prev = buffer.at(-2).pose;
  const curr = buffer.at(-1).pose;
  let maxDelta = 0;
  for (const alias of activeBones) {
    for (const axis of AXES) {
      maxDelta = Math.max(
        maxDelta,
        Math.abs((Number(curr[alias]?.[axis]) || 0) - (Number(prev[alias]?.[axis]) || 0)),
      );
    }
  }
  return maxDelta;
}

export function isNearBasePose(pose, activeBones, tolerance) {
  if (!activeBones?.length) return true;
  return activeBones.every((alias) => {
    const rot = pose[alias] ?? {};
    return Math.max(Math.abs(rot.rx || 0), Math.abs(rot.ry || 0), Math.abs(rot.rz || 0)) <= tolerance;
  });
}

function frameMotionMagnitude(frame, activeBones) {
  let sum = 0;
  for (const alias of activeBones) {
    const rot = frame?.bones?.[alias] ?? {};
    for (const axis of AXES) {
      sum += Math.abs(Number(rot[axis]) || 0);
    }
  }
  return sum;
}

function poseMotionMagnitude(pose, activeBones) {
  return frameMotionMagnitude({ bones: pose }, activeBones);
}

function average(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
