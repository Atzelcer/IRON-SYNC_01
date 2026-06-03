export class FrameRecorder {
  constructor() {
    this.frames = [];
    this.recording = false;
    this.startedAt = 0;
  }

  start(now = performance.now()) {
    this.frames = [];
    this.startedAt = now;
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  clear() {
    this.frames = [];
  }

  push({ now, rotations, reward, collisions }) {
    if (!this.recording) return;
    this.frames.push({
      time: Number(((now - this.startedAt) / 1000).toFixed(3)),
      bones: rotations,
      reward: Number(reward.reward_total.toFixed(3)),
      reward_components: {
        limits: reward.reward_limits,
        smoothness: reward.reward_smoothness,
        collision: reward.reward_collision,
        parent_child: reward.reward_parent_child,
        velocity: reward.reward_velocity,
        stability: reward.reward_stability,
      },
      collisions: collisions.map(({ a, b, label, severity }) => ({ a, b, label, severity })),
      valid: reward.valid,
    });
  }
}
