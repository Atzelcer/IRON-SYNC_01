export const BONE_LIMITS = {
  hip: { rx: [-25, 25], ry: [-35, 35], rz: [-20, 20], maxVelocity: 140, parent: null },
  chest: { rx: [-35, 35], ry: [-45, 45], rz: [-30, 30], maxVelocity: 150, parent: 'hip' },
  head: { rx: [-40, 40], ry: [-70, 70], rz: [-35, 35], maxVelocity: 180, parent: 'chest' },
  sL: { rx: [-105, 120], ry: [-95, 95], rz: [-75, 75], maxVelocity: 220, parent: 'chest' },
  fL: { rx: [0, 145], ry: [-35, 35], rz: [-75, 75], maxVelocity: 260, parent: 'sL' },
  hL: { rx: [-70, 80], ry: [-45, 45], rz: [-45, 45], maxVelocity: 300, parent: 'fL' },
  sR: { rx: [-105, 120], ry: [-95, 95], rz: [-75, 75], maxVelocity: 220, parent: 'chest' },
  fR: { rx: [0, 145], ry: [-35, 35], rz: [-75, 75], maxVelocity: 260, parent: 'sR' },
  hR: { rx: [-70, 80], ry: [-45, 45], rz: [-45, 45], maxVelocity: 300, parent: 'fR' },
  tL: { rx: [-45, 95], ry: [-35, 45], rz: [-35, 35], maxVelocity: 180, parent: 'hip' },
  knL: { rx: [0, 135], ry: [-12, 12], rz: [-12, 12], maxVelocity: 220, parent: 'tL' },
  ftL: { rx: [-45, 45], ry: [-25, 25], rz: [-25, 25], maxVelocity: 260, parent: 'knL' },
  tR: { rx: [-45, 95], ry: [-35, 45], rz: [-35, 35], maxVelocity: 180, parent: 'hip' },
  knR: { rx: [0, 135], ry: [-12, 12], rz: [-12, 12], maxVelocity: 220, parent: 'tR' },
  ftR: { rx: [-45, 45], ry: [-25, 25], rz: [-25, 25], maxVelocity: 260, parent: 'knR' },
};

export function clampAxis(value, [min, max]) {
  return Math.min(max, Math.max(min, value));
}

export function clampRotation(alias, rotation) {
  const limits = BONE_LIMITS[alias];
  if (!limits) return { ...rotation };
  return {
    rx: clampAxis(rotation.rx, limits.rx),
    ry: clampAxis(rotation.ry, limits.ry),
    rz: clampAxis(rotation.rz, limits.rz),
  };
}

export function axisLimit(alias, axis) {
  return BONE_LIMITS[alias]?.[axis] ?? [-120, 120];
}

export function isOutOfLimit(alias, axis, value) {
  const [min, max] = axisLimit(alias, axis);
  return value < min || value > max;
}
