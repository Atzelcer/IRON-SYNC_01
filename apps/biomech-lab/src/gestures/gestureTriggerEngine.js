const AXES = ['rx', 'ry', 'rz'];

export class GestureTriggerEngine {
  constructor(library, options = {}) {
    this.library = library;
    this.threshold = options.threshold ?? 82;
    this.minPeak = options.minPeak ?? 5;
    this.holdMs = options.holdMs ?? 900;
    this.cooldownMs = options.cooldownMs ?? 400;
    this.enabled = false;
    this.activeAnimationId = null;
    this.activeSince = 0;
    this.lastTriggerAt = 0;
    this.lastMatch = null;
  }

  setOptions({ threshold, minPeak, holdMs, cooldownMs } = {}) {
    if (Number.isFinite(Number(threshold))) this.threshold = clamp(Number(threshold), 50, 99.9);
    if (Number.isFinite(Number(minPeak))) this.minPeak = clamp(Number(minPeak), 0, 60);
    if (Number.isFinite(Number(holdMs))) this.holdMs = clamp(Number(holdMs), 150, 8000);
    if (Number.isFinite(Number(cooldownMs))) this.cooldownMs = clamp(Number(cooldownMs), 0, 3000);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.#clearActive();
  }

  update(relativePose, now = performance.now()) {
    if (!this.enabled || !this.library?.loaded) {
      this.#clearActive();
      return null;
    }

    const match = this.#bestMatch(relativePose);
    this.lastMatch = match;

    if (match && match.score >= this.threshold && match.motionPeak >= this.minPeak) {
      if (this.activeAnimationId !== match.id) {
        if (now - this.lastTriggerAt < this.cooldownMs && this.activeAnimationId) {
          return { animationId: this.activeAnimationId, score: match.score, held: true };
        }
        this.activeAnimationId = match.id;
        this.activeSince = now;
        this.lastTriggerAt = now;
        return { animationId: match.id, score: match.score, triggered: true };
      }
      this.activeSince = now;
      return { animationId: match.id, score: match.score, held: true };
    }

    if (this.activeAnimationId && now - this.activeSince <= this.holdMs) {
      return { animationId: this.activeAnimationId, score: match?.score ?? 0, held: true };
    }

    const released = this.activeAnimationId;
    this.#clearActive();
    return released ? { released: true, animationId: released } : null;
  }

  shouldHoldAnimation() {
    return Boolean(this.activeAnimationId);
  }

  #bestMatch(pose) {
    let best = null;
    for (const profile of this.library.profiles) {
      const result = scoreProfile(profile, pose, this.minPeak);
      if (!best || result.score > best.score) best = result;
    }
    return best;
  }

  #clearActive() {
    this.activeAnimationId = null;
    this.activeSince = 0;
  }
}

function scoreProfile(profile, pose, minPeak) {
  const boneScores = [];
  let motionPeak = 0;

  for (const bone of profile.bones) {
    const current = pose[bone.alias] ?? { rx: 0, ry: 0, rz: 0 };
    const axisScores = [];
    for (const axis of AXES) {
      const target = bone.axes[axis] ?? 0;
      const currentValue = Number(current[axis]) || 0;
      motionPeak = Math.max(motionPeak, Math.abs(currentValue));
      if (Math.abs(target) < minPeak) continue;
      const denom = Math.max(Math.abs(target), minPeak, 1);
      const diff = Math.abs(currentValue - target);
      axisScores.push(clamp(100 - (diff / denom) * 100, 0, 100));
    }
    if (axisScores.length) boneScores.push(average(axisScores));
  }

  return {
    id: profile.id,
    name: profile.name,
    score: round(boneScores.length ? average(boneScores) : 0),
    motionPeak: round(motionPeak),
  };
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
