import { BONE_ORDER } from './boneMap.js';

/** Torso superior: cadera, torso, cabeza y brazos. Piernas opcionales. */
export const UPPER_TORSO_ALIASES = ['hip', 'chest', 'head', 'sL', 'fL', 'hL', 'sR', 'fR', 'hR'];

export const LOWER_BODY_ALIASES = ['tL', 'knL', 'ftL', 'tR', 'knR', 'ftR'];

export const MIN_ONLINE_SENSORS = 1;

export const MIN_ONLINE_UPPER_TORSO = 1;

export function isUpperTorsoAlias(alias) {
  return UPPER_TORSO_ALIASES.includes(alias);
}

export function isLowerBodyAlias(alias) {
  return LOWER_BODY_ALIASES.includes(alias);
}

export function onlineAliasSet(sensorRows = []) {
  return new Set(sensorRows.filter((row) => row.online).map((row) => row.alias));
}

export function countOnlineUpperTorso(onlineAliases) {
  const set = onlineAliases instanceof Set ? onlineAliases : new Set(onlineAliases);
  return UPPER_TORSO_ALIASES.filter((alias) => set.has(alias)).length;
}

export function missingAliases(onlineAliases, requiredAliases) {
  const set = onlineAliases instanceof Set ? onlineAliases : new Set(onlineAliases);
  return requiredAliases.filter((alias) => !set.has(alias));
}

/**
 * Modo parcial: basta con sensores del torso superior (piernas no obligatorias).
 */
export function assessPartialSensorCoverage(sensorRows = [], { requiredAliases = [] } = {}) {
  const onlineAliases = onlineAliasSet(sensorRows);
  const online = onlineAliases.size;
  const onlineUpper = countOnlineUpperTorso(onlineAliases);
  const missingLower = missingAliases(onlineAliases, LOWER_BODY_ALIASES);
  const missingRequired = requiredAliases.length
    ? missingAliases(onlineAliases, requiredAliases)
    : [];

  const issues = [];
  if (online < MIN_ONLINE_SENSORS) issues.push('Ningun sensor online');
  if (onlineUpper < MIN_ONLINE_UPPER_TORSO) issues.push('Conecta al menos un sensor del torso superior');

  return {
    ok: issues.length === 0 && missingRequired.length === 0,
    online,
    onlineUpper,
    onlineTotal: BONE_ORDER.length,
    missingRequired,
    missingLower,
    optionalLegsOffline: missingLower.length > 0,
    issues,
  };
}

export function formatOnlineLabel(online, total = BONE_ORDER.length, onlineUpper = null) {
  const upper = onlineUpper ?? online;
  if (online >= total) return `${online}/${total}`;
  if (upper > 0) return `${online}/${total} (${upper} torso sup.)`;
  return `${online}/${total}`;
}
