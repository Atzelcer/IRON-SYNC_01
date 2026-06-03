import * as THREE from 'three';

export function setupLights(scene) {
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x23282d, 2.2));

  const ambient = new THREE.AmbientLight(0x9fb4c8, 0.55);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 4.6);
  key.position.set(4.8, 7.4, 5.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 18;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x83bfff, 1.15);
  fill.position.set(-4.6, 3.4, 3.8);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x9fe8ff, 2.2);
  rim.position.set(-5, 3.2, -4.6);
  scene.add(rim);

  const overhead = new THREE.RectAreaLight(0xffffff, 4.2, 5.4, 2.2);
  overhead.position.set(0, 4.1, 0.4);
  overhead.lookAt(0, 0.9, 0);
  scene.add(overhead);

  const wallAccent = new THREE.PointLight(0x1fa4ff, 8.5, 7.5, 2.2);
  wallAccent.position.set(0, 2.1, -2.7);
  scene.add(wallAccent);
}
