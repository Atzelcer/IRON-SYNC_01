import * as THREE from 'three';

const MATERIAL_NORMAL = new THREE.MeshBasicMaterial({
  color: 0x79e6ff,
  wireframe: true,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
});

const MATERIAL_HIT = new THREE.MeshBasicMaterial({
  color: 0xff5864,
  wireframe: true,
  transparent: true,
  opacity: 0.62,
  depthWrite: false,
});

const MATERIAL_WARNING = new THREE.MeshBasicMaterial({
  color: 0xffb84d,
  wireframe: true,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
});

const COLLIDER_CONFIG = {
  head: { type: 'boneCapsule', center: 'head', radius: 0.105, length: 0.24, axis: [0, 1, 0], offset: [0, 0.035, 0] },
  chest: { type: 'torsoBox', from: 'hip', to: 'chest', shoulderLeft: 'sL', shoulderRight: 'sR' },
  hip: { type: 'box', size: [0.38, 0.22, 0.18], center: 'hip', offset: [0, -0.045, 0] },

  sL: { type: 'capsule', from: 'sL', to: 'fL', radius: 0.052, shrink: 0.13 },
  fL: { type: 'capsule', from: 'fL', to: 'hL', radius: 0.044, shrink: 0.095 },
  hL: { type: 'sphere', radius: 0.062, center: 'hL', offset: [0, -0.015, 0] },
  sR: { type: 'capsule', from: 'sR', to: 'fR', radius: 0.052, shrink: 0.13 },
  fR: { type: 'capsule', from: 'fR', to: 'hR', radius: 0.044, shrink: 0.095 },
  hR: { type: 'sphere', radius: 0.062, center: 'hR', offset: [0, -0.015, 0] },

  tL: { type: 'capsule', from: 'tL', to: 'knL', radius: 0.072, shrink: 0.11 },
  knL: { type: 'capsule', from: 'knL', to: 'ftL', radius: 0.056, shrink: 0.1 },
  ftL: { type: 'box', size: [0.13, 0.08, 0.28], center: 'ftL', offset: [0, -0.035, 0.095] },
  tR: { type: 'capsule', from: 'tR', to: 'knR', radius: 0.072, shrink: 0.11 },
  knR: { type: 'capsule', from: 'knR', to: 'ftR', radius: 0.056, shrink: 0.1 },
  ftR: { type: 'box', size: [0.13, 0.08, 0.28], center: 'ftR', offset: [0, -0.035, 0.095] },
};

const FORBIDDEN_PAIRS = [
  ['hL', 'chest', 'Mano izquierda atraviesa torso', 'critical', 0.012],
  ['hR', 'chest', 'Mano derecha atraviesa torso', 'critical', 0.012],
  ['fL', 'chest', 'Antebrazo izquierdo contra torso', 'medium', 0.006],
  ['fR', 'chest', 'Antebrazo derecho contra torso', 'medium', 0.006],
  ['sL', 'chest', 'Brazo izquierdo colapsa sobre torso', 'medium', 0.0],
  ['sR', 'chest', 'Brazo derecho colapsa sobre torso', 'medium', 0.0],
  ['hL', 'hip', 'Mano izquierda invade cadera', 'high', 0.004],
  ['hR', 'hip', 'Mano derecha invade cadera', 'high', 0.004],
  ['fL', 'hip', 'Antebrazo izquierdo invade cadera', 'medium', 0.0],
  ['fR', 'hip', 'Antebrazo derecho invade cadera', 'medium', 0.0],

  ['hL', 'head', 'Mano izquierda contra cabeza', 'critical', 0.018],
  ['hR', 'head', 'Mano derecha contra cabeza', 'critical', 0.018],
  ['fL', 'head', 'Antebrazo izquierdo demasiado cerca de cabeza', 'high', 0.014],
  ['fR', 'head', 'Antebrazo derecho demasiado cerca de cabeza', 'high', 0.014],
  ['sL', 'head', 'Brazo izquierdo demasiado cerca de cabeza', 'medium', 0.012],
  ['sR', 'head', 'Brazo derecho demasiado cerca de cabeza', 'medium', 0.012],

  ['hL', 'hR', 'Manos solapadas', 'medium', 0.01],
  ['fL', 'fR', 'Antebrazos cruzados sin separacion', 'high', 0.006],
  ['sL', 'fR', 'Brazo izquierdo contra antebrazo derecho', 'medium', 0.0],
  ['sR', 'fL', 'Brazo derecho contra antebrazo izquierdo', 'medium', 0.0],

  ['tL', 'tR', 'Muslos cruzados', 'high', 0.006],
  ['knL', 'knR', 'Piernas cruzadas a nivel rodilla', 'high', 0.01],
  ['knL', 'ftR', 'Pierna izquierda invade pie derecho', 'medium', 0.0],
  ['knR', 'ftL', 'Pierna derecha invade pie izquierdo', 'medium', 0.0],
  ['ftL', 'ftR', 'Pies solapados', 'medium', 0.012],
];

export const COLLISION_SAFETY_MARGIN = 0.0508;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class CollisionSystem {
  constructor() {
    this.colliders = new Map();
    this.meshes = new Map();
    this.active = [];
    this.markerSeverity = new Map();
  }

  update(bones) {
    const aliasSeverity = new Map();
    this.markerSeverity.clear();
    this.colliders = buildColliders(bones);
    for (const [alias, collider] of this.colliders.entries()) {
      syncMesh(this.#ensureMesh(alias, COLLIDER_CONFIG[alias]), collider);
    }

    this.active = detectCollisions(this.colliders);
    for (const item of this.active) {
      upgradeSeverity(this.markerSeverity, item.a, item.severity);
      upgradeSeverity(this.markerSeverity, item.b, item.severity);
      upgradeSeverity(aliasSeverity, item.a, item.severity);
      upgradeSeverity(aliasSeverity, item.b, item.severity);
    }

    for (const [alias, mesh] of this.meshes.entries()) {
      const severity = aliasSeverity.get(alias);
      mesh.material = severity === 'critical' || severity === 'high'
        ? MATERIAL_HIT
        : severity === 'medium' || severity === 'low'
          ? MATERIAL_WARNING
          : MATERIAL_NORMAL;
    }
    return this.active;
  }

  test(bones, { margin = 0 } = {}) {
    return detectCollisions(buildColliders(bones), margin);
  }

  debugMeshes() {
    return Array.from(this.meshes.values());
  }

  sensorMarkers() {
    return Array.from(this.colliders.values()).map((collider) => ({
      alias: collider.alias,
      position: collider.center.clone(),
      severity: this.markerSeverity.get(collider.alias) ?? 'normal',
    }));
  }

  #ensureMesh(alias, config) {
    if (this.meshes.has(alias)) return this.meshes.get(alias);
    const mesh = new THREE.Mesh(createGeometry(config), MATERIAL_NORMAL);
    mesh.name = `${alias}_collider`;
    mesh.renderOrder = 20;
    this.meshes.set(alias, mesh);
    return mesh;
  }
}

function buildColliders(bones) {
  const colliders = new Map();
  for (const [alias, config] of Object.entries(COLLIDER_CONFIG)) {
    const collider = buildCollider(alias, config, bones);
    if (collider) colliders.set(alias, collider);
  }
  return colliders;
}

function detectCollisions(colliders, margin = 0) {
  const collisions = [];
  for (const [a, b, label, severity, clearance = 0] of FORBIDDEN_PAIRS) {
    const ca = colliders.get(a);
    const cb = colliders.get(b);
    if (!ca || !cb) continue;
    const penetration = colliderPenetration(ca, cb) + clearance + margin;
    if (penetration <= 0) continue;
    const resolvedSeverity = resolveSeverity(severity, penetration, ca, cb);
    collisions.push({
      a,
      b,
      label: `${label} (${(penetration * 100).toFixed(1)} cm)`,
      severity: resolvedSeverity,
      penetration,
    });
  }
  return collisions;
}

function buildCollider(alias, config, bones) {
  if (config.type === 'torsoBox') {
    return buildTorsoCollider(alias, config, bones);
  }

  if (config.type === 'capsule') {
    const fromBone = bones.get(config.from);
    const toBone = bones.get(config.to);
    if (!fromBone || !toBone) return null;
    const a = worldPosition(fromBone);
    const b = worldPosition(toBone);
    const axis = b.clone().sub(a);
    const length = axis.length();
    if (length < 0.001) return null;
    const shrink = Math.min(config.shrink ?? 0, length * 0.35);
    const direction = axis.normalize();
    const start = a.clone().addScaledVector(direction, shrink);
    const end = b.clone().addScaledVector(direction, -shrink);
    const center = start.clone().add(end).multiplyScalar(0.5);
    return {
      alias,
      type: 'capsule',
      center,
      start,
      end,
      radius: config.radius,
      length: Math.max(0.001, start.distanceTo(end)),
      boundingRadius: config.radius + start.distanceTo(end) * 0.5,
    };
  }

  const bone = bones.get(config.center);
  if (!bone) return null;
  const center = worldPosition(bone).add(localOffsetToWorld(bone, config.offset ?? [0, 0, 0]));
  if (config.type === 'boneCapsule') {
    const direction = localDirectionToWorld(bone, config.axis ?? [0, 1, 0]);
    const halfLength = Math.max(0.001, config.length * 0.5);
    const start = center.clone().addScaledVector(direction, -halfLength);
    const end = center.clone().addScaledVector(direction, halfLength);
    return {
      alias,
      type: 'capsule',
      center,
      start,
      end,
      radius: config.radius,
      length: Math.max(0.001, start.distanceTo(end)),
      boundingRadius: config.radius + halfLength,
    };
  }
  if (config.type === 'box') {
    const boundingRadius = Math.max(...config.size) * 0.5;
    return {
      alias,
      type: 'box',
      center,
      size: config.size,
      radius: boundingRadius,
      boundingRadius,
      quaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
    };
  }
  return {
    alias,
    type: 'sphere',
    center,
    radius: config.radius,
    boundingRadius: config.radius,
  };
}

function buildTorsoCollider(alias, config, bones) {
  const hip = bones.get(config.from);
  const chest = bones.get(config.to);
  const leftShoulder = bones.get(config.shoulderLeft);
  const rightShoulder = bones.get(config.shoulderRight);
  if (!hip || !chest || !leftShoulder || !rightShoulder) return null;

  const hipPos = worldPosition(hip);
  const chestPos = worldPosition(chest);
  const left = worldPosition(leftShoulder);
  const right = worldPosition(rightShoulder);

  const up = safeDirection(chestPos.clone().sub(hipPos), new THREE.Vector3(0, 1, 0));
  const side = safeDirection(right.clone().sub(left), new THREE.Vector3(1, 0, 0));
  const forward = safeDirection(new THREE.Vector3().crossVectors(side, up), new THREE.Vector3(0, 0, 1));
  const center = hipPos.clone().lerp(chestPos, 0.64).addScaledVector(forward, 0.01);
  const height = Math.max(0.24, hipPos.distanceTo(chestPos) * 0.58);
  const shoulderWidth = left.distanceTo(right);
  const size = [
    Math.max(0.26, shoulderWidth * 0.5),
    height,
    Math.max(0.1, shoulderWidth * 0.16),
  ];
  const matrix = new THREE.Matrix4().makeBasis(side, up, forward);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  const boundingRadius = Math.max(...size) * 0.5;

  return {
    alias,
    type: 'box',
    center,
    size,
    radius: boundingRadius,
    boundingRadius,
    quaternion,
  };
}

function syncMesh(mesh, collider) {
  mesh.position.copy(collider.center);
  mesh.quaternion.identity();
  if (collider.type === 'capsule') {
    mesh.scale.set(1, collider.length, 1);
    const direction = collider.end.clone().sub(collider.start).normalize();
    mesh.quaternion.copy(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction));
    return;
  }
  if (collider.quaternion) mesh.quaternion.copy(collider.quaternion);
  if (collider.size) mesh.scale.set(...collider.size);
  else mesh.scale.set(1, 1, 1);
}

function createGeometry(config) {
  if (config.type === 'box') return new THREE.BoxGeometry(1, 1, 1);
  if (config.type === 'torsoBox') return new THREE.BoxGeometry(1, 1, 1);
  if (config.type === 'boneCapsule') return new THREE.CapsuleGeometry(config.radius, 1, 8, 14);
  if (config.type === 'capsule') return new THREE.CapsuleGeometry(config.radius, 1, 8, 14);
  return new THREE.SphereGeometry(config.radius, 20, 14);
}

function colliderPenetration(a, b) {
  if (a.type === 'box' && b.type === 'capsule') {
    return boxCapsulePenetration(a, b);
  }
  if (b.type === 'box' && a.type === 'capsule') {
    return boxCapsulePenetration(b, a);
  }
  if (a.type === 'box' && b.type === 'box') {
    return boxBoxPenetration(a, b);
  }
  if (a.type === 'box') {
    return boxPointPenetration(a, b.center, b.boundingRadius);
  }
  if (b.type === 'box') {
    return boxPointPenetration(b, a.center, a.boundingRadius);
  }
  if (a.type === 'capsule' && b.type === 'capsule') {
    const distance = segmentSegmentDistance(a.start, a.end, b.start, b.end);
    return a.radius + b.radius - distance;
  }
  if (a.type === 'capsule') {
    return capsulePointPenetration(a, b.center, b.boundingRadius);
  }
  if (b.type === 'capsule') {
    return capsulePointPenetration(b, a.center, a.boundingRadius);
  }
  return a.boundingRadius + b.boundingRadius - a.center.distanceTo(b.center);
}

function boxCapsulePenetration(box, capsule) {
  const samples = [
    capsule.start,
    capsule.start.clone().lerp(capsule.end, 0.25),
    capsule.start.clone().lerp(capsule.end, 0.5),
    capsule.start.clone().lerp(capsule.end, 0.75),
    capsule.end,
  ];
  return Math.max(...samples.map((point) => boxPointPenetration(box, point, capsule.radius)));
}

function boxBoxPenetration(a, b) {
  const aSamples = boxSamplePoints(a);
  const bSamples = boxSamplePoints(b);
  const aRadius = Math.min(...a.size) * 0.18;
  const bRadius = Math.min(...b.size) * 0.18;
  return Math.max(
    ...aSamples.map((point) => boxPointPenetration(b, point, aRadius)),
    ...bSamples.map((point) => boxPointPenetration(a, point, bRadius)),
  );
}

function boxPointPenetration(box, point, radius) {
  const local = point.clone().sub(box.center);
  local.applyQuaternion(box.quaternion.clone().invert());
  const half = new THREE.Vector3(box.size[0] * 0.5, box.size[1] * 0.5, box.size[2] * 0.5);
  const outside = new THREE.Vector3(
    Math.max(Math.abs(local.x) - half.x, 0),
    Math.max(Math.abs(local.y) - half.y, 0),
    Math.max(Math.abs(local.z) - half.z, 0),
  );
  const outsideDistance = outside.length();
  if (outsideDistance > 0) return radius - outsideDistance;

  const faceClearance = Math.min(
    half.x - Math.abs(local.x),
    half.y - Math.abs(local.y),
    half.z - Math.abs(local.z),
  );
  return radius + faceClearance;
}

function boxSamplePoints(box) {
  const half = new THREE.Vector3(box.size[0] * 0.5, box.size[1] * 0.5, box.size[2] * 0.5);
  const points = [new THREE.Vector3(0, 0, 0)];
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) points.push(new THREE.Vector3(x, y, z));
    }
  }
  return points.map((point) => point.applyQuaternion(box.quaternion).add(box.center));
}

function resolveSeverity(baseSeverity, penetration, a, b) {
  const reference = Math.min(a.boundingRadius, b.boundingRadius);
  const ratio = penetration / Math.max(0.001, reference);
  if (baseSeverity === 'critical' && ratio >= 0.12) return 'critical';
  if (ratio >= 0.5 || baseSeverity === 'high') return 'high';
  if (ratio >= 0.16 || baseSeverity === 'medium') return 'medium';
  return 'low';
}

function upgradeSeverity(map, alias, severity) {
  const rank = { normal: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const current = map.get(alias) ?? 'normal';
  if (rank[severity] > rank[current]) map.set(alias, severity);
}

function capsulePointPenetration(capsule, point, radius) {
  const nearest = closestPointOnSegment(point, capsule.start, capsule.end);
  return capsule.radius + radius - nearest.distanceTo(point);
}

function segmentSegmentDistance(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;

  if (a <= 1e-6 && e <= 1e-6) return p1.distanceTo(p2);
  if (a <= 1e-6) {
    t = clamp01(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-6) {
      s = clamp01(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      if (denom !== 0) s = clamp01((b * f - c * e) / denom);
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

function closestPointOnSegment(point, a, b) {
  const ab = b.clone().sub(a);
  const t = clamp01(point.clone().sub(a).dot(ab) / Math.max(1e-6, ab.dot(ab)));
  return a.clone().addScaledVector(ab, t);
}

function localOffsetToWorld(bone, offset) {
  _v1.set(offset[0], offset[1], offset[2]);
  bone.getWorldQuaternion(_q);
  return _v1.applyQuaternion(_q);
}

function localDirectionToWorld(bone, axis) {
  const direction = new THREE.Vector3(axis[0], axis[1], axis[2]);
  if (direction.lengthSq() < 1e-6) direction.set(0, 1, 0);
  bone.getWorldQuaternion(_q);
  return direction.normalize().applyQuaternion(_q).normalize();
}

function worldPosition(object) {
  object.getWorldPosition(_v2);
  return _v2.clone();
}

function safeDirection(vector, fallback) {
  return vector.lengthSq() > 1e-6 ? vector.normalize() : fallback.clone();
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
