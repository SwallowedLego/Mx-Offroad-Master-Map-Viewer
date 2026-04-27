import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const viewportEl = document.getElementById("viewport");

let scene;
let camera;
let renderer;
let clock;
let mapRoot;
const keys = new Set();

let yaw = 0;
let pitch = 0;
let pointerLocked = false;

const moveSpeed = 120;
const mouseSensitivity = 0.0018;

function createRenderer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#101417");
  scene.fog = new THREE.Fog(0x101417, 900, 9000);
  mapRoot = new THREE.Group();
  mapRoot.scale.set(1, 1, -1);
  scene.add(mapRoot);

  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 20000);
  camera.rotation.order = "YXZ";

  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight, false);
  viewportEl.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xa9c4ff, 0x2c332a, 0.75);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xfff6d8, 0.85);
  dir.position.set(250, 320, -200);
  scene.add(dir);

  clock = new THREE.Clock();
}

function setCameraFromBounds(bounds) {
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  camera.position.set(centerX + span * 0.15, span * 0.09 + 80, -(centerZ + span * 0.15));
  camera.lookAt(centerX, 60, -centerZ);
  yaw = camera.rotation.y;
  pitch = camera.rotation.x;
}

function buildMapMeshes(data) {
  const mapGeometry = data.mapGeometry;
  if (!mapGeometry || !Array.isArray(mapGeometry.meshes) || !Array.isArray(mapGeometry.instances)) {
    throw new Error("mapGeometry missing in map-data.json");
  }

  const geometryByMeshId = new Map();
  for (const meshDef of mapGeometry.meshes) {
    if (!Array.isArray(meshDef.positions) || !Array.isArray(meshDef.indices)) {
      continue;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(meshDef.positions, 3));
    geometry.setIndex(meshDef.indices);
    geometry.computeVertexNormals();
    geometryByMeshId.set(meshDef.id, geometry);
  }

  const instancesByMeshId = new Map();
  for (const instance of mapGeometry.instances) {
    if (!geometryByMeshId.has(instance.meshId)) {
      continue;
    }
    if (!instancesByMeshId.has(instance.meshId)) {
      instancesByMeshId.set(instance.meshId, []);
    }
    instancesByMeshId.get(instance.meshId).push(instance);
  }

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: "#95aa93",
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const tempMatrix = new THREE.Matrix4();
  const tempPosition = new THREE.Vector3();
  const tempRotation = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();

  for (const [meshId, instances] of instancesByMeshId) {
    const geometry = geometryByMeshId.get(meshId);
    const mesh = new THREE.InstancedMesh(geometry, baseMaterial, instances.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    for (let i = 0; i < instances.length; i += 1) {
      const inst = instances[i];
      tempPosition.set(inst.position.x, inst.position.y, inst.position.z);
      tempRotation.set(inst.rotation.x, inst.rotation.y, inst.rotation.z, inst.rotation.w);
      tempScale.set(inst.scale.x, inst.scale.y, inst.scale.z);
      tempMatrix.compose(tempPosition, tempRotation, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mapRoot.add(mesh);
  }
}

function updateCameraRotation() {
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function stepMovement(deltaSeconds) {
  if (!pointerLocked) {
    return;
  }

  const speedMultiplier = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2.5 : 1;
  const step = moveSpeed * speedMultiplier * deltaSeconds;

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();

  if (keys.has("KeyW")) dir.add(forward);
  if (keys.has("KeyS")) dir.sub(forward);
  if (keys.has("KeyD")) dir.add(right);
  if (keys.has("KeyA")) dir.sub(right);
  if (keys.has("KeyE")) dir.add(up);
  if (keys.has("KeyQ")) dir.sub(up);

  if (dir.lengthSq() > 0) {
    dir.normalize().multiplyScalar(step);
    camera.position.add(dir);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, clock.getDelta());
  stepMovement(delta);
  renderer.render(scene, camera);
}

function wireControls() {
  viewportEl.addEventListener("click", () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
  });

  document.addEventListener("mousemove", (event) => {
    if (!pointerLocked) {
      return;
    }
    yaw -= event.movementX * mouseSensitivity;
    pitch -= event.movementY * mouseSensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    updateCameraRotation();
  });

  document.addEventListener("keydown", (event) => {
    keys.add(event.code);
  });

  document.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  window.addEventListener("resize", () => {
    const width = Math.max(1, viewportEl.clientWidth);
    const height = Math.max(1, viewportEl.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  });
}

async function boot() {
  const response = await fetch("./map-data.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`failed to load map-data.json (${response.status})`);
  }

  const data = await response.json();
  createRenderer();
  buildMapMeshes(data);
  setCameraFromBounds(data.bounds);
  wireControls();
  animate();
}

boot().catch((error) => {
  document.body.textContent = `Renderer failed: ${error.message}`;
});