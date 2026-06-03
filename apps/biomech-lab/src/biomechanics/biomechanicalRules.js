import { BONE_ORDER } from '../core/boneMap.js';
import { BONE_LIMITS, isOutOfLimit } from '../skeleton/boneLimits.js';

export function evaluateLimits(rotations) {
  const violations = [];
  for (const [alias, rotation] of Object.entries(rotations)) {
    for (const axis of ['rx', 'ry', 'rz']) {
      if (isOutOfLimit(alias, axis, rotation[axis])) {
        violations.push({ alias, axis, value: rotation[axis], limit: BONE_LIMITS[alias][axis] });
      }
    }
  }
  return violations;
}

export function evaluateVelocity(rotations, previousRotations, deltaSeconds) {
  if (!previousRotations || deltaSeconds <= 0) return { maxVelocity: 0, violations: [] };
  const violations = [];
  let maxVelocity = 0;
  for (const alias of BONE_ORDER) {
    const current = rotations[alias];
    const previous = previousRotations[alias];
    if (!current || !previous) continue;
    const delta =
      Math.abs(current.rx - previous.rx) +
      Math.abs(current.ry - previous.ry) +
      Math.abs(current.rz - previous.rz);
    const velocity = delta / deltaSeconds;
    maxVelocity = Math.max(maxVelocity, velocity);
    if (velocity > (BONE_LIMITS[alias]?.maxVelocity ?? 240)) {
      violations.push({ alias, velocity });
    }
  }
  return { maxVelocity, violations };
}

export function evaluateParentChild(rotations) {
  const issues = [];
  for (const [alias, limits] of Object.entries(BONE_LIMITS)) {
    if (!limits.parent) continue;
    const parent = rotations[limits.parent];
    const child = rotations[alias];
    if (!parent || !child) continue;
    const spread =
      Math.abs(parent.rx - child.rx) +
      Math.abs(parent.ry - child.ry) +
      Math.abs(parent.rz - child.rz);
    if (spread > 210) issues.push({ alias, parent: limits.parent, spread });
  }
  return issues;
}
