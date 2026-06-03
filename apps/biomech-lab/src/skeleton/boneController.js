import { BONE_ORDER } from '../core/boneMap.js';
import { degreesToRadians, FRotator, FVector, IronSyncRotator, radiansToDegrees } from '../core/unrealTypes.js';
import { axisLimit, clampRotation } from './boneLimits.js';
import { UNREAL_INITIAL_POSE, getUnrealPose } from './unrealInitialPose.js';

export class BoneController {
  constructor(mapper) {
    this.mapper = mapper;
    this.savedPoses = [];
    this.initialPose = new Map();
    this.collisionGuard = null;
    for (const [alias, bone] of this.mapper.getBones()) {
      this.initialPose.set(alias, bone.rotation.clone());
    }
  }

  read(alias) {
    const bone = this.mapper.getBones().get(alias);
    if (!bone) return { rx: 0, ry: 0, rz: 0 };
    const initial = this.initialPose.get(alias);
    if (initial) {
      return {
        rx: radiansToDegrees(bone.rotation.x - initial.x),
        ry: radiansToDegrees(bone.rotation.y - initial.y),
        rz: radiansToDegrees(bone.rotation.z - initial.z),
      };
    }
    return {
      rx: radiansToDegrees(bone.rotation.x),
      ry: radiansToDegrees(bone.rotation.y),
      rz: radiansToDegrees(bone.rotation.z),
    };
  }

  readUnreal(alias) {
    const calibrated = getUnrealPose(alias);
    if (calibrated) {
      return {
        frotator: new FRotator(calibrated.rx, calibrated.ry, calibrated.rz),
        fvector: new FVector(calibrated.tx, calibrated.ty, calibrated.tz),
      };
    }
    const bone = this.mapper.getBones().get(alias);
    const rotation = this.read(alias);
    if (!bone) {
      return {
        frotator: new FRotator(rotation.rx, rotation.ry, rotation.rz),
        fvector: new FVector(),
      };
    }
    return {
      frotator: new FRotator(rotation.rx, rotation.ry, rotation.rz),
      fvector: FVector.fromThreeVector(bone.position),
    };
  }

  write(alias, rotation, { clamp = true, guard = true } = {}) {
    const bone = this.mapper.getBones().get(alias);
    if (!bone) return null;
    const next = clamp ? clampRotation(alias, rotation) : rotation;
    const initial = this.initialPose.get(alias);
    const previousDegrees = this.read(alias);
    this.#applyRotation(bone, initial, next);
    if (guard && this.collisionGuard && !this.collisionGuard(alias, next)) {
      const safe = this.#findSafeRotation(alias, bone, initial, previousDegrees, next);
      this.#applyRotation(bone, initial, safe);
      return safe;
    }
    return next;
  }

  writeMany(rotations, { clamp = true, guard = true } = {}) {
    const previous = this.#readPose();
    const next = {};
    for (const [alias, rotation] of Object.entries(rotations)) {
      if (!this.mapper.getBones().has(alias)) continue;
      next[alias] = clamp ? clampRotation(alias, rotation) : { ...rotation };
    }

    const previousAllowed = !guard || !this.collisionGuard || this.collisionGuard();
    this.#applyPose(next);
    if (guard && this.collisionGuard && previousAllowed && !this.collisionGuard()) {
      const safe = this.#findSafePose(previous, next);
      this.#applyPose(safe);
      return safe;
    }
    return next;
  }

  reset(alias) {
    const bone = this.mapper.getBones().get(alias);
    if (!bone) return null;
    const initial = this.initialPose.get(alias);
    if (initial) {
      bone.rotation.copy(initial);
      return this.read(alias);
    }
    return this.write(alias, { rx: 0, ry: 0, rz: 0 }, { clamp: false, guard: false });
  }

  resetPose() {
    for (const alias of BONE_ORDER) this.reset(alias);
  }

  applyUnrealInitialPose() {
    for (const alias of BONE_ORDER) {
      const pose = UNREAL_INITIAL_POSE[alias];
      const bone = this.mapper.getBones().get(alias);
      if (!pose || !bone) continue;
      bone.rotation.set(
        degreesToRadians(pose.rx),
        degreesToRadians(pose.ry),
        degreesToRadians(pose.rz),
        'XYZ',
      );
    }
  }

  limits(alias) {
    return {
      rx: axisLimit(alias, 'rx'),
      ry: axisLimit(alias, 'ry'),
      rz: axisLimit(alias, 'rz'),
    };
  }

  copyRotation(alias) {
    return JSON.stringify(this.read(alias));
  }

  savePose(name = `pose_${this.savedPoses.length + 1}`) {
    const pose = {};
    for (const alias of BONE_ORDER) pose[alias] = this.read(alias);
    this.savedPoses.push({ name, pose, createdAt: new Date().toISOString() });
    return this.savedPoses.at(-1);
  }

  snapshot() {
    return BONE_ORDER.map((alias) => ({ alias, rotator: new IronSyncRotator(this.read(alias).rx, this.read(alias).ry, this.read(alias).rz) }));
  }

  setCollisionGuard(guard) {
    this.collisionGuard = guard;
  }

  #readPose() {
    const pose = {};
    for (const alias of BONE_ORDER) {
      if (this.mapper.getBones().has(alias)) pose[alias] = this.read(alias);
    }
    return pose;
  }

  #findSafePose(from, to) {
    let safe = from;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 6; i += 1) {
      const mid = (low + high) * 0.5;
      const candidate = lerpPose(from, to, mid);
      this.#applyPose(candidate);
      if (this.collisionGuard()) {
        safe = candidate;
        low = mid;
      } else {
        high = mid;
      }
    }
    return safe;
  }

  #findSafeRotation(alias, bone, initial, from, to) {
    let safe = from;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 6; i += 1) {
      const mid = (low + high) * 0.5;
      const candidate = lerpRotation(from, to, mid);
      this.#applyRotation(bone, initial, candidate);
      if (this.collisionGuard(alias, candidate)) {
        safe = candidate;
        low = mid;
      } else {
        high = mid;
      }
    }
    return safe;
  }

  #applyRotation(bone, initial, rotation) {
    bone.rotation.x = (initial?.x ?? 0) + degreesToRadians(rotation.rx);
    bone.rotation.y = (initial?.y ?? 0) + degreesToRadians(rotation.ry);
    bone.rotation.z = (initial?.z ?? 0) + degreesToRadians(rotation.rz);
    updateSkeletonWorld(bone);
  }

  #applyPose(pose) {
    let firstBone = null;
    for (const [alias, rotation] of Object.entries(pose)) {
      const bone = this.mapper.getBones().get(alias);
      if (!bone) continue;
      const initial = this.initialPose.get(alias);
      bone.rotation.x = (initial?.x ?? 0) + degreesToRadians(rotation.rx);
      bone.rotation.y = (initial?.y ?? 0) + degreesToRadians(rotation.ry);
      bone.rotation.z = (initial?.z ?? 0) + degreesToRadians(rotation.rz);
      firstBone ??= bone;
    }
    if (firstBone) updateSkeletonWorld(firstBone);
  }
}

function lerpRotation(from, to, t) {
  return {
    rx: from.rx + (to.rx - from.rx) * t,
    ry: from.ry + (to.ry - from.ry) * t,
    rz: from.rz + (to.rz - from.rz) * t,
  };
}

function lerpPose(from, to, t) {
  const pose = {};
  for (const alias of BONE_ORDER) {
    const start = from[alias];
    const end = to[alias] ?? start;
    if (!start || !end) continue;
    pose[alias] = lerpRotation(start, end, t);
  }
  return pose;
}

function updateSkeletonWorld(bone) {
  let root = bone;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
}
