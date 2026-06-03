import * as THREE from 'three';

export class CameraManager {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.defaultPosition = new THREE.Vector3(4.4, 2.65, 5.8);
  }

  focusObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);
    this.controls.target.copy(center);
    this.camera.position.set(center.x + radius * 1.4, center.y + radius * 0.75, center.z + radius * 1.8);
    this.camera.lookAt(center);
    this.controls.update();
  }

  reset() {
    this.camera.position.copy(this.defaultPosition);
    this.controls.target.set(0, 1.08, 0);
    this.controls.update();
  }

  front() {
    this.#view(0, 1.45, 5.8);
  }

  side() {
    this.#view(5.8, 1.45, 0);
  }

  top() {
    this.#view(0, 7.2, 0.01);
  }

  #view(x, y, z) {
    this.camera.position.set(x, y, z);
    this.controls.target.set(0, 1, 0);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }
}
