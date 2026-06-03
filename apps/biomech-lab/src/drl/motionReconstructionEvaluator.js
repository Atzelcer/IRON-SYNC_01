import { BONE_ORDER } from '../core/boneMap.js';

export class MotionReconstructionEvaluator {
  evaluate({ cleanPose, reconstructedPose, previousPose, collisions, reward, noiseDiagnostics, config }) {
    const reconstructionError = averagePoseError(cleanPose, reconstructedPose);
    const smoothnessError = previousPose ? averagePoseVelocity(reconstructedPose, previousPose) : 0;
    const criticalCollisions = collisions.filter((item) => item.severity === 'critical').length;
    const highCollisions = collisions.filter((item) => item.severity === 'high').length;
    const validFrame = reward.valid && criticalCollisions === 0 && reconstructionError < 8 && smoothnessError < speedCeiling(config);
    const predictedCorrect = reconstructionError < 5.5;
    const smoothFrame = smoothnessError >= speedFloor(config) && smoothnessError <= speedCeiling(config);
    const latencyPenalty = (noiseDiagnostics.latencyFrames ?? 0) * 0.25;
    const noiseBonus = Math.max(0, (noiseDiagnostics.noiseTotal ?? 0) / 100 - reconstructionError / 18);
    const shapedReward =
      (reward.reward_total / 8)
      + (validFrame ? 8 : -4)
      + (predictedCorrect ? 4 : -2)
      + (smoothFrame ? 3 : -3)
      + noiseBonus
      - criticalCollisions * 16
      - highCollisions * 7
      - latencyPenalty
      - reconstructionError * 0.08;

    return {
      reward: shapedReward,
      validFrame,
      predictedCorrect,
      smoothFrame,
      reconstructionError,
      smoothnessError,
      criticalCollisions,
      highCollisions,
    };
  }
}

function averagePoseError(a, b) {
  let total = 0;
  let count = 0;
  for (const alias of BONE_ORDER) {
    const left = a?.[alias];
    const right = b?.[alias];
    if (!left || !right) continue;
    total += Math.abs(left.rx - right.rx) + Math.abs(left.ry - right.ry) + Math.abs(left.rz - right.rz);
    count += 3;
  }
  return count ? total / count : 0;
}

function averagePoseVelocity(a, b) {
  let total = 0;
  let count = 0;
  for (const alias of BONE_ORDER) {
    const left = a?.[alias];
    const right = b?.[alias];
    if (!left || !right) continue;
    total += Math.abs(left.rx - right.rx) + Math.abs(left.ry - right.ry) + Math.abs(left.rz - right.rz);
    count += 3;
  }
  return count ? total / count : 0;
}

function speedFloor(config) {
  return config.speedTarget === 'normal_fast' ? 0.08 : 0.04;
}

function speedCeiling(config) {
  return config.speedTarget === 'normal_fast' ? 15 : 11;
}
