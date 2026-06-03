import { BONE_LABELS } from '../core/boneMap.js';
import { APPLIED_MOVEMENTS } from '../drl/appliedMovements.js';
import { resampleTrajectory } from '../preprocessing/sequenceMovementRecognizer.js';
import {
  buildAugmentedMovementDataset,
  exportAugmentedSamplesCsv,
} from './datasetAugment.js';

export const TRAINING_SAMPLE_COUNT = 10;
export const TRAINING_MOVEMENTS_PER_SAMPLE = 1;
/** Segundos iniciales para adoptar postura (mesh quieto). */
export const TRAINING_POSE_COUNTDOWN_SECONDS = 6;
/** Ciclos de animacion DRL de referencia antes de capturar (sin grabar). */
export const TRAINING_REFERENCE_DEMO_CYCLES = 2;
/** Pausa entre demos de referencia para volver a base. */
export const TRAINING_BETWEEN_DEMOS_SECONDS = 4;
/** Tras la prueba demo: pausa antes de la muestra 1. */
export const TRAINING_PRE_CAPTURE_COUNTDOWN_SECONDS = 4;
/** Pausa entre animaciones: luego demo de 1 movimiento. */
export const TRAINING_INTER_ANIMATION_SECONDS = 4;
/** Entre movimientos dentro de una muestra, si alguna rutina usa mas de 1 ciclo. */
export const TRAINING_BETWEEN_CYCLES_SECONDS = 4;
/** Entre muestras. */
export const TRAINING_BETWEEN_SAMPLES_SECONDS = 4;
export const TRAINING_APPROVAL_SCORE = 80;
/** Grados max. en huesos activos al terminar cada muestra (vuelta a base). */
export const TRAINING_MAX_RETURN_TO_BASE_ERROR = 8;
/** Grados max. en huesos activos al iniciar cada muestra. */
export const TRAINING_MAX_START_BASE_ERROR = 6;
export const MOVEMENT_TRAINING_SCHEMA = 'ironsync.movement-training.v4';

/** Definiciones oficiales: acciones simples de Movimientos - Aplicados. */
export const MOVEMENT_TRAINING_DEFINITIONS = APPLIED_MOVEMENTS;

export const MOVEMENT_TRAINING_REQUIRED_BONES = [
  ...new Set(MOVEMENT_TRAINING_DEFINITIONS.flatMap((definition) => definition.activeBones)),
];

export function getAnimationCycleDurationMs(definition) {
  return Math.max(900, Math.ceil(Number(definition?.durationMs) || 1800));
}

/** Nombre de carpeta seguro a partir del nombre registrado en el laboratorio. */
export function movementFolderName(definition) {
  const label = String(definition?.name ?? definition?.id ?? 'movimiento').trim();
  return label
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120) || 'movimiento';
}

export class MovementTrainingSession {
  constructor({ definitions = MOVEMENT_TRAINING_DEFINITIONS, sampleCount = TRAINING_SAMPLE_COUNT } = {}) {
    this.definitions = definitions;
    this.sampleCount = sampleCount;
    this.sessionId = createSessionId();
    this.reset();
  }

  reset() {
    this.sessionId = createSessionId();
    this.active = false;
    this.paused = false;
    this.animationFrozen = false;
    this.dataFrozen = false;
    this.phase = 'idle';
    this.animationIndex = 0;
    this.sampleIndex = 0;
    this.cycleIndex = 0;
    this.demoCycleIndex = 0;
    this.phaseStartedAt = 0;
    this.pausedAt = 0;
    this.currentCycleFrames = [];
    this.currentSampleCycles = [];
    this.results = new Map(this.definitions.map((definition) => [definition.id, {
      definition,
      samples: [],
      approved: false,
      forcedContinue: false,
      averageSimilarity: 0,
      minSimilarity: 0,
      maxSimilarity: 0,
      consistency: null,
      template: null,
    }]));
  }

  start(now = performance.now()) {
    this.reset();
    this.active = true;
    this.demoCycleIndex = 0;
    this.#beginPoseCountdown(now);
  }

  pause() {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
  }

  resume(now = performance.now()) {
    if (!this.active || !this.paused) return;
    const pausedDuration = this.pausedAt ? Math.max(0, now - this.pausedAt) : 0;
    this.paused = false;
    this.pausedAt = 0;
    this.phaseStartedAt += pausedDuration;
  }

  cancel() {
    this.active = false;
    this.paused = false;
    this.pausedAt = 0;
    this.phase = 'idle';
    this.#clearCaptureBuffers();
  }

  freezeAnimation() {
    this.animationFrozen = !this.animationFrozen;
  }

  freezeData() {
    this.dataFrozen = !this.dataFrozen;
  }

  repeatSample(now = performance.now()) {
    if (!this.active) return;
    this.cycleIndex = 0;
    this.#clearCaptureBuffers();
    this.#beginCaptureCycle(now);
  }

  repeatAnimation(now = performance.now()) {
    if (!this.active) return;
    const definition = this.currentDefinition();
    this.results.set(definition.id, {
      definition,
      samples: [],
      approved: false,
      forcedContinue: false,
      averageSimilarity: 0,
      minSimilarity: 0,
      maxSimilarity: 0,
      consistency: null,
      template: null,
    });
    this.sampleIndex = 0;
    this.cycleIndex = 0;
    this.demoCycleIndex = 0;
    this.#beginPoseCountdown(now);
  }

  configureMovement(definition) {
    if (!definition?.id) return;
    this.definitions = [definition];
    this.results = new Map([[definition.id, {
      definition,
      samples: [],
      approved: false,
      forcedContinue: false,
      averageSimilarity: 0,
      minSimilarity: 0,
      maxSimilarity: 0,
      consistency: null,
      template: null,
    }]]);
    this.animationIndex = 0;
  }

  continueDespiteFail(now = performance.now()) {
    if (!this.active || this.phase !== 'review_failed') return false;
    const result = this.currentResult();
    result.approved = false;
    result.forcedContinue = true;
    if (this.animationIndex >= this.definitions.length - 1) {
      this.active = false;
      this.phase = 'done';
      return true;
    }
    this.#beginInterAnimationPause(now);
    return true;
  }

  repeatFailedSampling(now = performance.now()) {
    if (!this.active || this.phase !== 'review_failed') return false;
    this.repeatAnimation(now);
    return true;
  }

  /** Re-evalua tras cambiar reglas o si quedo en review_failed con consistencia OK. */
  reconcileApprovalPhase() {
    const result = this.currentResult();
    if (!result || result.samples.length < this.sampleCount) return false;
    this.#validateCurrentAnimation();
    if (result.approved) {
      this.active = false;
      this.phase = 'done';
      return true;
    }
    if (this.phase !== 'review_failed') {
      this.active = false;
      this.phase = 'review_failed';
    }
    return false;
  }

  advanceAnimation(now = performance.now()) {
    if (!this.active) return;
    this.#advanceToNextAnimation(now);
  }

  currentDefinition() {
    return this.definitions[this.animationIndex] ?? this.definitions.at(-1);
  }

  observeFrame(rotations, now = performance.now()) {
    if (!this.active || this.paused || this.dataFrozen || this.phase !== 'capture_cycle') return;
    const definition = this.currentDefinition();
    const bones = {};
    for (const alias of definition.activeBones) {
      const rotation = rotations?.[alias];
      bones[alias] = {
        rx: Number(rotation?.rx) || 0,
        ry: Number(rotation?.ry) || 0,
        rz: Number(rotation?.rz) || 0,
      };
    }
    this.currentCycleFrames.push({
      t: now - this.phaseStartedAt,
      bones,
    });
  }

  tick(now = performance.now()) {
    const definition = this.currentDefinition();
    const cycleMs = getAnimationCycleDurationMs(definition);

    if (!this.active || this.paused) {
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'inter_animation_pause') {
      if (now - this.phaseStartedAt >= TRAINING_INTER_ANIMATION_SECONDS * 1000) {
        this.#beginAnimationDemo(now);
      }
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'pose_countdown') {
      if (now - this.phaseStartedAt >= TRAINING_POSE_COUNTDOWN_SECONDS * 1000) {
        this.#beginReferenceDemo(now);
      }
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'reference_demo') {
      if (now - this.phaseStartedAt >= cycleMs) {
        this.demoCycleIndex += 1;
        if (this.demoCycleIndex < TRAINING_REFERENCE_DEMO_CYCLES) {
          this.#beginBetweenDemos(now);
        } else {
          this.demoCycleIndex = 0;
          this.#beginPreCaptureCountdown(now);
        }
      }
      return {
        mode: definition.id,
        shouldAnimate: !this.animationFrozen,
        resetAgentClock: false,
      };
    }

    if (this.phase === 'between_demos') {
      if (now - this.phaseStartedAt >= TRAINING_BETWEEN_DEMOS_SECONDS * 1000) {
        this.#beginReferenceDemo(now, { keepDemoIndex: true });
      }
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'pre_capture_countdown') {
      if (now - this.phaseStartedAt >= TRAINING_PRE_CAPTURE_COUNTDOWN_SECONDS * 1000) {
        this.sampleIndex = 0;
        this.cycleIndex = 0;
        this.#beginCaptureCycle(now);
      }
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'animation_demo') {
      if (now - this.phaseStartedAt >= cycleMs) {
        this.#beginPreCaptureCountdown(now);
      }
      return {
        mode: definition.id,
        shouldAnimate: !this.animationFrozen,
        resetAgentClock: false,
      };
    }

    if (this.phase === 'pre_sample_countdown') {
      if (now - this.phaseStartedAt >= TRAINING_PRE_CAPTURE_COUNTDOWN_SECONDS * 1000) {
        this.sampleIndex = 0;
        this.cycleIndex = 0;
        this.#beginCaptureCycle(now);
      }
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'capture_cycle') {
      if (now - this.phaseStartedAt >= cycleMs) {
        this.#finishCurrentCycle(now);
      }
      return {
        mode: definition.id,
        shouldAnimate: !this.animationFrozen,
        resetAgentClock: false,
      };
    }

    if (this.phase === 'between_cycles') {
      if (now - this.phaseStartedAt >= TRAINING_BETWEEN_CYCLES_SECONDS * 1000) {
        this.#beginCaptureCycle(now);
      }
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'between_samples') {
      if (now - this.phaseStartedAt >= TRAINING_BETWEEN_SAMPLES_SECONDS * 1000) {
        if (this.sampleIndex < this.sampleCount) {
          this.cycleIndex = 0;
          this.#beginCaptureCycle(now);
        }
      }
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    if (this.phase === 'review_failed') {
      return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
    }

    return { mode: 'pause', shouldAnimate: false, resetAgentClock: false };
  }

  currentResult() {
    return this.results.get(this.currentDefinition().id);
  }

  summary() {
    const definition = this.currentDefinition();
    const result = this.currentResult();
    const elapsedSec = (performance.now() - this.phaseStartedAt) / 1000;
    let countdown = 0;
    if (this.phase === 'pose_countdown') {
      countdown = Math.max(0, TRAINING_POSE_COUNTDOWN_SECONDS - elapsedSec);
    } else if (this.phase === 'between_demos') {
      countdown = Math.max(0, TRAINING_BETWEEN_DEMOS_SECONDS - elapsedSec);
    } else if (this.phase === 'pre_capture_countdown' || this.phase === 'pre_sample_countdown') {
      countdown = Math.max(0, TRAINING_PRE_CAPTURE_COUNTDOWN_SECONDS - elapsedSec);
    } else if (this.phase === 'between_cycles') {
      countdown = Math.max(0, TRAINING_BETWEEN_CYCLES_SECONDS - elapsedSec);
    } else if (this.phase === 'between_samples') {
      countdown = Math.max(0, TRAINING_BETWEEN_SAMPLES_SECONDS - elapsedSec);
    } else if (
      this.phase === 'capture_cycle'
      || this.phase === 'reference_demo'
      || this.phase === 'animation_demo'
    ) {
      const cycleMs = getAnimationCycleDurationMs(definition);
      countdown = Math.max(0, cycleMs / 1000 - elapsedSec);
    }

    const allResults = [...this.results.values()];
    const completedAnimations = allResults.filter((item) => item.samples.length >= this.sampleCount).length;
    return {
      sessionId: this.sessionId,
      active: this.active,
      paused: this.paused,
      phase: this.phase,
      animationIndex: this.animationIndex,
      animationTotal: this.definitions.length,
      sampleIndex: Math.min(this.sampleIndex + 1, this.sampleCount),
      sampleCount: this.sampleCount,
      cycleIndex: this.cycleIndex + 1,
      cyclesPerSample: TRAINING_MOVEMENTS_PER_SAMPLE,
      demoCycleIndex: this.demoCycleIndex + 1,
      referenceDemoCycles: TRAINING_REFERENCE_DEMO_CYCLES,
      capturing: this.phase === 'capture_cycle',
      currentFrames: this.currentCycleFrames.length,
      countdown,
      animationFrozen: this.animationFrozen,
      dataFrozen: this.dataFrozen,
      completedAnimations,
      definition,
      result,
      allApproved: allResults.every((item) => item.approved),
      cycleDurationMs: getAnimationCycleDurationMs(definition),
    };
  }

  exportDataset({ unrealConnected = false, masterCalibration = null } = {}) {
    const results = [...this.results.values()];
    return {
      schema: MOVEMENT_TRAINING_SCHEMA,
      sessionId: this.sessionId,
      createdAt: new Date().toISOString(),
      unrealConnected,
      sampleCount: this.sampleCount,
      movementsPerSample: TRAINING_MOVEMENTS_PER_SAMPLE,
      approvalScore: TRAINING_APPROVAL_SCORE,
      recognitionMode: 'applied_midpoint_trigger',
      sourceCatalog: 'applied_movements',
      captureProtocol: {
        samples: this.sampleCount,
        movementsPerSample: TRAINING_MOVEMENTS_PER_SAMPLE,
        initialPoseSeconds: TRAINING_POSE_COUNTDOWN_SECONDS,
        demos: TRAINING_REFERENCE_DEMO_CYCLES,
        secondsBetweenDemos: TRAINING_BETWEEN_DEMOS_SECONDS,
        secondsBeforeCapture: TRAINING_PRE_CAPTURE_COUNTDOWN_SECONDS,
        secondsBetweenSamples: TRAINING_BETWEEN_SAMPLES_SECONDS,
        validation: 'consistencia_secuencia_1_a_10',
        activation: 'al_superar_50_por_ciento_del_movimiento',
      },
      masterCalibration: masterCalibration
        ? {
          id: masterCalibration.id,
          schema: masterCalibration.schema,
          createdAt: masterCalibration.createdAt,
        }
        : null,
      animations: results
        .filter((result) => result.approved && !result.forcedContinue)
        .map((result) => animationRecordFromResult(result)),
      rejectedAnimations: results
        .filter((result) => (!result.approved || result.forcedContinue) && result.samples.length > 0)
        .map((result) => ({
          animationId: result.definition.id,
          animationName: result.definition.name,
          averageSimilarity: round(result.averageSimilarity),
          minSimilarity: round(result.minSimilarity),
          reason: rejectionReason(result, this.sampleCount),
        })),
    };
  }

  exportAnimationDataset(animationId, { unrealConnected = false, masterCalibration = null } = {}) {
    const result = this.results.get(animationId);
    if (!result || result.samples.length === 0) return null;

    const approved = result.approved && !result.forcedContinue;
    const base = {
      schema: MOVEMENT_TRAINING_SCHEMA,
      sessionId: this.sessionId,
      createdAt: new Date().toISOString(),
      unrealConnected,
      sampleCount: this.sampleCount,
      movementsPerSample: TRAINING_MOVEMENTS_PER_SAMPLE,
      approvalScore: TRAINING_APPROVAL_SCORE,
      recognitionMode: 'applied_midpoint_trigger',
      sourceCatalog: 'applied_movements',
      captureProtocol: {
        samples: this.sampleCount,
        movementsPerSample: TRAINING_MOVEMENTS_PER_SAMPLE,
        initialPoseSeconds: TRAINING_POSE_COUNTDOWN_SECONDS,
        demos: TRAINING_REFERENCE_DEMO_CYCLES,
        secondsBetweenDemos: TRAINING_BETWEEN_DEMOS_SECONDS,
        secondsBeforeCapture: TRAINING_PRE_CAPTURE_COUNTDOWN_SECONDS,
        secondsBetweenSamples: TRAINING_BETWEEN_SAMPLES_SECONDS,
        validation: 'consistencia_secuencia_1_a_10',
        activation: 'al_superar_50_por_ciento_del_movimiento',
      },
      movementFolder: movementFolderName(result.definition),
      animationId: result.definition.id,
      animationName: result.definition.name,
      approved,
      masterCalibration: masterCalibration
        ? {
          id: masterCalibration.id,
          schema: masterCalibration.schema,
          createdAt: masterCalibration.createdAt,
        }
        : null,
      animations: [],
      rejectedAnimations: [],
    };

    if (approved) {
      base.animations = [animationRecordFromResult(result)];
    } else {
      base.rejectedAnimations = [{
        animationId: result.definition.id,
        animationName: result.definition.name,
        averageSimilarity: round(result.averageSimilarity),
        minSimilarity: round(result.minSimilarity),
        reason: rejectionReason(result, this.sampleCount),
        validation: result.validation ?? null,
        samples: result.samples,
      }];
    }

    return base;
  }

  #beginPoseCountdown(now) {
    this.phase = 'pose_countdown';
    this.phaseStartedAt = now;
    this.demoCycleIndex = 0;
    this.sampleIndex = 0;
    this.cycleIndex = 0;
    this.#clearCaptureBuffers();
  }

  #beginReferenceDemo(now, { keepDemoIndex = false } = {}) {
    this.phase = 'reference_demo';
    this.phaseStartedAt = now;
    if (!keepDemoIndex) this.demoCycleIndex = 0;
    this.#clearCaptureBuffers();
  }

  #beginBetweenDemos(now) {
    this.phase = 'between_demos';
    this.phaseStartedAt = now;
    this.#clearCaptureBuffers();
  }

  #beginPreCaptureCountdown(now) {
    this.phase = 'pre_capture_countdown';
    this.phaseStartedAt = now;
    this.#clearCaptureBuffers();
  }

  #beginAnimationDemo(now) {
    this.phase = 'animation_demo';
    this.phaseStartedAt = now;
    this.cycleIndex = 0;
    this.#clearCaptureBuffers();
  }

  #beginInterAnimationPause(now) {
    this.phase = 'inter_animation_pause';
    this.phaseStartedAt = now;
    this.#clearCaptureBuffers();
  }

  #beginCaptureCycle(now) {
    this.phase = 'capture_cycle';
    this.phaseStartedAt = now;
    this.currentCycleFrames = [];
  }

  #finishCurrentCycle(now) {
    const definition = this.currentDefinition();
    this.currentSampleCycles.push({
      cycleIndex: this.cycleIndex + 1,
      frames: [...this.currentCycleFrames],
      durationMs: this.currentCycleFrames.length
        ? this.currentCycleFrames.at(-1).t - this.currentCycleFrames[0].t
        : 0,
    });
    this.currentCycleFrames = [];
    this.cycleIndex += 1;

    if (this.cycleIndex < TRAINING_MOVEMENTS_PER_SAMPLE) {
      this.phase = 'between_cycles';
      this.phaseStartedAt = now;
      return;
    }

    this.#finishCurrentSample(now);
  }

  #finishCurrentSample(now) {
    const definition = this.currentDefinition();
    const result = this.currentResult();
    const allFrames = this.currentSampleCycles.flatMap((cycle) => cycle.frames);
    const sample = summarizeSample({
      definition,
      frames: allFrames,
      cycles: this.currentSampleCycles,
      sampleIndex: this.sampleIndex + 1,
    });
    result.samples.push(sample);
    this.sampleIndex += 1;
    this.cycleIndex = 0;
    this.#clearCaptureBuffers();

    if (this.sampleIndex < this.sampleCount) {
      this.phase = 'between_samples';
      this.phaseStartedAt = now;
      return;
    }

    this.#validateCurrentAnimation();
    if (!result.approved) {
      this.active = false;
      this.phase = 'review_failed';
      return;
    }
    this.active = false;
    this.phase = 'done';
  }

  #validateCurrentAnimation() {
    const result = this.currentResult();
    const activeBones = result.definition.activeBones;
    result.template = buildTemplate(result.samples);
    const normalizedSamples = result.samples.map((sample) => ({
      ...sample,
      similarityScore: round(sampleSimilarity(sample, result.template)),
    }));
    const consistency = result.samples.length === 1
      ? {
        average: normalizedSamples[0]?.similarityScore ?? 0,
        min: normalizedSamples[0]?.similarityScore ?? 0,
        max: normalizedSamples[0]?.similarityScore ?? 0,
        pairwiseCount: 1,
      }
      : measureSampleConsistency(normalizedSamples, activeBones);
    result.consistency = consistency;
    result.averageSimilarity = round(consistency.average);
    result.minSimilarity = round(consistency.min);
    result.maxSimilarity = round(consistency.max);
    result.samples = normalizedSamples.map((sample) => ({ ...sample, status: 'pendiente', valid: false }));
    const allSamplesPresent = result.samples.length >= this.sampleCount;
    const consistencyOk = consistency.average >= TRAINING_APPROVAL_SCORE
      && consistency.min >= TRAINING_APPROVAL_SCORE;
    const maxReturnToBaseError = Math.max(...result.samples.map((s) => Number(s.returnToBaseError) || 0), 0);
    const maxStartAtBaseError = Math.max(...result.samples.map((s) => Number(s.startAtBaseError) || 0), 0);
    const returnToBaseOk = maxReturnToBaseError <= TRAINING_MAX_RETURN_TO_BASE_ERROR;
    const startAtBaseOk = maxStartAtBaseError <= TRAINING_MAX_START_BASE_ERROR;
    result.validation = {
      consistencyOk,
      returnToBaseOk,
      startAtBaseOk,
      maxReturnToBaseError: round(maxReturnToBaseError),
      maxStartAtBaseError: round(maxStartAtBaseError),
      consistency,
      softWarnings: [
        !returnToBaseOk ? `retorno_a_base_${round(maxReturnToBaseError)}deg` : null,
        !startAtBaseOk ? `inicio_base_${round(maxStartAtBaseError)}deg` : null,
      ].filter(Boolean),
    };
    // Aprobacion oficial = consistencia >= 80% (promedio y minimo) con 10 muestras completas.
    result.approved = allSamplesPresent && consistencyOk;
    result.samples = result.samples.map((sample) => ({
      ...sample,
      status: result.approved ? 'valid' : 'rechazada',
      valid: result.approved,
    }));
    if (result.approved) {
      const animationDraft = {
        animationId: result.definition.id,
        animationName: result.definition.name,
        activeBones: result.definition.activeBones,
        targetPose: result.definition.targetPose ?? null,
        samples: result.samples,
        template: result.template,
      };
      result.augmented = buildAugmentedMovementDataset(animationDraft);
      if (result.augmented?.holdWindow) {
        result.holdWindow = result.augmented.holdWindow;
        result.durationMs = result.augmented.durationMs;
        result.masterTrajectory = result.augmented.masterTrajectory;
        result.sequenceProfile = result.augmented.sequenceProfile ?? null;
      }
    }
  }

  #advanceToNextAnimation(now) {
    if (this.animationIndex >= this.definitions.length - 1) {
      this.active = false;
      this.phase = 'done';
      return;
    }
    this.animationIndex += 1;
    this.sampleIndex = 0;
    this.#beginAnimationDemo(now);
  }

  #clearCaptureBuffers() {
    this.currentCycleFrames = [];
    this.currentSampleCycles = [];
  }
}

export function exportAugmentedMovementCsv(dataset) {
  const animation = dataset?.animations?.[0];
  if (!animation?.augmented) return '';
  const augmented = animation.augmented.syntheticSamples?.length
    ? animation.augmented
    : { ...animation.augmented, syntheticSamples: [] };
  return exportAugmentedSamplesCsv(animation, augmented);
}

/** JSON persistido sin trayectorias sinteticas (van en augmented_samples.csv). */
export function prepareDatasetForPersistence(dataset) {
  if (!dataset) return dataset;
  const clone = JSON.parse(JSON.stringify(dataset));
  for (const animation of clone.animations ?? []) {
    if (animation.augmented?.syntheticSamples?.length) {
      const { syntheticSamples, ...augmentedRest } = animation.augmented;
      animation.augmented = {
        ...augmentedRest,
        syntheticCount: syntheticSamples.length,
        syntheticSamplesInCsv: true,
      };
    }
  }
  return clone;
}

export function buildMovementCsvBundle(dataset) {
  return {
    samplesCsv: exportMovementTrainingCsv(dataset),
    summaryCsv: exportMovementTrainingSummaryCsv(dataset),
    trajectoryCsv: exportTrajectoryCsv(dataset),
    masterTrajectoryCsv: exportMasterTrajectoryCsv(dataset),
    augmentedSamplesCsv: exportAugmentedMovementCsv(dataset),
    discriminatorsCsv: exportDiscriminatorsCsv(dataset),
    envelopesCsv: exportEnvelopesCsv(dataset),
  };
}

export function exportMovementTrainingCsv(dataset) {
  const rows = [[
    'session_id', 'animation_id', 'animation_name', 'sample_index', 'movements_in_sample', 'sample_status', 'similarity_score',
    'active_bone', 'bone_label', 'frame_count', 'duration_ms',
    'rx_min', 'rx_max', 'rx_mean', 'rx_peak',
    'ry_min', 'ry_max', 'ry_mean', 'ry_peak',
    'rz_min', 'rz_max', 'rz_mean', 'rz_peak',
    'dominant_axis', 'dominant_peak', 'start_at_base_error', 'return_to_base_error', 'valid',
  ]];
  for (const animation of dataset.animations) {
    for (const sample of animation.samples) {
      for (const alias of animation.activeBones) {
        const stats = sample.bones[alias] ?? emptyStats();
        rows.push([
          dataset.sessionId,
          animation.animationId,
          animation.animationName,
          sample.sampleIndex,
          sample.movementCount ?? TRAINING_MOVEMENTS_PER_SAMPLE,
          sample.status,
          sample.similarityScore,
          alias,
          BONE_LABELS[alias] ?? alias,
          sample.frameCount,
          sample.durationMs,
          stats.rx.min, stats.rx.max, stats.rx.mean, stats.rx.peak,
          stats.ry.min, stats.ry.max, stats.ry.mean, stats.ry.peak,
          stats.rz.min, stats.rz.max, stats.rz.mean, stats.rz.peak,
          stats.dominantAxis,
          stats.dominantPeak,
          sample.startAtBaseError,
          sample.returnToBaseError,
          sample.valid,
        ]);
      }
    }
  }
  return toCsv(rows);
}

export function exportTrajectoryCsv(dataset) {
  const rows = [[
    'session_id', 'animation_id', 'animation_name', 'sample_kind', 'sample_index', 'duration_ms',
    'sequence_step', 'sequence_t', 'active_bone', 'rx', 'ry', 'rz',
  ]];
  for (const animation of dataset?.animations ?? []) {
    for (const sample of animation.samples ?? []) {
      if (!sample.trajectory?.length) continue;
      appendTrajectoryRows(rows, dataset, animation, 'real', sample.sampleIndex, sample.durationMs, sample.trajectory);
    }
  }
  return toCsv(rows);
}

export function exportMasterTrajectoryCsv(dataset) {
  const rows = [[
    'session_id', 'animation_id', 'animation_name', 'trajectory_kind', 'sequence_step', 'sequence_t',
    'active_bone', 'rx', 'ry', 'rz',
  ]];
  for (const animation of dataset?.animations ?? []) {
    const trajectory = animation.masterTrajectory ?? animation.augmented?.masterTrajectory;
    if (!trajectory?.length) continue;
    for (let step = 0; step < trajectory.length; step++) {
      const frame = trajectory[step];
      for (const alias of animation.activeBones ?? []) {
        const rot = frame.bones?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
        rows.push([
          dataset.sessionId,
          animation.animationId,
          animation.animationName,
          'master',
          step,
          frame.t,
          alias,
          rot.rx,
          rot.ry,
          rot.rz,
        ]);
      }
    }
  }
  return toCsv(rows);
}

export function exportDiscriminatorsCsv(dataset) {
  const rows = [[
    'session_id', 'animation_id', 'animation_name', 'active_bone', 'bone_label',
    'primary_axis', 'min_peak', 'expected_sign', 'template_peak', 'max_return_to_base',
  ]];
  for (const animation of dataset?.animations ?? []) {
    const discriminators = animation.recognition?.discriminators ?? {};
    const important = animation.recognition?.importantAxes ?? {};
    for (const alias of animation.activeBones ?? []) {
      const disc = discriminators[alias] ?? {};
      const imp = important[alias] ?? {};
      rows.push([
        dataset.sessionId,
        animation.animationId,
        animation.animationName,
        alias,
        BONE_LABELS[alias] ?? alias,
        disc.primaryAxis ?? imp.axis ?? '',
        disc.minPeak ?? '',
        disc.expectedSign ?? '',
        imp.peak ?? '',
        disc.maxReturnToBase ?? TRAINING_MAX_RETURN_TO_BASE_ERROR,
      ]);
    }
  }
  return toCsv(rows);
}

export function exportEnvelopesCsv(dataset) {
  const rows = [[
    'session_id', 'animation_id', 'animation_name', 'active_bone', 'axis', 'envelope_min', 'envelope_max', 'envelope_peak',
  ]];
  for (const animation of dataset?.animations ?? []) {
    const envelopes = animation.sequenceProfile?.envelopes
      ?? animation.augmented?.sequenceProfile?.envelopes
      ?? {};
    for (const alias of animation.activeBones ?? []) {
      const boneEnv = envelopes[alias] ?? {};
      for (const axis of ['rx', 'ry', 'rz']) {
        const band = boneEnv[axis];
        if (!band) continue;
        rows.push([
          dataset.sessionId,
          animation.animationId,
          animation.animationName,
          alias,
          axis,
          band.min,
          band.max,
          band.peak,
        ]);
      }
    }
  }
  return toCsv(rows);
}

export function exportMovementTrainingSummaryCsv(dataset) {
  const rows = [[
    'session_id', 'animation_id', 'animation_name', 'total_samples', 'valid_samples', 'bad_samples',
    'average_similarity', 'min_similarity', 'max_similarity',
    'max_return_to_base', 'max_start_at_base', 'duration_ms',
    'hold_start', 'hold_end', 'active_bones', 'approved', 'master_calibration_id',
  ]];
  for (const animation of dataset.animations ?? []) {
    const valid = animation.samples.filter((sample) => sample.valid).length;
    const hold = animation.holdWindow ?? animation.augmented?.holdWindow ?? {};
    const maxReturn = Math.max(...(animation.samples ?? []).map((s) => Number(s.returnToBaseError) || 0), 0);
    const maxStart = Math.max(...(animation.samples ?? []).map((s) => Number(s.startAtBaseError) || 0), 0);
    rows.push([
      dataset.sessionId,
      animation.animationId,
      animation.animationName,
      animation.samples.length,
      valid,
      animation.samples.length - valid,
      animation.averageSimilarity,
      animation.minSimilarity,
      animation.maxSimilarity,
      round(maxReturn),
      round(maxStart),
      animation.durationMs ?? animation.augmented?.durationMs ?? '',
      hold.start ?? '',
      hold.end ?? '',
      animation.activeBones.join('|'),
      animation.approved,
      dataset.masterCalibration?.id ?? '',
    ]);
  }
  return toCsv(rows);
}

function appendTrajectoryRows(rows, dataset, animation, kind, sampleIndex, durationMs, trajectory) {
  for (let step = 0; step < trajectory.length; step++) {
    const frame = trajectory[step];
    for (const alias of animation.activeBones ?? []) {
      const rot = frame.bones?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
      rows.push([
        dataset.sessionId,
        animation.animationId,
        animation.animationName,
        kind,
        sampleIndex,
        durationMs,
        step,
        frame.t,
        alias,
        rot.rx,
        rot.ry,
        rot.rz,
      ]);
    }
  }
}

function animationRecordFromResult(result) {
  const recognition = buildRecognitionProfile(result);
  return {
    animationId: result.definition.id,
    animationName: result.definition.name,
    source: 'applied_movements',
    actionId: result.definition.id,
    actionName: result.definition.name,
    activeBones: result.definition.activeBones,
    targetPose: result.definition.targetPose ?? null,
    activation: {
      type: 'midpoint',
      progress: 0.5,
      score: TRAINING_APPROVAL_SCORE,
      actionId: result.definition.id,
    },
    recognition,
    approved: true,
    averageSimilarity: round(result.averageSimilarity),
    minSimilarity: round(result.minSimilarity),
    maxSimilarity: round(result.maxSimilarity),
    validation: result.validation ?? null,
    template: result.template,
    samples: result.samples,
    durationMs: result.durationMs ?? result.augmented?.durationMs ?? null,
    holdWindow: result.holdWindow ?? result.augmented?.holdWindow ?? null,
    masterTrajectory: result.masterTrajectory ?? result.augmented?.masterTrajectory ?? null,
    sequenceProfile: result.sequenceProfile ?? result.augmented?.sequenceProfile ?? null,
    augmented: result.augmented ?? null,
  };
}

function rejectionReason(result, sampleCount) {
  if (result.forcedContinue) return 'continuado_sin_aprobar';
  if (result.samples.length < sampleCount) return 'muestras_incompletas';
  const validation = result.validation;
  if (validation?.returnToBaseOk === false) return 'retorno_a_base_excedido';
  if (validation?.startAtBaseOk === false) return 'inicio_lejos_de_base';
  if (validation?.consistencyOk === false) return 'consistencia_entre_muestras_bajo_80';
  return 'validacion_fallida';
}

function summarizeSample({ definition, frames, cycles, sampleIndex }) {
  const durationMs = frames.length ? frames.at(-1).t - frames[0].t : 0;
  const bones = {};
  for (const alias of definition.activeBones) {
    const series = frames.map((frame) => frame.bones[alias]).filter(Boolean);
    bones[alias] = summarizeBone(series);
  }
  const cycleEnds = (cycles ?? []).map((cycle) => cycle.frames?.at(-1)).filter(Boolean);
  const endFrames = cycleEnds.length ? cycleEnds : [frames.at(-1)].filter(Boolean);
  const returnToBaseError = average(endFrames.map((frame) => (
    average(definition.activeBones.map((alias) => {
      const last = frame?.bones?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
      return Math.max(Math.abs(last.rx), Math.abs(last.ry), Math.abs(last.rz));
    }))
  )));
  const startAtBaseError = average(definition.activeBones.map((alias) => {
    const first = frames[0]?.bones?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
    return Math.max(Math.abs(first.rx), Math.abs(first.ry), Math.abs(first.rz));
  }));
  return {
    sampleIndex,
    movementCount: cycles?.length ?? TRAINING_MOVEMENTS_PER_SAMPLE,
    cycles: (cycles ?? []).map((cycle) => ({
      cycleIndex: cycle.cycleIndex,
      frameCount: cycle.frames.length,
      durationMs: round(cycle.durationMs),
    })),
    status: 'pending',
    similarityScore: 100,
    frameCount: frames.length,
    durationMs: round(durationMs),
    bones,
    trajectory: buildSampleTrajectory(definition.activeBones, frames),
    startAtBaseError: round(startAtBaseError),
    returnToBaseError: round(returnToBaseError),
    valid: true,
  };
}

function buildSampleTrajectory(activeBones, frames) {
  if (!frames?.length) return [];
  return resampleTrajectory(activeBones, frames, 32);
}

function summarizeBone(values) {
  const axes = Object.fromEntries(['rx', 'ry', 'rz'].map((axis) => [axis, summarizeAxis(values.map((value) => value[axis]))]));
  const dominant = Object.entries(axes).sort((a, b) => Math.abs(b[1].peak) - Math.abs(a[1].peak))[0] ?? ['rx', { peak: 0 }];
  return {
    ...axes,
    dominantAxis: dominant[0],
    dominantPeak: round(dominant[1].peak),
  };
}

function summarizeAxis(values) {
  if (!values.length) return { min: 0, max: 0, mean: 0, peak: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = average(values);
  const peak = Math.abs(min) > Math.abs(max) ? min : max;
  return {
    min: round(min),
    max: round(max),
    mean: round(mean),
    peak: round(peak),
  };
}

function buildTemplate(samples) {
  const bones = {};
  const activeBones = Object.keys(samples[0]?.bones ?? {});
  for (const alias of activeBones) {
    bones[alias] = {};
    for (const axis of ['rx', 'ry', 'rz']) {
      bones[alias][axis] = {
        peak: round(average(samples.map((sample) => sample.bones[alias]?.[axis]?.peak ?? 0))),
        mean: round(average(samples.map((sample) => sample.bones[alias]?.[axis]?.mean ?? 0))),
      };
    }
  }
  return { bones };
}

function buildRecognitionProfile(result) {
  const templateBones = result.template?.bones ?? {};
  const importantAxes = Object.fromEntries(result.definition.activeBones.map((alias) => {
    const axes = templateBones[alias] ?? {};
    const dominant = ['rx', 'ry', 'rz']
      .map((axis) => ({ axis, peak: Number(axes[axis]?.peak) || 0 }))
      .sort((a, b) => Math.abs(b.peak) - Math.abs(a.peak))[0] ?? { axis: 'rx', peak: 0 };
    return [alias, {
      axis: dominant.axis,
      peak: round(dominant.peak),
    }];
  }));
  const discriminators = Object.fromEntries(result.definition.activeBones.map((alias) => {
    const imp = importantAxes[alias] ?? { axis: 'rx', peak: 0 };
    const signedPeak = Number(imp.peak) || 0;
    return [alias, {
      primaryAxis: imp.axis,
      minPeak: round(Math.max(6, Math.abs(signedPeak) * 0.45)),
      expectedSign: signedPeak >= 0 ? '+' : '-',
      maxReturnToBase: TRAINING_MAX_RETURN_TO_BASE_ERROR,
    }];
  }));
  return {
    threshold: TRAINING_APPROVAL_SCORE,
    mode: 'applied_midpoint_trigger',
    actionId: result.definition.id,
    activationProgress: 0.5,
    targetPose: result.definition.targetPose ?? null,
    activeBones: result.definition.activeBones,
    importantAxes,
    discriminators,
    holdWindow: result.holdWindow ?? result.augmented?.holdWindow ?? null,
    durationMs: result.durationMs ?? result.augmented?.durationMs ?? null,
  };
}

function sampleSimilarity(sample, template) {
  return sampleToSampleSimilarity(sample, templateToSampleShape(template), Object.keys(sample.bones));
}

function templateToSampleShape(template) {
  const bones = {};
  for (const [alias, axes] of Object.entries(template?.bones ?? {})) {
    bones[alias] = {
      rx: { peak: axes.rx?.peak ?? 0 },
      ry: { peak: axes.ry?.peak ?? 0 },
      rz: { peak: axes.rz?.peak ?? 0 },
    };
  }
  return { bones };
}

function measureSampleConsistency(samples, activeBones) {
  const pairwise = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      pairwise.push(sampleToSampleSimilarity(samples[i], samples[j], activeBones));
    }
  }
  if (!pairwise.length) {
    return { average: 0, min: 0, max: 0, pairwiseCount: 0 };
  }
  return {
    average: average(pairwise),
    min: Math.min(...pairwise),
    max: Math.max(...pairwise),
    pairwiseCount: pairwise.length,
  };
}

function sampleToSampleSimilarity(sampleA, sampleB, activeBones) {
  const scores = [];
  for (const alias of activeBones) {
    const statsA = sampleA.bones?.[alias];
    const statsB = sampleB.bones?.[alias];
    if (!statsA || !statsB) continue;
    for (const axis of ['rx', 'ry', 'rz']) {
      const peakA = statsA[axis]?.peak ?? 0;
      const peakB = statsB[axis]?.peak ?? 0;
      const denom = Math.max(8, Math.abs(peakA), Math.abs(peakB));
      scores.push(Math.max(0, 100 - (Math.abs(peakA - peakB) / denom) * 100));
    }
  }
  const peakScore = scores.length ? average(scores) : 0;
  const trajectoryScore = trajectorySimilarity(sampleA.trajectory, sampleB.trajectory, activeBones);
  if (!trajectoryScore) return peakScore;
  if (!peakScore) return trajectoryScore;
  return peakScore * 0.45 + trajectoryScore * 0.55;
}

function trajectorySimilarity(trajA, trajB, activeBones) {
  if (!trajA?.length || !trajB?.length) return 0;
  const steps = Math.min(trajA.length, trajB.length);
  const scores = [];
  for (let i = 0; i < steps; i++) {
    for (const alias of activeBones) {
      const a = trajA[i]?.bones?.[alias];
      const b = trajB[i]?.bones?.[alias];
      if (!a || !b) continue;
      for (const axis of ['rx', 'ry', 'rz']) {
        const va = Number(a[axis]) || 0;
        const vb = Number(b[axis]) || 0;
        const denom = Math.max(8, Math.abs(va), Math.abs(vb));
        scores.push(Math.max(0, 100 - (Math.abs(va - vb) / denom) * 100));
      }
    }
  }
  return scores.length ? average(scores) : 0;
}

function emptyStats() {
  return {
    rx: { min: 0, max: 0, mean: 0, peak: 0 },
    ry: { min: 0, max: 0, mean: 0, peak: 0 },
    rz: { min: 0, max: 0, mean: 0, peak: 0 },
    dominantAxis: 'rx',
    dominantPeak: 0,
  };
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createSessionId() {
  return `movement_${Date.now().toString(36)}`;
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
