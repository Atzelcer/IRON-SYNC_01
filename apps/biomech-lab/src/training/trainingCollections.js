import { APPLIED_MOVEMENTS } from '../drl/appliedMovements.js';

/** Movimientos numerados para el selector de entrenamiento: usa Movimientos - Aplicados. */
export const TRAINING_MOVEMENT_OPTIONS = APPLIED_MOVEMENTS
  .map((item, index) => ({
    index: index + 1,
    id: item.id,
    name: item.name,
    activeBones: item.activeBones,
    durationMs: item.durationMs,
    targetPose: item.targetPose,
    source: 'applied_movements',
    instruction: `Reproduce una sola vez: ${item.name}`,
  }));

export function trainingMovementBySelectorValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const byId = TRAINING_MOVEMENT_OPTIONS.find((item) => item.id === raw);
  if (byId) return byId;
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 1 && num <= TRAINING_MOVEMENT_OPTIONS.length) {
    return TRAINING_MOVEMENT_OPTIONS[num - 1];
  }
  return null;
}

export function formatCollectionLabel(stamp, movementCount = 0) {
  if (!stamp) return '— sin colección —';
  const suffix = movementCount > 0 ? ` (${movementCount} mov.)` : '';
  return `${stamp}${suffix}`;
}
