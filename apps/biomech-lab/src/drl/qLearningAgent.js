import { BONE_ORDER } from '../core/boneMap.js';
import { BONE_LIMITS, clampRotation } from '../skeleton/boneLimits.js';

export const Q_ACTIONS = [
  'NOOP',
  'STABILIZE_TORSO',
  'CENTER_HIP',
  'RELAX_ARMS',
  'SEPARATE_ARMS',
  'SEPARATE_LEGS',
  'REDUCE_VELOCITY',
  'RESET_TO_SAFE_POSE',
  'SMOOTH_ALL',
  'COUNTER_COLLISION',
  'DENOISE_SENSOR_FRAME',
  'RECALIBRATE_OFFSET',
  'RECONSTRUCT_MISSING_BONE',
  'PREDICT_NEXT_POSE',
  'INTERPOLATE_LOST_SENSOR',
  'REJECT_SPIKE',
  'LOCK_SAFE_LIMITS',
  'RECOVER_LATENCY',
];

const CRITICAL_SEVERITIES = new Set(['critical', 'high']);
const ARM_BONES = new Set(['sL', 'fL', 'hL', 'sR', 'fR', 'hR']);
const LEG_BONES = new Set(['tL', 'knL', 'ftL', 'tR', 'knR', 'ftR']);
const TORSO_BONES = new Set(['hip', 'chest', 'head']);

export class QLearningAgent {
  constructor({ controller, mapper }) {
    this.controller = controller;
    this.mapper = mapper;
    this.qTable = new Map();
    this.transitions = [];
    this.trainingLog = [];
    this.mode = 'idle';
    this.alpha = 0.18;
    this.gamma = 0.92;
    this.epsilon = 0.35;
    this.minEpsilon = 0.05;
    this.epsilonDecay = 0.992;
    this.maxEpisodeSteps = 160;
    this.episode = 0;
    this.episodeStep = 0;
    this.episodeReward = 0;
    this.successes = 0;
    this.validStreak = 0;
    this.lastAction = 'NOOP';
    this.lastStateKey = 'none';
    this.pending = null;
  }

  get active() {
    return this.mode === 'training' || this.mode === 'evaluation';
  }

  get qtableReady() {
    return this.qTable.size > 0;
  }

  startTraining() {
    this.mode = 'training';
    this.pending = null;
    this.episodeStep = 0;
    this.episodeReward = 0;
    this.validStreak = 0;
    this.#resetEpisodePose();
  }

  startEvaluation() {
    this.mode = 'evaluation';
    this.pending = null;
    this.episodeStep = 0;
    this.episodeReward = 0;
    this.validStreak = 0;
    this.controller.resetPose();
  }

  pause() {
    this.mode = 'idle';
    this.pending = null;
  }

  resetQTable() {
    this.qTable.clear();
    this.transitions = [];
    this.trainingLog = [];
    this.episode = 0;
    this.episodeStep = 0;
    this.episodeReward = 0;
    this.successes = 0;
    this.validStreak = 0;
    this.pending = null;
    this.lastAction = 'NOOP';
    this.lastStateKey = 'none';
  }

  tick({ rotations, reward, collisions, sensorRows, mappedCount, now }) {
    if (!this.active) return;

    const state = buildDiscreteState({ rotations, reward, collisions, sensorRows, mappedCount });
    this.lastStateKey = state.key;
    const done = this.#isEpisodeDone(reward, collisions);
    this.episodeReward += reward.reward_total;
    this.episodeStep += 1;

    if (reward.valid && collisions.length === 0) this.validStreak += 1;
    else this.validStreak = 0;

    if (this.pending && this.mode === 'training') {
      this.#updateQValue(this.pending.stateKey, this.pending.action, reward.reward_total, state.key, done);
      this.transitions.push({
        state: this.pending.stateKey,
        action: this.pending.action,
        reward: reward.reward_total,
        next_state: state.key,
        done,
        timestamp: new Date(now || Date.now()).toISOString(),
      });
      if (this.transitions.length > 5000) this.transitions.shift();
    }

    if (done) {
      this.#finishEpisode(reward);
      if (this.mode === 'training') this.#resetEpisodePose();
      else this.controller.resetPose();
      this.pending = null;
      return;
    }

    const action = this.#chooseAction(state.key);
    this.lastAction = action;
    this.#applyAction(action, rotations, collisions);
    this.pending = { stateKey: state.key, action };
  }

  snapshot() {
    return {
      schema: 'ironsync.qtable.v1',
      mode: this.mode,
      episode: this.episode,
      epsilon: this.epsilon,
      alpha: this.alpha,
      gamma: this.gamma,
      actions: Q_ACTIONS,
      qtable: Object.fromEntries(this.qTable.entries()),
    };
  }

  summary() {
    const episodes = Math.max(1, this.episode);
    return {
      mode: this.mode,
      episode: this.episode,
      episodeStep: this.episodeStep,
      reward: this.episodeReward,
      epsilon: this.epsilon,
      lastAction: this.lastAction,
      stateKey: this.lastStateKey,
      qtableSize: this.qTable.size,
      transitions: this.transitions.length,
      successRate: this.successes / episodes,
      qtableReady: this.qtableReady,
    };
  }

  #ensureState(stateKey) {
    if (!this.qTable.has(stateKey)) {
      this.qTable.set(stateKey, Object.fromEntries(Q_ACTIONS.map((action) => [action, 0])));
    }
    return this.qTable.get(stateKey);
  }

  #chooseAction(stateKey) {
    const qValues = this.#ensureState(stateKey);
    if (this.mode === 'training' && Math.random() < this.epsilon) {
      return Q_ACTIONS[Math.floor(Math.random() * Q_ACTIONS.length)];
    }
    return Q_ACTIONS.reduce((best, action) => (qValues[action] > qValues[best] ? action : best), Q_ACTIONS[0]);
  }

  #updateQValue(stateKey, action, reward, nextStateKey, done) {
    const qValues = this.#ensureState(stateKey);
    const nextValues = Object.values(this.#ensureState(nextStateKey));
    const future = done ? 0 : Math.max(...nextValues);
    qValues[action] += this.alpha * (reward + this.gamma * future - qValues[action]);
  }

  #isEpisodeDone(reward, collisions) {
    const critical = collisions.some((item) => item.severity === 'critical');
    return this.episodeStep >= this.maxEpisodeSteps || (critical && this.episodeStep > 12) || this.validStreak >= 36;
  }

  #finishEpisode(reward) {
    const success = reward.valid && this.validStreak >= 18;
    if (success) this.successes += 1;
    this.trainingLog.push({
      episode: this.episode,
      steps: this.episodeStep,
      reward: this.episodeReward,
      epsilon: this.epsilon,
      success,
      qtableSize: this.qTable.size,
      timestamp: new Date().toISOString(),
    });
    if (this.trainingLog.length > 1200) this.trainingLog.shift();
    this.episode += 1;
    this.episodeStep = 0;
    this.episodeReward = 0;
    this.validStreak = 0;
    if (this.mode === 'training') this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
  }

  #resetEpisodePose() {
    this.controller.resetPose();
    const perturbation = {};
    for (const alias of BONE_ORDER) {
      if (!this.mapper.getBones().has(alias)) continue;
      const limits = BONE_LIMITS[alias];
      perturbation[alias] = {
        rx: randomBetween(limits.rx[0] * 0.28, limits.rx[1] * 0.28),
        ry: randomBetween(limits.ry[0] * 0.28, limits.ry[1] * 0.28),
        rz: randomBetween(limits.rz[0] * 0.28, limits.rz[1] * 0.28),
      };
    }
    this.controller.writeMany(perturbation, { clamp: true, guard: false });
  }

  #applyAction(action, rotations, collisions) {
    if (action === 'NOOP') return;
    if (action === 'RESET_TO_SAFE_POSE') {
      this.controller.resetPose();
      return;
    }

    const next = clonePose(rotations);
    if (action === 'STABILIZE_TORSO') stabilize(next, ['hip', 'chest', 'head'], 0.68);
    if (action === 'CENTER_HIP') stabilize(next, ['hip'], 0.42);
    if (action === 'RELAX_ARMS') stabilize(next, ['sL', 'fL', 'hL', 'sR', 'fR', 'hR'], 0.74);
    if (action === 'SEPARATE_ARMS') separateArms(next);
    if (action === 'SEPARATE_LEGS') separateLegs(next);
    if (action === 'REDUCE_VELOCITY') stabilize(next, BONE_ORDER, 0.9);
    if (action === 'SMOOTH_ALL') stabilize(next, BONE_ORDER, 0.78);
    if (action === 'COUNTER_COLLISION') counterCollision(next, collisions);
    if (action === 'DENOISE_SENSOR_FRAME') stabilize(next, BONE_ORDER, 0.7);
    if (action === 'RECALIBRATE_OFFSET') stabilize(next, ['hip', 'chest', 'head'], 0.35);
    if (action === 'RECONSTRUCT_MISSING_BONE') stabilize(next, BONE_ORDER, 0.82);
    if (action === 'PREDICT_NEXT_POSE') stabilize(next, BONE_ORDER, 0.92);
    if (action === 'INTERPOLATE_LOST_SENSOR') stabilize(next, BONE_ORDER, 0.86);
    if (action === 'REJECT_SPIKE') stabilize(next, BONE_ORDER, 0.55);
    if (action === 'LOCK_SAFE_LIMITS') stabilize(next, BONE_ORDER, 0.74);
    if (action === 'RECOVER_LATENCY') stabilize(next, BONE_ORDER, 0.88);

    this.controller.writeMany(clampPose(next), { clamp: true, guard: true });
  }
}

export function buildDiscreteState({ rotations, reward, collisions, sensorRows = [], mappedCount = BONE_ORDER.length }) {
  const critical = collisions.filter((item) => item.severity === 'critical').length;
  const high = collisions.filter((item) => item.severity === 'high').length;
  const penetrationTotal = collisions.reduce((sum, item) => sum + (item.penetration ?? 0), 0);
  const limitCount = reward?.diagnostics?.limitViolations?.length ?? 0;
  const maxVelocity = reward?.diagnostics?.maxVelocity ?? 0;
  const arms = collisions.filter((item) => ARM_BONES.has(item.a) || ARM_BONES.has(item.b));
  const legs = collisions.filter((item) => LEG_BONES.has(item.a) || LEG_BONES.has(item.b));
  const headArm = arms.some((item) => item.a === 'head' || item.b === 'head');
  const torsoArm = arms.some((item) => item.a === 'chest' || item.b === 'chest' || item.a === 'hip' || item.b === 'hip');
  const onlineRows = sensorRows.filter((row) => row.online).length;
  const expectedRows = sensorRows.length || BONE_ORDER.length;
  const healthRatio = sensorRows.length ? onlineRows / expectedRows : mappedCount / BONE_ORDER.length;
  const torsoTilt = maxAbsRotation(rotations, ['hip', 'chest'], ['rx', 'rz']);
  const torsoTwist = maxAbsRotation(rotations, ['hip', 'chest', 'head'], ['ry']);

  const components = {
    pose_valid: reward?.valid ? 'valid' : 'invalid',
    collision_level: collisionLevel({ collisions, critical, high, penetrationTotal }),
    limit_level: limitCount === 0 ? 'none' : limitCount <= 2 ? 'mild' : 'severe',
    velocity_level: maxVelocity < 90 ? 'stable' : maxVelocity < 190 ? 'fast' : 'unstable',
    torso_state: torsoTwist > 34 ? 'twisted' : torsoTilt > 22 ? 'leaning' : 'centered',
    arms_state: headArm ? 'head_collision' : torsoArm ? 'torso_collision' : arms.some((item) => CRITICAL_SEVERITIES.has(item.severity)) ? 'crossed' : 'safe',
    legs_state: legs.some((item) => CRITICAL_SEVERITIES.has(item.severity)) ? 'crossed' : maxAbsRotation(rotations, ['tL', 'tR', 'knL', 'knR'], ['rz', 'ry']) > 28 ? 'unstable' : 'safe',
    sensor_health: healthRatio >= 0.95 ? 'full' : healthRatio >= 0.6 ? 'partial' : 'poor',
  };

  return {
    ...components,
    collision_count: collisions.length,
    critical_count: critical,
    penetration_total: penetrationTotal,
    bone_collision_mask: collisionMask(collisions),
    key: Object.values(components).join('|'),
  };
}

function collisionLevel({ collisions, critical, high, penetrationTotal }) {
  if (critical > 0 || penetrationTotal > 0.08) return 'critical';
  if (high > 1 || collisions.length >= 5) return 'high';
  if (collisions.length >= 2) return 'medium';
  if (collisions.length === 1) return 'low';
  return 'none';
}

function collisionMask(collisions) {
  const mask = Object.fromEntries(BONE_ORDER.map((alias) => [alias, 0]));
  for (const item of collisions) {
    if (mask[item.a] !== undefined) mask[item.a] = 1;
    if (mask[item.b] !== undefined) mask[item.b] = 1;
  }
  return mask;
}

function maxAbsRotation(rotations, aliases, axes) {
  return aliases.reduce((max, alias) => {
    const rotation = rotations?.[alias] ?? {};
    return Math.max(max, ...axes.map((axis) => Math.abs(rotation[axis] ?? 0)));
  }, 0);
}

function clonePose(rotations) {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { ...(rotations[alias] ?? { rx: 0, ry: 0, rz: 0 }) }]));
}

function clampPose(pose) {
  return Object.fromEntries(Object.entries(pose).map(([alias, rotation]) => [alias, clampRotation(alias, rotation)]));
}

function stabilize(pose, aliases, factor) {
  for (const alias of aliases) {
    if (!pose[alias]) continue;
    pose[alias].rx *= factor;
    pose[alias].ry *= factor;
    pose[alias].rz *= factor;
  }
}

function separateArms(pose) {
  if (pose.sL) pose.sL.rz = Math.max(pose.sL.rz + 8, 16);
  if (pose.fL) pose.fL.ry = Math.max(pose.fL.ry + 6, 8);
  if (pose.hL) pose.hL.ry = Math.max(pose.hL.ry + 6, 8);
  if (pose.sR) pose.sR.rz = Math.min(pose.sR.rz - 8, -16);
  if (pose.fR) pose.fR.ry = Math.min(pose.fR.ry - 6, -8);
  if (pose.hR) pose.hR.ry = Math.min(pose.hR.ry - 6, -8);
}

function separateLegs(pose) {
  if (pose.tL) pose.tL.rz = Math.max(pose.tL.rz + 5, 8);
  if (pose.knL) pose.knL.rz *= 0.62;
  if (pose.ftL) pose.ftL.rz = Math.max(pose.ftL.rz + 3, 5);
  if (pose.tR) pose.tR.rz = Math.min(pose.tR.rz - 5, -8);
  if (pose.knR) pose.knR.rz *= 0.62;
  if (pose.ftR) pose.ftR.rz = Math.min(pose.ftR.rz - 3, -5);
}

function counterCollision(pose, collisions) {
  const hasArmHit = collisions.some((item) => ARM_BONES.has(item.a) || ARM_BONES.has(item.b));
  const hasLegHit = collisions.some((item) => LEG_BONES.has(item.a) || LEG_BONES.has(item.b));
  const hasTorsoHit = collisions.some((item) => TORSO_BONES.has(item.a) || TORSO_BONES.has(item.b));
  if (hasArmHit) separateArms(pose);
  if (hasLegHit) separateLegs(pose);
  if (hasTorsoHit) stabilize(pose, ['hip', 'chest', 'head'], 0.6);
  if (!hasArmHit && !hasLegHit && !hasTorsoHit) stabilize(pose, BONE_ORDER, 0.82);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
