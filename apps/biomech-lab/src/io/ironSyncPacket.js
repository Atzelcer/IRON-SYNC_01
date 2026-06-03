/**
 * Parser IS: Mega (Serial1) → ESP32 (UDP) → relay → lab.
 * Enrutado: sensorRegistry.routeSensorBlock (mux + key coherentes con SensorMap.ino).
 */
import {
  MEGA_SENSOR_INDEX_ORDER,
  MEGA_WIRE_SENSOR_BLOCKS,
  routeSensorBlock,
} from '../core/sensorRegistry.js';
import { BONE_ORDER } from '../core/boneMap.js';

/**
 * @param {string} line Línea IS completa (una línea UDP).
 * @returns {object|null}
 */
export function parseIronSyncPacket(line) {
  const raw = String(line ?? '').trim();
  if (!raw.startsWith('IS,')) return null;

  const parts = raw.split(';');
  const header = parts[0].split(',');
  if (header.length < 10) return null;

  const mask = Number(header[3]) || 0;
  const blocks = parts.slice(1).map((block) => block.trim()).filter(Boolean);

  let rotations = blocks.map((block) => parseIsBlock(block)).filter(Boolean);

  if (rotations.length === 0 && mask > 0) {
    rotations = rotationsFromMask(mask);
  }

  if (rotations.length === 0) return null;

  const rawLine = raw.length > 320 ? `${raw.slice(0, 320)}...` : raw;

  return {
    type: 'frame',
    source: 'arduino-mega',
    frame: Number(header[1]) || 0,
    timestampMs: Number(header[2]) || 0,
    mask,
    activeSensors: Number(header[4]) || rotations.length,
    emg: { raw: Number(header[6]) || 0, intensity: Number(header[7]) || 0 },
    ecg: { raw: Number(header[5]) || 0, loPlus: Number(header[8]) || 0, loMinus: Number(header[9]) || 0 },
    rotations,
    routing: summarizeRouting(rotations),
    rawLine,
  };
}

function parseIsBlock(block) {
  const values = block.split(',');
  if (values.length < 4) return null;

  let tca = null;
  let channel = null;
  let firmwareKey = '';
  let rx = 0;
  let ry = 0;
  let rz = 0;

  let tcaToken = '';
  if (values.length >= 6) {
    tcaToken = String(values[0] ?? '').trim();
    tca = tcaToken ? parseInt(tcaToken, 16) : null;
    channel = Number(values[1]);
    firmwareKey = values[2];
    rx = finiteNum(values[3]);
    ry = finiteNum(values[4]);
    rz = finiteNum(values[5]);
  } else {
    firmwareKey = values[0];
    rx = finiteNum(values[1]);
    ry = finiteNum(values[2]);
    rz = finiteNum(values[3]);
  }

  const routing = routeSensorBlock({
    tca: tcaToken || tca,
    channel,
    firmwareKey: String(firmwareKey ?? '').trim(),
  });

  if (!routing.valid || !routing.alias) return null;

  return {
    alias: routing.alias,
    firmwareKey: routing.wireKey,
    tca,
    channel,
    rx,
    ry,
    rz,
    raw: parseRawOrientationExtras(values),
    routing,
    routeBy: routing.routeBy,
    meshBone: routing.meshBone,
    keyMismatch: routing.reason === 'key_mux_mismatch',
    expectedKey: routing.expectedKey,
    physicalKey: routing.physicalKey,
  };
}

function parseRawOrientationExtras(values) {
  if (values.length < 15) return null;
  return {
    pitch: finiteNum(values[6]),
    roll: finiteNum(values[7]),
    yawRate: finiteNum(values[8]),
    ax: finiteNum(values[9]),
    ay: finiteNum(values[10]),
    az: finiteNum(values[11]),
    gx: finiteNum(values[12]),
    gy: finiteNum(values[13]),
    gz: finiteNum(values[14]),
  };
}

function finiteNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function summarizeRouting(rotations) {
  const rejected = rotations.filter((r) => r.routing?.rejected).length;
  const keyMismatch = rotations.filter((r) => r.keyMismatch).length;
  const aliases = new Set(rotations.map((r) => r.alias));
  return {
    total: rotations.length,
    rejected,
    keyMismatch,
    missingAliases: BONE_ORDER.filter((alias) => !aliases.has(alias)),
    ok: rejected === 0 && keyMismatch === 0 && rotations.length >= 1,
  };
}

function rotationsFromMask(mask) {
  const out = [];
  for (let i = 0; i < MEGA_SENSOR_INDEX_ORDER.length; i++) {
    if ((mask & (1 << i)) === 0) continue;
    const alias = MEGA_SENSOR_INDEX_ORDER[i];
    out.push({
      alias,
      firmwareKey: alias,
      tca: null,
      channel: null,
      rx: 0,
      ry: 0,
      rz: 0,
      routeBy: 'maskFallback',
      routing: { valid: true, routeBy: 'maskFallback', alias },
    });
  }
  return out;
}

export function buildSampleIsPacket({ frame = 1, mask = 0x7fff } = {}) {
  let line = `IS,${frame},${Date.now()},${mask},15,0,0,0,0,0`;
  for (const [tca, ch, key] of MEGA_WIRE_SENSOR_BLOCKS) {
    line += `;${tca},${ch},${key},1.5,-2.0,0.5`;
  }
  return line;
}
