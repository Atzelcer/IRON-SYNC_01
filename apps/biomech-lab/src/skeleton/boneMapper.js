import { BONE_ALIASES, BONE_ORDER, normalizeBoneName } from '../core/boneMap.js';

function normalizeToken(name) {
  return normalizeBoneName(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export class BoneMapper {
  constructor() {
    this.availableBones = [];
    this.mapped = new Map();
  }

  scan(root) {
    this.availableBones = [];
    root.traverse((node) => {
      if (node.isBone) this.availableBones.push(node);
    });
    this.autoMap();
    return this.summary();
  }

  useProcedural(bones) {
    this.availableBones = Array.from(bones.values());
    this.mapped.clear();
    for (const alias of BONE_ORDER) {
      const bone = bones.get(alias);
      if (bone) this.mapped.set(alias, bone);
    }
    return this.summary();
  }

  /** Coincidencia exacta con BONE_ALIASES (evita sR→RightForeArm). */
  autoMap() {
    this.mapped.clear();
    const normalized = this.availableBones.map((bone) => ({
      bone,
      token: normalizeToken(bone.name),
    }));

    const used = new Set();

    for (const alias of BONE_ORDER) {
      const target = normalizeToken(BONE_ALIASES[alias]);
      const match = normalized.find(({ token, bone }) => token === target && !used.has(bone.uuid));
      if (match) {
        this.mapped.set(alias, match.bone);
        used.add(match.bone.uuid);
      }
    }

    return this.summary();
  }

  assign(alias, boneName) {
    const bone = this.availableBones.find((item) => item.name === boneName);
    if (bone) this.mapped.set(alias, bone);
    return this.summary();
  }

  getBones() {
    return this.mapped;
  }

  summary() {
    return BONE_ORDER.map((alias) => ({
      alias,
      expected: BONE_ALIASES[alias],
      found: this.mapped.get(alias)?.name ?? '',
      ok: this.mapped.has(alias),
    }));
  }
}
