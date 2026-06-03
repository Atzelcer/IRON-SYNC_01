import { BONE_ORDER } from '../core/boneMap.js';

export class NoiseSimulator {
  constructor() {
    this.latencyQueue = [];
  }

  reset() {
    this.latencyQueue = [];
  }

  corruptPose(pose, config) {
    const delayed = this.#latencyPose(pose, config.latencyFrames);
    const corrupted = {};
    const mask = {};
    let spikes = 0;
    let missing = 0;
    let noiseTotal = 0;

    for (const alias of BONE_ORDER) {
      const base = delayed[alias] ?? { rx: 0, ry: 0, rz: 0 };
      const isMissing = Math.random() < config.missingSensorRate;
      mask[alias] = isMissing ? 0 : 1;
      if (isMissing) missing += 1;
      const spike = Math.random() < config.spikeRate;
      if (spike) spikes += 1;
      const magnitude = config.noiseLevel * (spike ? 42 : 8);
      const noisy = {
        rx: base.rx + randomBetween(-magnitude, magnitude),
        ry: base.ry + randomBetween(-magnitude, magnitude),
        rz: base.rz + randomBetween(-magnitude, magnitude),
      };
      noiseTotal += Math.abs(noisy.rx - base.rx) + Math.abs(noisy.ry - base.ry) + Math.abs(noisy.rz - base.rz);
      corrupted[alias] = isMissing ? null : noisy;
    }

    return {
      pose: corrupted,
      mask,
      diagnostics: {
        missing,
        spikes,
        noiseTotal,
        latencyFrames: config.latencyFrames,
      },
    };
  }

  #latencyPose(pose, frames) {
    this.latencyQueue.push(clonePose(pose));
    if (this.latencyQueue.length <= frames) return clonePose(pose);
    while (this.latencyQueue.length > frames + 1) this.latencyQueue.shift();
    return clonePose(this.latencyQueue[0] ?? pose);
  }
}

function clonePose(pose) {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { ...(pose[alias] ?? { rx: 0, ry: 0, rz: 0 }) }]));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
