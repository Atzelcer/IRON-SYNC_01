import * as THREE from 'three';

const COLLISION_PAIRS = [
  ['hL', 'chest', 'Mano izquierda contra torso'],
  ['hR', 'chest', 'Mano derecha contra torso'],
  ['fL', 'chest', 'Brazo izquierdo contra torso'],
  ['fR', 'chest', 'Brazo derecho contra torso'],
  ['tL', 'tR', 'Pierna contra pierna'],
  ['head', 'sL', 'Cabeza contra hombro izquierdo'],
  ['head', 'sR', 'Cabeza contra hombro derecho'],
];

export class CollisionSystem {
  constructor() {
    this.colliders = new Map();
  }

  updateColliders(bones) {
    this.colliders.clear();
    for (const [alias, bone] of bones.entries()) {
      const center = new THREE.Vector3();
      bone.getWorldPosition(center);
      const radius = getColliderRadius(alias);
      this.colliders.set(alias, new THREE.Sphere(center, radius));
    }
  }

  detect() {
    const collisions = [];
    for (const [a, b, label] of COLLISION_PAIRS) {
      const ca = this.colliders.get(a);
      const cb = this.colliders.get(b);
      if (!ca || !cb) continue;
      if (ca.intersectsSphere(cb)) {
        collisions.push({
          a,
          b,
          label,
          severity: a.startsWith('h') && b === 'chest' ? 'critical' : 'warning',
        });
      }
    }
    return collisions;
  }
}

function getColliderRadius(alias) {
  if (alias === 'chest') return 0.3;
  if (alias === 'head') return 0.13;
  if (alias.startsWith('h')) return 0.11;
  if (alias.startsWith('s')) return 0.14;
  if (alias.startsWith('f')) return 0.12;
  if (alias.startsWith('t')) return 0.14;
  if (alias.startsWith('kn')) return 0.12;
  if (alias.startsWith('ft')) return 0.11;
  return 0.16;
}
