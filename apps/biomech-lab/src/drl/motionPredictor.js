import { BONE_ORDER } from '../core/boneMap.js';

export class MotionPredictor {
  constructor(historySize = 5) {
    this.historySize = historySize;
    this.history = [];
  }

  reset() {
    this.history = [];
  }

  pushCleanPose(pose) {
    this.history.push(clonePose(pose));
    if (this.history.length > this.historySize) this.history.shift();
  }

  reconstruct(corruptedPose, mask) {
    const predicted = this.predictNext();
    const reconstructed = {};
    let reconstructedBones = 0;
    for (const alias of BONE_ORDER) {
      if (mask[alias] && corruptedPose[alias]) {
        reconstructed[alias] = { ...corruptedPose[alias] };
      } else {
        reconstructed[alias] = { ...(predicted[alias] ?? { rx: 0, ry: 0, rz: 0 }) };
        reconstructedBones += 1;
      }
    }
    return { pose: reconstructed, reconstructedBones };
  }

  predictNext() {
    const last = this.history.at(-1);
    const previous = this.history.at(-2);
    if (!last || !previous) return clonePose(last ?? {});
    const predicted = {};
    for (const alias of BONE_ORDER) {
      const a = last[alias] ?? { rx: 0, ry: 0, rz: 0 };
      const b = previous[alias] ?? { rx: 0, ry: 0, rz: 0 };
      predicted[alias] = {
        rx: a.rx + (a.rx - b.rx) * 0.65,
        ry: a.ry + (a.ry - b.ry) * 0.65,
        rz: a.rz + (a.rz - b.rz) * 0.65,
      };
    }
    return predicted;
  }
}

function clonePose(pose) {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { ...(pose[alias] ?? { rx: 0, ry: 0, rz: 0 }) }]));
}
