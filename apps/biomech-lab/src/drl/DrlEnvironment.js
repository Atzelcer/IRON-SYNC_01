import { BONE_ORDER } from '../core/boneMap.js';
import { IronSyncRotator, degreesToRadians } from '../core/unrealTypes.js';
import { clampRotator } from '../core/constraints.js';

export class DrlEnvironment {
  constructor(bones) {
    this.bones = bones;
    this.lastAction = null;
    this.confidence = 0;
  }

  getState(frame, reward) {
    return {
      rotations: Object.fromEntries(frame.rotations.map(({ alias, rotator }) => [alias, rotator.toJSON()])),
      velocities: {
        smoothness: Number(frame.smoothness.toFixed(3)),
        angularVibration: Number(frame.angularVibration.toFixed(3)),
      },
      collisions: frame.collisions.map((item) => ({ a: item.a, b: item.b, label: item.label })),
      biomechanicalLimits: reward.limitViolations.length,
      reward: reward.total,
      timestamp: frame.timestamp,
    };
  }

  sampleAutonomousAction(timeSeconds) {
    const corrections = {};
    for (const alias of BONE_ORDER) {
      const phase = BONE_ORDER.indexOf(alias) * 0.31;
      corrections[alias] = new IronSyncRotator(
        Math.sin(timeSeconds * 1.7 + phase) * 1.1,
        Math.cos(timeSeconds * 1.3 + phase) * 0.9,
        Math.sin(timeSeconds * 0.9 + phase) * 0.7,
      );
    }
    this.lastAction = { mode: 'ppo-ready-autonomous', corrections };
    this.confidence = 0.74 + Math.sin(timeSeconds) * 0.08;
    return this.lastAction;
  }

  applyAction(action) {
    if (!action?.corrections) return;
    for (const [alias, delta] of Object.entries(action.corrections)) {
      const bone = this.bones.get(alias);
      if (!bone) continue;
      const current = IronSyncRotator.fromEuler(bone.rotation);
      const corrected = clampRotator(
        alias,
        current.clone({
          pitch: current.pitch + delta.pitch,
          yaw: current.yaw + delta.yaw,
          roll: current.roll + delta.roll,
        }),
      );
      bone.rotation.x = degreesToRadians(corrected.pitch);
      bone.rotation.y = degreesToRadians(corrected.yaw);
      bone.rotation.z = degreesToRadians(corrected.roll);
    }
  }
}
