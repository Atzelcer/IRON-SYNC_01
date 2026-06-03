export const DEFAULT_TRAINING_CONFIG = {
  mode: 'dqn',
  targetAccuracy: 0.95,
  maxMinutes: 0,
  maxEpisodes: 0,
  maxEpisodeSteps: 180,
  minEvaluationFrames: 600,
  numEnvironments: 8,
  epsilonStart: 0.35,
  epsilonMin: 0.04,
  epsilonDecay: 0.996,
  learningRate: 0.012,
  gamma: 0.92,
  batchSize: 24,
  replaySize: 5000,
  checkpointEvery: 12,
  noiseLevel: 0.22,
  missingSensorRate: 0.12,
  spikeRate: 0.06,
  latencyFrames: 2,
  speedTarget: 'normal_fast',
};

export function normalizeTrainingConfig(input = {}) {
  const config = { ...DEFAULT_TRAINING_CONFIG, ...input };
  return {
    ...config,
    targetAccuracy: clamp(Number(config.targetAccuracy) || DEFAULT_TRAINING_CONFIG.targetAccuracy, 0.5, 0.999),
    maxMinutes: Math.max(0, Number(config.maxMinutes) || 0),
    maxEpisodes: Math.max(0, Math.floor(Number(config.maxEpisodes) || 0)),
    maxEpisodeSteps: clampInt(config.maxEpisodeSteps, 30, 2000),
    minEvaluationFrames: clampInt(config.minEvaluationFrames, 60, 20000),
    numEnvironments: clampInt(config.numEnvironments, 1, 256),
    epsilonStart: clamp(Number(config.epsilonStart) || DEFAULT_TRAINING_CONFIG.epsilonStart, 0, 1),
    epsilonMin: clamp(Number(config.epsilonMin) || DEFAULT_TRAINING_CONFIG.epsilonMin, 0, 0.5),
    epsilonDecay: clamp(Number(config.epsilonDecay) || DEFAULT_TRAINING_CONFIG.epsilonDecay, 0.9, 1),
    learningRate: clamp(Number(config.learningRate) || DEFAULT_TRAINING_CONFIG.learningRate, 0.0001, 0.2),
    gamma: clamp(Number(config.gamma) || DEFAULT_TRAINING_CONFIG.gamma, 0, 0.999),
    batchSize: clampInt(config.batchSize, 4, 256),
    replaySize: clampInt(config.replaySize, 100, 50000),
    checkpointEvery: clampInt(config.checkpointEvery, 1, 500),
    noiseLevel: clamp(Number(config.noiseLevel) || 0, 0, 1),
    missingSensorRate: clamp(Number(config.missingSensorRate) || 0, 0, 0.9),
    spikeRate: clamp(Number(config.spikeRate) || 0, 0, 0.8),
    latencyFrames: clampInt(config.latencyFrames, 0, 20),
    speedTarget: config.speedTarget === 'normal' ? 'normal' : 'normal_fast',
  };
}

function clampInt(value, min, max) {
  return Math.floor(clamp(Number(value) || min, min, max));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
