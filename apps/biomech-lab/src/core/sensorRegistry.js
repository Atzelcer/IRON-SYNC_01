/**
 * Registro único Mega ↔ lab (SensorMap.ino).
 * Enrutado: mux:canal autoritativo; key debe coincidir o el bloque se descarta.
 */

export const MEGA_SENSOR_MAP_VERSION = '2026-06-01-registry-v4';

const VALID_KEYS = [
  'chest', 'fL', 'sL', 'hL', 'sR', 'fR', 'hR', 'head',
  'hip', 'tR', 'knR', 'ftR', 'tL', 'knL', 'ftL',
];

/** Orden = índice máscara IS / sensorMap[] en el Mega. */
export const MEGA_SENSOR_REGISTRY = [
  { index: 0, key: 'chest', tca: '70', channel: 0, bone: 'Spine2' },
  { index: 1, key: 'fL', tca: '70', channel: 1, bone: 'LeftForeArm' },
  { index: 2, key: 'sL', tca: '70', channel: 2, bone: 'LeftArm' },
  { index: 3, key: 'hL', tca: '70', channel: 3, bone: 'LeftHand' },
  { index: 4, key: 'sR', tca: '70', channel: 4, bone: 'RightArm' },
  { index: 5, key: 'fR', tca: '70', channel: 5, bone: 'RightForeArm' },
  { index: 6, key: 'hR', tca: '70', channel: 6, bone: 'RightHand' },
  { index: 7, key: 'head', tca: '70', channel: 7, bone: 'Head' },
  { index: 8, key: 'hip', tca: '72', channel: 0, bone: 'Hips' },
  { index: 9, key: 'tR', tca: '72', channel: 2, bone: 'RightUpLeg' },
  { index: 10, key: 'knR', tca: '72', channel: 3, bone: 'RightLeg' },
  { index: 11, key: 'ftR', tca: '72', channel: 4, bone: 'RightFoot' },
  { index: 12, key: 'tL', tca: '72', channel: 5, bone: 'LeftUpLeg' },
  { index: 13, key: 'knL', tca: '72', channel: 6, bone: 'LeftLeg' },
  { index: 14, key: 'ftL', tca: '72', channel: 7, bone: 'LeftFoot' },
];

export const MEGA_SENSOR_INDEX_ORDER = MEGA_SENSOR_REGISTRY.map((e) => e.key);

const BY_PHYSICAL = new Map(
  MEGA_SENSOR_REGISTRY.map((e) => [`${e.tca}:${e.channel}`, e]),
);

const BY_KEY = new Map(
  MEGA_SENSOR_REGISTRY.map((e) => [e.key, e]),
);

export function physicalChannelKey(tca, channel) {
  const ch = Number(channel);
  if (!Number.isFinite(ch)) return '';

  if (typeof tca === 'string') {
    const token = String(tca).trim().toLowerCase().replace(/^0x/, '');
    if (!token) return '';
    return `${token}:${ch}`;
  }

  const bus = Number(tca);
  if (!Number.isFinite(bus)) return '';
  if (bus === 0x70 || bus === 112) return `70:${ch}`;
  if (bus === 0x72 || bus === 114) return `72:${ch}`;
  return `${bus.toString(16)}:${ch}`;
}

export function normalizeFirmwareKey(raw) {
  const key = String(raw ?? '').trim();
  return VALID_KEYS.includes(key) ? key : null;
}

export function registryEntryForPhysical(tca, channel) {
  const pkey = physicalChannelKey(tca, channel);
  return pkey ? BY_PHYSICAL.get(pkey) ?? null : null;
}

export function registryEntryForKey(key) {
  return BY_KEY.get(normalizeFirmwareKey(key) ?? '') ?? null;
}

/**
 * Enruta bloque IS → alias. mux:canal manda; key incoherente → rechazado.
 */
export function routeSensorBlock({ tca = null, channel = null, firmwareKey = '' } = {}) {
  const wireKey = String(firmwareKey ?? '').trim();
  const normalizedKey = normalizeFirmwareKey(wireKey);
  const physical = registryEntryForPhysical(tca, channel);
  const byKey = normalizedKey ? registryEntryForKey(normalizedKey) : null;

  if (physical) {
    if (normalizedKey && normalizedKey !== physical.key) {
      return {
        alias: null,
        valid: false,
        rejected: true,
        reason: 'key_mux_mismatch',
        expectedKey: physical.key,
        wireKey,
        physicalKey: `${physical.tca}:${physical.channel}`,
        registryIndex: physical.index,
      };
    }
    return {
      alias: physical.key,
      valid: true,
      rejected: false,
      routeBy: normalizedKey ? 'physical+key' : 'physical',
      expectedKey: physical.key,
      wireKey: wireKey || physical.key,
      physicalKey: `${physical.tca}:${physical.channel}`,
      registryIndex: physical.index,
      meshBone: physical.bone,
    };
  }

  if (byKey) {
    return {
      alias: byKey.key,
      valid: true,
      rejected: false,
      routeBy: 'legacyKey',
      expectedKey: byKey.key,
      wireKey: byKey.key,
      physicalKey: `${byKey.tca}:${byKey.channel}`,
      registryIndex: byKey.index,
      meshBone: byKey.bone,
    };
  }

  return {
    alias: null,
    valid: false,
    rejected: true,
    reason: 'unknown_sensor',
    wireKey,
    physicalKey: physicalChannelKey(tca, channel) || null,
  };
}

/** Pose por alias — un bloque por hueso, sin mezclar. */
export function buildPoseFromRotations(rotations = [], { meshOnly = false, mappedAliases = null } = {}) {
  const pose = {};
  const seen = new Set();

  for (const item of rotations ?? []) {
    const routing = item.routing ?? routeSensorBlock({
      tca: item.tca,
      channel: item.channel,
      firmwareKey: item.firmwareKey ?? item.alias,
    });
    if (routing.rejected || !routing.alias) continue;
    const alias = routing.alias;
    if (!VALID_KEYS.includes(alias) || seen.has(alias)) continue;
    if (meshOnly && mappedAliases && !mappedAliases.has(alias)) continue;

    seen.add(alias);
    pose[alias] = {
      rx: finiteRotation(item.rx),
      ry: finiteRotation(item.ry),
      rz: finiteRotation(item.rz),
    };
  }

  return pose;
}

export const MEGA_WIRE_SENSOR_BLOCKS = MEGA_SENSOR_REGISTRY.map((e) => [e.tca, e.channel, e.key]);

function finiteRotation(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
