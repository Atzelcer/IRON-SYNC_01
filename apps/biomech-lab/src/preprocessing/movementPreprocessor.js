import { BONE_LABELS } from '../core/boneMap.js';
import {
  SequenceMovementRecognizer,
  buildSequenceProfile,
  resampleTrajectory,
} from './sequenceMovementRecognizer.js';
import { MultiMovementRecognizer, RUNTIME_MATCH_THRESHOLD } from './multiMovementRecognizer.js';
import { computeMotionPeak, enrichProfileSequence } from './sequenceTemporalTracker.js';
import { buildCollectionHeatmap } from './collectionHeatmapRanker.js';

const AXES = ['rx', 'ry', 'rz'];

export class MovementPreprocessor {
  constructor({ multi = true } = {}) {
    this.useMulti = multi;
    this.recognizer = multi ? new MultiMovementRecognizer() : new SequenceMovementRecognizer();
    this.reset();
  }

  reset() {
    this.loaded = false;
    this.active = false;
    this.threshold = RUNTIME_MATCH_THRESHOLD;
    this.minPeak = 8;
    this.holdMs = 500;
    this.holdStillDeg = 2;
    this.baseReturnDeg = 5;
    this.profiles = [];
    this.fileName = '';
    this.collectionStamp = '';
    this.movementFolders = [];
    this.lastMatch = null;
    this.lastMatches = [];
    if (this.recognizer) {
      this.recognizer.loadProfiles([]);
      this.recognizer.resetSession();
    }
  }

  loadCsv(text, fileName = 'dataset.csv') {
    const rows = parseCsv(text);
    const legacy = buildLegacyProfiles(rows);
    this.profiles = legacy.map((p) => legacyProfileToSequence(p)).filter(Boolean);
    this.fileName = fileName;
    this.loaded = this.profiles.length > 0;
    this.#syncRecognizer();
    return this.summary();
  }

  loadDatasetJson(payload, fileName = 'dataset.json') {
    const animations = Array.isArray(payload?.animations) ? payload.animations : [];
    this.profiles = animations
      .map((a) => enrichProfileSequence(buildSequenceProfile(a)))
      .filter(Boolean);
    this.fileName = fileName;
    this.loaded = this.profiles.length > 0;
    this.#syncRecognizer();
    return this.summary();
  }

  loadCollection(payload, label = 'coleccion') {
    const animations = (Array.isArray(payload?.animations) ? payload.animations : [])
      .filter((a) => a?.approved !== false && (a?.masterTrajectory?.length || a?.samples?.length));
    this.profiles = animations
      .map((a) => enrichProfileSequence(buildSequenceProfile(a)))
      .filter(Boolean);
    this.fileName = label;
    this.collectionStamp = payload?.stamp ?? '';
    this.movementFolders = Array.isArray(payload?.movements) ? payload.movements : [];
    this.loaded = this.profiles.length > 0;
    this.#syncRecognizer();
    return this.summary();
  }

  setConfig({ threshold, minPeak, holdMs, holdStillDeg, baseReturnDeg } = {}) {
    if (Number.isFinite(Number(threshold))) this.threshold = clamp(Number(threshold), 50, 99.9);
    if (Number.isFinite(Number(minPeak))) this.minPeak = clamp(Number(minPeak), 0, 60);
    if (Number.isFinite(Number(holdMs))) this.holdMs = clamp(Number(holdMs), 150, 5000);
    if (Number.isFinite(Number(holdStillDeg))) this.holdStillDeg = clamp(Number(holdStillDeg), 0.5, 15);
    if (Number.isFinite(Number(baseReturnDeg))) this.baseReturnDeg = clamp(Number(baseReturnDeg), 2, 20);
    this.#syncRecognizer();
  }

  start() {
    if (!this.loaded) return false;
    this.active = true;
    this.recognizer.resetSession();
    return true;
  }

  stop() {
    this.active = false;
    this.lastMatch = null;
    this.lastMatches = [];
    this.recognizer.resetSession();
  }

  recognize(pose, now = performance.now()) {
    if (!this.active || !this.loaded || !pose) return null;
    const raw = this.recognizer.recognize(pose, now);
    const match = Array.isArray(raw) ? (raw[0] ?? null) : raw;
    if (match) {
      this.lastMatch = match;
      this.lastMatches = Array.isArray(raw) ? raw : [match];
      return match;
    }
    this.lastMatch = null;
    this.lastMatches = [];
    return null;
  }

  recognizeAll(pose, now = performance.now()) {
    if (!this.loaded || !pose) return [];
    if (!this.active) {
      const allBones = this.profiles.flatMap((p) => p.activeBones ?? []);
      this.recognizer.lastCollectionHeatmap = buildCollectionHeatmap(this.profiles, pose, {
        minPeak: this.minPeak,
        threshold: this.threshold,
        baseReturnDeg: this.baseReturnDeg,
        motionPeak: computeMotionPeak(pose, allBones),
      });
      return [];
    }
    const raw = this.recognizer.recognize(pose, now);
    const matches = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    this.lastMatches = matches;
    this.lastMatch = matches[0] ?? null;
    return matches;
  }

  summary() {
    return {
      loaded: this.loaded,
      active: this.active,
      fileName: this.fileName,
      collectionStamp: this.collectionStamp,
      movementFolders: this.movementFolders,
      threshold: this.threshold,
      minPeak: this.minPeak,
      holdMs: this.holdMs,
      holdStillDeg: this.holdStillDeg,
      baseReturnDeg: this.baseReturnDeg,
      profileCount: this.profiles.length,
      animations: this.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        activeBones: profile.activeBones,
        sequenceLength: profile.sequenceLength,
      })),
      lastMatch: this.lastMatch,
      lastMatches: this.lastMatches,
      collectionHeatmap: this.recognizer.lastCollectionHeatmap ?? [],
      executionSlots: this.recognizer.lastExecutionSlots ?? [],
      motionPeak: this.recognizer.lastMotionPeak ?? 0,
    };
  }

  #syncRecognizer() {
    this.recognizer.loadProfiles(this.profiles);
    this.recognizer.setConfig({
      threshold: this.threshold,
      minPeak: this.minPeak,
      holdStillDeg: this.holdStillDeg,
      baseReturnDeg: this.baseReturnDeg,
    });
  }
}

export { resampleTrajectory };

function legacyProfileToSequence(profile) {
  const sample = {
    bones: Object.fromEntries(profile.bones.map((bone) => [
      bone.alias,
      Object.fromEntries(AXES.map((axis) => [axis, { peak: bone.axes[axis] ?? 0, min: 0, max: bone.axes[axis] ?? 0 }])),
    ])),
  };
  return buildSequenceProfile({
    animationId: profile.id,
    animationName: profile.name,
    activeBones: profile.activeBones,
    samples: [sample],
  });
}

function buildLegacyProfiles(rows) {
  const usable = rows.filter((row) => row.animation_id && row.active_bone);
  const grouped = new Map();
  for (const row of usable) {
    const key = row.animation_id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: row.animation_id,
        name: row.animation_name || row.animation_id,
        bones: new Map(),
      });
    }
    const profile = grouped.get(key);
    const alias = row.active_bone;
    if (!profile.bones.has(alias)) {
      profile.bones.set(alias, {
        alias,
        label: row.bone_label || BONE_LABELS[alias] || alias,
        samples: [],
      });
    }
    profile.bones.get(alias).samples.push(row);
  }

  return [...grouped.values()].map((group) => {
    const bones = [...group.bones.values()].map((bone) => {
      const axes = Object.fromEntries(AXES.map((axis) => {
        const values = bone.samples.map((sample) => Number(sample[`${axis}_peak`])).filter(Number.isFinite);
        return [axis, round(average(values))];
      }));
      return { alias: bone.alias, label: bone.label, axes };
    });
    return {
      id: group.id,
      name: group.name,
      activeBones: bones.map((bone) => bone.alias),
      bones,
    };
  });
}

function parseCsv(text) {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell).trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
