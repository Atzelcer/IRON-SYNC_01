import { buildSequenceProfile, resampleTrajectory } from '../preprocessing/sequenceMovementRecognizer.js';

/** Total de muestras por movimiento: 3 reales + sintéticas hasta completar 600. */
export const AUGMENTED_TOTAL_TARGET = 600;
export const SEQUENCE_KEYFRAMES = 64;

export function buildAugmentedMovementDataset(animation) {
  const realSamples = (animation?.samples ?? []).filter((s) => s.valid !== false && s.trajectory?.length);
  if (!realSamples.length) return null;

  const activeBones = animation.activeBones ?? [];
  const durations = realSamples.map((s) => Number(s.durationMs) || 0).filter((v) => v > 0);
  const durationMs = round(median(durations.length ? durations : [2400]));

  const masterTrajectory = mergeTrajectories(
    realSamples.map((s) => s.trajectory),
    activeBones,
    SEQUENCE_KEYFRAMES,
  );

  const holdWindow = detectHoldWindow(masterTrajectory, activeBones);
  const syntheticCount = Math.max(0, AUGMENTED_TOTAL_TARGET - realSamples.length);
  const syntheticSamples = synthesizeObservedClones({
    realSamples,
    activeBones,
    count: syntheticCount,
    durationMs,
  });

  const sequenceProfile = buildSequenceProfile({
    ...animation,
    samples: [
      ...realSamples,
      ...syntheticSamples.slice(0, 32),
    ],
  });

  return {
    durationMs,
    masterTrajectory,
    holdWindow,
    sequenceProfile,
    realSampleCount: realSamples.length,
    syntheticSamples,
    syntheticCount: syntheticSamples.length,
    totalSampleCount: realSamples.length + syntheticSamples.length,
    fidelity: 'observed-clone',
    generatedAt: new Date().toISOString(),
  };
}

export function exportAugmentedSamplesCsv(animation, augmented) {
  const rows = [[
    'animation_id', 'animation_name', 'sample_kind', 'sample_index', 'source_sample_index',
    'duration_ms', 'sequence_step', 'sequence_t', 'active_bone', 'rx', 'ry', 'rz',
  ]];

  (animation.samples ?? []).forEach((sample) => {
    if (!sample.trajectory?.length) return;
    appendTrajectoryRows(rows, animation, 'real', sample.sampleIndex, sample.durationMs, sample.trajectory, sample.sampleIndex);
  });

  augmented.syntheticSamples.forEach((sample) => {
    appendTrajectoryRows(
      rows,
      animation,
      'synthetic',
      sample.sampleIndex,
      sample.durationMs,
      sample.trajectory,
      sample.sourceSampleIndex,
    );
  });

  return toCsv(rows);
}

function appendTrajectoryRows(rows, animation, kind, sampleIndex, durationMs, trajectory, sourceSampleIndex = '') {
  for (let step = 0; step < trajectory.length; step++) {
    const frame = trajectory[step];
    for (const alias of animation.activeBones ?? []) {
      const rot = frame.bones?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
      rows.push([
        animation.animationId,
        animation.animationName,
        kind,
        sampleIndex,
        sourceSampleIndex,
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

/**
 * Sintéticas = clones de las trayectorias REALES vistas (sin ruido inventado).
 * Rota entre muestra 1, 2 y 3 para completar hasta 600.
 */
function synthesizeObservedClones({ realSamples, activeBones, count, durationMs }) {
  const out = [];
  for (let n = 0; n < count; n++) {
    const source = realSamples[n % realSamples.length];
    const sourceTrajectory = source.trajectory ?? [];
    let trajectory = cloneTrajectory(sourceTrajectory);
    if (trajectory.length !== SEQUENCE_KEYFRAMES) {
      trajectory = resampleTrajectory(
        activeBones,
        framesFromTrajectory(trajectory, source.durationMs),
        SEQUENCE_KEYFRAMES,
      );
    }
    out.push({
      sampleIndex: (source.sampleIndex ?? 1) + 1000 + n,
      kind: 'synthetic',
      fidelity: 'observed-clone',
      sourceSampleIndex: source.sampleIndex ?? (n % realSamples.length) + 1,
      durationMs: round(Number(source.durationMs) || durationMs),
      trajectory,
      frameCount: trajectory.length,
    });
  }
  return out;
}

function framesFromTrajectory(trajectory, durationMs) {
  const duration = Math.max(1, Number(durationMs) || 2400);
  return trajectory.map((frame, idx) => ({
    t: (frame.t ?? (idx / Math.max(1, trajectory.length - 1))) * duration,
    bones: frame.bones ?? {},
  }));
}

function cloneTrajectory(trajectory) {
  return trajectory.map((frame) => ({
    t: frame.t,
    bones: Object.fromEntries(
      Object.entries(frame.bones ?? {}).map(([alias, rot]) => [
        alias,
        { rx: rot.rx, ry: rot.ry, rz: rot.rz },
      ]),
    ),
  }));
}

function mergeTrajectories(trajectories, activeBones, steps) {
  const valid = trajectories.filter((t) => t?.length);
  if (!valid.length) return [];
  const mergedFrames = [];
  for (let i = 0; i < steps; i++) {
    const t = round(i / Math.max(1, steps - 1));
    const bones = {};
    for (const alias of activeBones) {
      bones[alias] = { rx: 0, ry: 0, rz: 0 };
      for (const axis of ['rx', 'ry', 'rz']) {
        const vals = valid.map((tr) => {
          const frame = tr[Math.min(tr.length - 1, Math.round(t * (tr.length - 1)))];
          return Number(frame?.bones?.[alias]?.[axis]) || 0;
        });
        bones[alias][axis] = round(average(vals));
      }
    }
    mergedFrames.push({ t, bones });
  }
  return mergedFrames;
}

function detectHoldWindow(trajectory, activeBones) {
  if (trajectory.length < 4) {
    return { start: 0.35, end: 0.65, peakIndex: Math.floor(trajectory.length / 2) };
  }
  let peakIndex = 0;
  let peakMag = 0;
  for (let i = 0; i < trajectory.length; i++) {
    let mag = 0;
    for (const alias of activeBones) {
      const rot = trajectory[i].bones?.[alias] ?? {};
      mag += Math.abs(rot.rx) + Math.abs(rot.ry) + Math.abs(rot.rz);
    }
    if (mag > peakMag) {
      peakMag = mag;
      peakIndex = i;
    }
  }
  const start = Math.max(0, peakIndex - 2) / Math.max(1, trajectory.length - 1);
  const end = Math.min(1, (peakIndex + 2) / Math.max(1, trajectory.length - 1));
  return { start: round(start), end: round(end), peakIndex, peakMag: round(peakMag) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const text = String(cell ?? '');
    return text.includes(',') || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
}
