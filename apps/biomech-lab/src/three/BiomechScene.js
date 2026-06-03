import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class BiomechScene {
  constructor(canvasHost) {
    this.canvasHost = canvasHost;
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111418);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(3.6, 2.4, 5.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.canvasHost.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1.2, 0);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    this.debugGroup = new THREE.Group();
    this.scene.add(this.debugGroup);

    this.#setupLights();
    this.#setupFloor();
    this.resize();
  }

  setModel(object) {
    this.modelRoot.clear();
    this.modelRoot.add(object);
  }

  setDebugSpheres(colliders) {
    this.debugGroup.clear();
    for (const [, sphere] of colliders.entries()) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(sphere.radius, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x66d9ef, wireframe: true, transparent: true, opacity: 0.36 }),
      );
      mesh.position.copy(sphere.center);
      this.debugGroup.add(mesh);
    }
  }

  resize() {
    const rect = this.canvasHost.getBoundingClientRect();
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  #setupLights() {
    const hemi = new THREE.HemisphereLight(0xaec7ff, 0x1e252b, 2.4);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 3);
    key.castShadow = true;
    this.scene.add(key);
  }

  #setupFloor() {
    const grid = new THREE.GridHelper(8, 24, 0x2d98da, 0x2f3740);
    grid.position.y = -0.02;
    this.scene.add(grid);
  }
}
