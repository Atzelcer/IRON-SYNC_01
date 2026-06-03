import { clampRotator } from '../core/constraints.js';
import { BONE_ORDER } from '../core/boneMap.js';
import { IronSyncRotator, degreesToRadians } from '../core/unrealTypes.js';

export class ProceduralAnimator {
  constructor(bones) {
    this.bones = bones;
    this.enabled = true;
    this.intensity = 0.42;
  }

  update(timeSeconds) {
    if (!this.enabled) return;
    for (const alias of BONE_ORDER) {
      const bone = this.bones.get(alias);
      if (!bone) continue;
      const phase = BONE_ORDER.indexOf(alias) * 0.43;
      const rotator = clampRotator(
        alias,
        new IronSyncRotator(
          Math.sin(timeSeconds * 1.4 + phase) * 18 * this.intensity,
          Math.cos(timeSeconds * 1.1 + phase) * 14 * this.intensity,
          Math.sin(timeSeconds * 0.8 + phase) * 10 * this.intensity,
        ),
      );
      bone.rotation.x = degreesToRadians(rotator.pitch);
      bone.rotation.y = degreesToRadians(rotator.yaw);
      bone.rotation.z = degreesToRadians(rotator.roll);
    }
  }
}
