import { BONE_ORDER } from '../core/boneMap.js';
import { BONE_LIMITS, clampRotation } from '../skeleton/boneLimits.js';
import { Q_ACTIONS } from './qLearningAgent.js';
import { normalizeTrainingConfig } from './trainingConfig.js';
import { ReplayBuffer } from './replayBuffer.js';
import { NeuralQPolicy } from './neuralQPolicy.js';
import { NoiseSimulator } from './noiseSimulator.js';
import { MotionPredictor } from './motionPredictor.js';
import { MotionReconstructionEvaluator } from './motionReconstructionEvaluator.js';
import { ModelRegistry } from './modelRegistry.js';

const DQN_INPUT_SIZE = BONE_ORDER.length * 3 * 4 + BONE_ORDER.length + 8;

export class DrlTrainer {
  constructor({ controller, mapper }) {
    this.controller = controller;
    this.mapper = mapper;
    this.config = normalizeTrainingConfig();
    this.replay = new ReplayBuffer(this.config.replaySize);
    this.policy = new NeuralQPolicy({
      inputSize: DQN_INPUT_SIZE,
      actions: Q_ACTIONS,
      learningRate: this.config.learningRate,
      gamma: this.config.gamma,
    });
    this.registry = new ModelRegistry();
    this.noise = new NoiseSimulator();
    this.predictor = new MotionPredictor();
    this.evaluator = new MotionReconstructionEvaluator();
    this.mode = 'idle';
    this.startedAt = 0;
    this.episode = 0;
    this.episodeStep = 0;
    this.totalSteps = 0;
    this.epsilon = this.config.epsilonStart;
    this.lastTransition = null;
    this.lastActionIndex = 0;
    this.lastLoss = 0;
    this.lastEvaluation = null;
    this.bestAccuracy = 0;
    this.metrics = createMetrics();
    this.previousCleanPose = null;
    this.previousReconstructedPose = null;
    this.syntheticTime = 0;
  }

  get active() {
    return this.mode === 'training' || this.mode === 'evaluation';
  }

  start(configInput = {}) {
    this.config = normalizeTrainingConfig(configInput);
    this.replay.capacity = this.config.replaySize;
    const best = this.registry.bestPolicySnapshot();
    if (best) {
      this.policy = NeuralQPolicy.fromSnapshot(best, {
        learningRate: this.config.learningRate,
        gamma: this.config.gamma,
      }).inherit({ mutation: 0.01 });
      this.registry.markInherited();
    } else {
      this.policy = new NeuralQPolicy({
        inputSize: DQN_INPUT_SIZE,
        actions: Q_ACTIONS,
        learningRate: this.config.learningRate,
        gamma: this.config.gamma,
      });
    }
    this.mode = 'training';
    this.startedAt = performance.now();
    this.epsilon = this.config.epsilonStart;
    this.episode = 0;
    this.episodeStep = 0;
    this.totalSteps = 0;
    this.metrics = createMetrics();
    this.lastTransition = null;
    this.noise.reset();
    this.predictor.reset();
    this.previousCleanPose = null;
    this.previousReconstructedPose = null;
    this.syntheticTime = 0;
  }

  pause() {
    this.mode = 'paused';
    this.lastTransition = null;
  }

  resume() {
    if (this.mode === 'paused') this.mode = 'training';
  }

  stop() {
    if (this.mode === 'training') this.#checkpoint('stopped');
    this.mode = 'idle';
    this.lastTransition = null;
  }

  evaluate() {
    this.mode = 'evaluation';
    this.lastTransition = null;
  }

  reset() {
    this.stop();
    this.replay.clear();
    this.registry = new ModelRegistry();
    this.metrics = createMetrics();
    this.bestAccuracy = 0;
    this.lastEvaluation = null;
  }

  tick({ rotations, reward, collisions }) {
    if (!this.active) return;
    const cleanPose = this.mode === 'training'
      ? this.#trainingPose(rotations)
      : clonePose(rotations);
    this.predictor.pushCleanPose(cleanPose);
    const corrupted = this.noise.corruptPose(cleanPose, this.config);
    const reconstruction = this.predictor.reconstruct(corrupted.pose, corrupted.mask);
    const state = buildDqnState({
      cleanPose,
      reconstructedPose: reconstruction.pose,
      previousPose: this.previousCleanPose,
      mask: corrupted.mask,
      collisions,
      reward,
      diagnostics: corrupted.diagnostics,
    });
    const evalResult = this.evaluator.evaluate({
      cleanPose,
      reconstructedPose: reconstruction.pose,
      previousPose: this.previousReconstructedPose,
      collisions,
      reward,
      noiseDiagnostics: corrupted.diagnostics,
      config: this.config,
    });

    this.#recordMetrics(evalResult, corrupted.diagnostics, reconstruction.reconstructedBones);
    this.metrics.limitErrors += reward.diagnostics?.limitViolations?.length ?? 0;
    const liveWindow = this.#windowMetrics();
    if (liveWindow.accuracy > this.bestAccuracy) this.bestAccuracy = liveWindow.accuracy;
    if (this.mode === 'training'
      && liveWindow.accuracy >= this.config.targetAccuracy
      && this.metrics.frames >= this.config.minEvaluationFrames
      && this.metrics.window.length >= Math.min(240, this.config.minEvaluationFrames)) {
      this.#checkpoint('target_reached');
      this.stop();
      return;
    }
    if (this.lastTransition && this.mode === 'training') {
      this.replay.push({
        ...this.lastTransition,
        reward: evalResult.reward,
        nextState: state,
        done: this.#episodeDone(evalResult),
      });
      this.lastLoss = this.policy.train(this.replay.sample(this.config.batchSize));
    }

    const actionIndex = this.policy.chooseAction(state, this.mode === 'training' ? this.epsilon : 0);
    this.lastActionIndex = actionIndex;
    const action = Q_ACTIONS[actionIndex];
    const correctedPose = applyMacroAction(action, reconstruction.pose, collisions);
    this.controller.writeMany(correctedPose, { clamp: true, guard: true });

    this.lastTransition = { state, actionIndex };
    this.previousCleanPose = cleanPose;
    this.previousReconstructedPose = correctedPose;
    this.episodeStep += 1;
    this.totalSteps += 1;

    if (this.#episodeDone(evalResult)) this.#finishEpisode();
    if (this.mode === 'training' && this.#shouldCheckpoint()) this.#checkpoint('periodic');
    if (this.mode === 'training' && this.#shouldStop()) this.stop();
  }

  importBest(snapshot) {
    this.registry.importBest(snapshot);
    const policy = this.registry.bestPolicySnapshot();
    if (policy) this.policy = NeuralQPolicy.fromSnapshot(policy);
  }

  exportBestModel() {
    return {
      schema: 'ironsync.best-drl-model.v1',
      createdAt: new Date().toISOString(),
      bestAccuracy: this.bestAccuracy,
      metrics: this.#windowMetrics(),
      registry: this.registry.snapshot(),
      policy: this.registry.bestPolicySnapshot() ?? this.policy.snapshot(),
    };
  }

  exportTrainingMetrics() {
    return {
      schema: 'ironsync.drl-training-metrics.v1',
      createdAt: new Date().toISOString(),
      config: this.config,
      summary: this.summary(),
      replaySample: this.replay.snapshot(),
    };
  }

  exportReconstructionReport() {
    return {
      schema: 'ironsync.reconstruction-report.v1',
      createdAt: new Date().toISOString(),
      metrics: this.metrics,
      lastEvaluation: this.lastEvaluation,
    };
  }

  summary() {
    const window = this.#windowMetrics();
    return {
      mode: this.mode,
      episode: this.episode,
      episodeStep: this.episodeStep,
      totalSteps: this.totalSteps,
      generation: this.registry.generation,
      epsilon: this.epsilon,
      loss: this.lastLoss,
      action: Q_ACTIONS[this.lastActionIndex] ?? 'NOOP',
      accuracy: window.accuracy,
      bestAccuracy: this.bestAccuracy,
      rewardAverage: window.rewardAverage,
      smoothness: window.smoothness,
      latency: this.config.latencyFrames,
      noiseRemoved: window.noiseRemoved,
      reconstructedSensors: this.metrics.reconstructedSensors,
      predictionsCorrect: this.metrics.predictionsCorrect,
      collisions: this.metrics.collisions,
      criticalCollisions: this.metrics.criticalCollisions,
      limitErrors: this.metrics.limitErrors,
      inheritedUses: this.registry.inheritedUses,
      improvements: this.registry.improvements,
      replaySize: this.replay.length,
      exportReady: this.bestAccuracy >= this.config.targetAccuracy,
      targetAccuracy: this.config.targetAccuracy,
    };
  }

  #recordMetrics(result, noiseDiagnostics, reconstructedBones) {
    this.metrics.frames += 1;
    this.metrics.validFrames += result.validFrame ? 1 : 0;
    this.metrics.predictionsCorrect += result.predictedCorrect ? 1 : 0;
    this.metrics.smoothFrames += result.smoothFrame ? 1 : 0;
    this.metrics.rewardSum += result.reward;
    this.metrics.reconstructionErrorSum += result.reconstructionError;
    this.metrics.noiseInputSum += noiseDiagnostics.noiseTotal ?? 0;
    this.metrics.reconstructedSensors += reconstructedBones;
    this.metrics.spikes += noiseDiagnostics.spikes ?? 0;
    this.metrics.missingSensors += noiseDiagnostics.missing ?? 0;
    this.metrics.collisions += result.highCollisions + result.criticalCollisions;
    this.metrics.criticalCollisions += result.criticalCollisions;
    if (this.metrics.window.length >= 240) this.metrics.window.shift();
    this.metrics.window.push(result);
  }

  #finishEpisode() {
    const window = this.#windowMetrics();
    this.lastEvaluation = window;
    this.bestAccuracy = Math.max(this.bestAccuracy, window.accuracy);
    this.episode += 1;
    this.episodeStep = 0;
    this.epsilon = Math.max(this.config.epsilonMin, this.epsilon * this.config.epsilonDecay);
    this.lastTransition = null;
    this.noise.reset();
    if (window.accuracy >= this.bestAccuracy) this.#checkpoint('episode_best');
  }

  #windowMetrics() {
    const items = this.metrics.window;
    const frames = Math.max(1, items.length);
    const valid = items.filter((item) => item.validFrame).length;
    const predicted = items.filter((item) => item.predictedCorrect).length;
    const smooth = items.filter((item) => item.smoothFrame).length;
    const rewardAverage = items.reduce((sum, item) => sum + item.reward, 0) / frames;
    const reconstructionError = items.reduce((sum, item) => sum + item.reconstructionError, 0) / frames;
    const noiseAverage = this.metrics.frames ? this.metrics.noiseInputSum / this.metrics.frames : 0;
    const noiseRemoved = Math.max(0, Math.min(1, 1 - reconstructionError / Math.max(1, noiseAverage / 10)));
    return {
      accuracy: valid / frames,
      predictionAccuracy: predicted / frames,
      smoothness: smooth / frames,
      rewardAverage,
      reconstructionError,
      noiseRemoved,
    };
  }

  #episodeDone(result) {
    return this.episodeStep >= this.config.maxEpisodeSteps || result.criticalCollisions > 0;
  }

  #shouldCheckpoint() {
    return this.episode > 0 && this.episode % this.config.checkpointEvery === 0 && this.episodeStep === 0;
  }

  #checkpoint(reason) {
    const metrics = this.#windowMetrics();
    const checkpoint = this.registry.checkpoint({ policy: this.policy, metrics, reason });
    this.bestAccuracy = Math.max(this.bestAccuracy, checkpoint.metrics.accuracy ?? 0);
  }

  #shouldStop() {
    if (this.bestAccuracy >= this.config.targetAccuracy && this.metrics.frames >= this.config.minEvaluationFrames) return true;
    if (this.config.maxEpisodes > 0 && this.episode >= this.config.maxEpisodes) return true;
    if (this.config.maxMinutes > 0 && performance.now() - this.startedAt >= this.config.maxMinutes * 60000) return true;
    return false;
  }

  #trainingPose(currentPose) {
    this.syntheticTime += 1 / 60;
    const phase = this.syntheticTime * (this.config.speedTarget === 'normal_fast' ? 3.2 : 2.2);
    const uglyEvery = Math.floor(this.totalSteps / Math.max(1, this.config.maxEpisodeSteps * 0.25));
    const pose = clonePose(currentPose);
    for (const alias of BONE_ORDER) {
      const index = BONE_ORDER.indexOf(alias);
      const limits = BONE_LIMITS[alias];
      const hard = (uglyEvery + index) % 5 === 0;
      const gain = hard ? 0.92 : 0.42;
      pose[alias] = {
        rx: Math.sin(phase + index * 0.37) * limits.rx[1] * gain,
        ry: Math.cos(phase * 0.73 + index * 0.29) * Math.max(Math.abs(limits.ry[0]), Math.abs(limits.ry[1])) * gain,
        rz: Math.sin(phase * 1.21 + index * 0.41) * Math.max(Math.abs(limits.rz[0]), Math.abs(limits.rz[1])) * gain,
      };
    }

    if (uglyEvery % 3 === 0) {
      pose.hL.ry = -38;
      pose.hR.ry = 38;
      pose.fL.rx = 132;
      pose.fR.rx = 132;
    }
    if (uglyEvery % 4 === 0) {
      pose.tL.rz = -30;
      pose.tR.rz = 30;
      pose.knL.rz = -11;
      pose.knR.rz = 11;
    }
    if (uglyEvery % 6 === 0) {
      pose.chest.ry = 42;
      pose.head.ry = -58;
      pose.hL.rx = 70;
    }
    return Object.fromEntries(Object.entries(pose).map(([alias, rotation]) => [alias, clampRotation(alias, rotation)]));
  }
}

function createMetrics() {
  return {
    frames: 0,
    validFrames: 0,
    predictionsCorrect: 0,
    smoothFrames: 0,
    rewardSum: 0,
    reconstructionErrorSum: 0,
    noiseInputSum: 0,
    reconstructedSensors: 0,
    spikes: 0,
    missingSensors: 0,
    collisions: 0,
    criticalCollisions: 0,
    limitErrors: 0,
    window: [],
  };
}

function buildDqnState({ cleanPose, reconstructedPose, previousPose, mask, collisions, reward, diagnostics }) {
  const values = [];
  for (const alias of BONE_ORDER) {
    const clean = cleanPose[alias] ?? { rx: 0, ry: 0, rz: 0 };
    const reconstructed = reconstructedPose[alias] ?? clean;
    const previous = previousPose?.[alias] ?? clean;
    const limits = BONE_LIMITS[alias];
    for (const axis of ['rx', 'ry', 'rz']) values.push(normalize(reconstructed[axis], limits[axis]));
    for (const axis of ['rx', 'ry', 'rz']) values.push(clamp((reconstructed[axis] - previous[axis]) / 24, -1, 1));
    for (const axis of ['rx', 'ry', 'rz']) values.push(clamp((clean[axis] - reconstructed[axis]) / 35, -1, 1));
    for (const axis of ['rx', 'ry', 'rz']) values.push(normalize(clean[axis], limits[axis]));
    values.push(mask[alias] ? 1 : 0);
  }
  values.push(clamp(collisions.length / 8, 0, 1));
  values.push(collisions.some((item) => item.severity === 'critical') ? 1 : 0);
  values.push(reward.valid ? 1 : 0);
  values.push(clamp((reward.diagnostics?.maxVelocity ?? 0) / 260, 0, 1));
  values.push(clamp((diagnostics.noiseTotal ?? 0) / 600, 0, 1));
  values.push(clamp((diagnostics.missing ?? 0) / BONE_ORDER.length, 0, 1));
  values.push(clamp((diagnostics.spikes ?? 0) / BONE_ORDER.length, 0, 1));
  values.push(clamp((diagnostics.latencyFrames ?? 0) / 10, 0, 1));
  return values;
}

function applyMacroAction(action, pose, collisions) {
  const next = clonePose(pose);
  if (action === 'RESET_TO_SAFE_POSE') return zeroPose();
  if (action === 'STABILIZE_TORSO') stabilize(next, ['hip', 'chest', 'head'], 0.66);
  if (action === 'CENTER_HIP') stabilize(next, ['hip'], 0.4);
  if (action === 'RELAX_ARMS') stabilize(next, ['sL', 'fL', 'hL', 'sR', 'fR', 'hR'], 0.75);
  if (action === 'SEPARATE_ARMS') separateArms(next);
  if (action === 'SEPARATE_LEGS') separateLegs(next);
  if (action === 'REDUCE_VELOCITY') stabilize(next, BONE_ORDER, 0.88);
  if (action === 'SMOOTH_ALL') stabilize(next, BONE_ORDER, 0.78);
  if (action === 'COUNTER_COLLISION') counterCollision(next, collisions);
  if (action === 'DENOISE_SENSOR_FRAME') stabilize(next, BONE_ORDER, 0.68);
  if (action === 'RECALIBRATE_OFFSET') stabilize(next, ['hip', 'chest', 'head'], 0.32);
  if (action === 'RECONSTRUCT_MISSING_BONE') stabilize(next, BONE_ORDER, 0.84);
  if (action === 'PREDICT_NEXT_POSE') stabilize(next, BONE_ORDER, 0.94);
  if (action === 'INTERPOLATE_LOST_SENSOR') stabilize(next, BONE_ORDER, 0.86);
  if (action === 'REJECT_SPIKE') stabilize(next, BONE_ORDER, 0.54);
  if (action === 'LOCK_SAFE_LIMITS') stabilize(next, BONE_ORDER, 0.72);
  if (action === 'RECOVER_LATENCY') stabilize(next, BONE_ORDER, 0.9);
  return Object.fromEntries(Object.entries(next).map(([alias, rotation]) => [alias, clampRotation(alias, rotation)]));
}

function clonePose(pose) {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { ...(pose[alias] ?? { rx: 0, ry: 0, rz: 0 }) }]));
}

function zeroPose() {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { rx: 0, ry: 0, rz: 0 }]));
}

function stabilize(pose, aliases, factor) {
  for (const alias of aliases) {
    pose[alias].rx *= factor;
    pose[alias].ry *= factor;
    pose[alias].rz *= factor;
  }
}

function separateArms(pose) {
  pose.sL.rz = Math.max(pose.sL.rz + 8, 16);
  pose.fL.ry = Math.max(pose.fL.ry + 6, 8);
  pose.hL.ry = Math.max(pose.hL.ry + 6, 8);
  pose.sR.rz = Math.min(pose.sR.rz - 8, -16);
  pose.fR.ry = Math.min(pose.fR.ry - 6, -8);
  pose.hR.ry = Math.min(pose.hR.ry - 6, -8);
}

function separateLegs(pose) {
  pose.tL.rz = Math.max(pose.tL.rz + 5, 8);
  pose.ftL.rz = Math.max(pose.ftL.rz + 3, 5);
  pose.tR.rz = Math.min(pose.tR.rz - 5, -8);
  pose.ftR.rz = Math.min(pose.ftR.rz - 3, -5);
}

function counterCollision(pose, collisions) {
  if (collisions.some((item) => ['hL', 'fL', 'sL', 'hR', 'fR', 'sR'].includes(item.a) || ['hL', 'fL', 'sL', 'hR', 'fR', 'sR'].includes(item.b))) separateArms(pose);
  if (collisions.some((item) => ['tL', 'knL', 'ftL', 'tR', 'knR', 'ftR'].includes(item.a) || ['tL', 'knL', 'ftL', 'tR', 'knR', 'ftR'].includes(item.b))) separateLegs(pose);
  stabilize(pose, ['hip', 'chest', 'head'], 0.62);
}

function normalize(value, [min, max]) {
  return clamp(((value - min) / Math.max(1, max - min)) * 2 - 1, -1, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
