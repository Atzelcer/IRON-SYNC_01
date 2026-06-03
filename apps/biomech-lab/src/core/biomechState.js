import { IronSyncRotator, IronSyncVector } from './unrealTypes.js';

export function createFrameState({ bones, previousFrame, collisions }) {
  const rotations = [];
  const positions = [];
  let smoothness = 0;
  let angularVibration = 0;

  for (const [alias, bone] of bones.entries()) {
    const rotator = IronSyncRotator.fromEuler(bone.rotation);
    const position = new IronSyncVector(bone.position.x, bone.position.y, bone.position.z);
    const previous = previousFrame?.rotations.find((item) => item.alias === alias)?.rotator;

    if (previous) {
      const delta =
        Math.abs(rotator.pitch - previous.pitch) +
        Math.abs(rotator.yaw - previous.yaw) +
        Math.abs(rotator.roll - previous.roll);
      smoothness += delta / 3;
      angularVibration = Math.max(angularVibration, delta);
    }

    rotations.push({ alias, rotator });
    positions.push({ alias, position });
  }

  const count = Math.max(1, rotations.length);
  return {
    timestamp: performance.now(),
    rotations,
    positions,
    collisions,
    smoothness: smoothness / count,
    angularVibration,
    coherenceScore: calculateCoherence(rotations, collisions),
  };
}

function calculateCoherence(rotations, collisions) {
  const base = rotations.length > 0 ? 0.9 : 0.0;
  return Math.max(0, base - collisions.length * 0.12);
}
