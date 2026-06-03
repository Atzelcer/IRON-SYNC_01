/**
 * Alias lógico ↔ nombre hueso Mixamo/FBX del skeletal mesh.
 * Enrutado IMU → alias: ver sensorRegistry.js (única fuente).
 */
export const BONE_ALIASES = {
  hip: 'Hips',
  chest: 'Spine2',
  head: 'Head',

  sL: 'LeftArm',
  fL: 'LeftForeArm',
  hL: 'LeftHand',

  sR: 'RightArm',
  fR: 'RightForeArm',
  hR: 'RightHand',

  tL: 'LeftUpLeg',
  knL: 'LeftLeg',
  ftL: 'LeftFoot',

  tR: 'RightUpLeg',
  knR: 'RightLeg',
  ftR: 'RightFoot',
};

export const BONE_LABELS = {
  hip: 'Cadera',
  chest: 'Torso',
  head: 'Cabeza',
  sL: 'Brazo izq.',
  fL: 'Antebrazo izq.',
  hL: 'Mano izq.',
  sR: 'Brazo der.',
  fR: 'Antebrazo der.',
  hR: 'Mano der.',
  tL: 'Muslo izq.',
  knL: 'Pierna izq.',
  ftL: 'Pie izq.',
  tR: 'Muslo der.',
  knR: 'Pierna der.',
  ftR: 'Pie der.',
};

export const BONE_ORDER = Object.keys(BONE_ALIASES);

export {
  MEGA_SENSOR_MAP_VERSION,
  MEGA_SENSOR_INDEX_ORDER,
  MEGA_SENSOR_REGISTRY,
  MEGA_WIRE_SENSOR_BLOCKS,
  buildPoseFromRotations,
  normalizeFirmwareKey,
  physicalChannelKey,
  registryEntryForKey,
  registryEntryForPhysical,
  routeSensorBlock,
} from './sensorRegistry.js';

export function normalizeBoneName(name) {
  return String(name || '')
    .replace(/^mixamorig[:_]*/i, '')
    .replace(/^Armature[.:_]*/i, '')
    .trim();
}

export function findAliasByBoneName(name) {
  const normalized = normalizeBoneName(name);
  return Object.entries(BONE_ALIASES).find(([, target]) => target === normalized)?.[0] ?? null;
}
