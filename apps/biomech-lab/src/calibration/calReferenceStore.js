export const CAL_REFERENCE_SCHEMA = 'ironsync.cal-reference.v1';
const STORAGE_KEY = 'ironsync.cal-reference.golden';

export function parseCalReferenceLines(lines) {
  const rows = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = String(raw ?? '').trim();
    if (line === 'CAL_REFERENCE_BEGIN') {
      inBlock = true;
      continue;
    }
    if (line === 'CAL_REFERENCE_END') {
      inBlock = false;
      continue;
    }
    if (!inBlock && !line.startsWith('CAL_REFERENCE_SENSOR,')) continue;
    if (!line.startsWith('CAL_REFERENCE_SENSOR,')) continue;
    const parsed = parseCalReferenceSensorLine(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

export function parseCalReferenceSensorLine(line) {
  const prefix = 'CAL_REFERENCE_SENSOR,';
  if (!line.startsWith(prefix)) return null;
  const payload = line.slice(prefix.length);
  const comma = payload.indexOf(',');
  if (comma < 1) return null;
  const key = payload.slice(0, comma).trim();
  const rest = payload.slice(comma + 1);
  const layout = readToken(rest, 'layout=');
  return {
    key,
    layout: layout || 'Z_UP',
    zeroPitch: Number(readToken(rest, 'zeroPitch=')) || 0,
    zeroRoll: Number(readToken(rest, 'zeroRoll=')) || 0,
    zeroYawRate: Number(readToken(rest, 'zeroYawRate=')) || 0,
    gyroOff: readGyroTriplet(rest),
  };
}

export function buildLoadCalReferenceCommand(sensor) {
  const g = sensor.gyroOff ?? { x: 0, y: 0, z: 0 };
  return [
    'LOAD_CAL_REFERENCE_SENSOR',
    sensor.key,
    `layout=${sensor.layout}`,
    `zeroPitch=${sensor.zeroPitch.toFixed(3)}`,
    `zeroRoll=${sensor.zeroRoll.toFixed(3)}`,
    `zeroYawRate=${sensor.zeroYawRate.toFixed(3)}`,
    `gyroOff=(${g.x.toFixed(3)}/${g.y.toFixed(3)}/${g.z.toFixed(3)})`,
  ].join(',');
}

export class CalReferenceStore {
  constructor() {
    this.golden = null;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.schema !== CAL_REFERENCE_SCHEMA) return null;
      this.golden = {
        ...parsed,
        sensors: (parsed.sensors ?? []).map((s) => ({
          ...s,
          loadLine: normalizeLoadLine(s),
        })),
      };
      return this.golden;
    } catch {
      return null;
    }
  }

  saveFromLines(lines, meta = {}) {
    const sensors = parseCalReferenceLines(lines);
    if (!sensors.length) return null;
    this.golden = {
      schema: CAL_REFERENCE_SCHEMA,
      id: `calref_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      sensorCount: sensors.length,
      sensors,
      lines: lines.filter((l) => String(l).trim()),
      meta,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.golden));
    return this.golden;
  }

  importGolden(payload) {
    if (!payload?.sensors?.length) return false;
    this.golden = {
      schema: CAL_REFERENCE_SCHEMA,
      ...payload,
      sensors: payload.sensors.map((s) => ({
        ...s,
        loadLine: normalizeLoadLine(s),
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.golden));
    return true;
  }

  getGolden() {
    return this.golden;
  }

  hasGolden() {
    return Boolean(this.golden?.sensors?.length);
  }

  clear() {
    this.golden = null;
    localStorage.removeItem(STORAGE_KEY);
  }
}

function normalizeLoadLine(sensor) {
  const line = String(sensor?.loadLine ?? '').trim();
  if (line.startsWith('LOAD_CAL_REFERENCE_SENSOR,')) return line;
  return buildLoadCalReferenceCommand(sensor);
}

function readToken(payload, key) {
  const pos = payload.indexOf(key);
  if (pos < 0) return '';
  const start = pos + key.length;
  const end = payload.indexOf(',', start);
  return (end >= 0 ? payload.slice(start, end) : payload.slice(start)).trim();
}

function readGyroTriplet(payload) {
  const pos = payload.indexOf('gyroOff=(');
  if (pos < 0) return { x: 0, y: 0, z: 0 };
  const inner = payload.slice(pos + 9);
  const end = inner.indexOf(')');
  if (end < 0) return { x: 0, y: 0, z: 0 };
  const parts = inner.slice(0, end).split('/');
  return {
    x: Number(parts[0]) || 0,
    y: Number(parts[1]) || 0,
    z: Number(parts[2]) || 0,
  };
}
