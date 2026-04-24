import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const LAYER_COLORS = {
  visible: "#7ce0ff",
  collider: "#7dff9f",
  trigger: "#ff5c7a",
  script: "#f8cb5f",
  physics: "#9fb5ff",
  light: "#ffe186",
  camera: "#ffd27d",
  audio: "#d6a4ff",
  particle: "#9af8d1",
};

const state = {
  data: null,
  enabledLayers: new Set(Object.keys(LAYER_COLORS)),
  searchText: "",
  density: 1,
  filteredFeatures: [],
  selected: null,
  isPointerLocked: false,
  keys: new Set(),
  yaw: 0,
  pitch: 0,
  moveSpeed: 90,
};

const viewportEl = document.getElementById("viewport");
const selectionEl = document.getElementById("selection");
const listEl = document.getElementById("object-list");
const statsEl = document.getElementById("stats");
const legendEl = document.getElementById("legend");
const filteredCountEl = document.getElementById("filtered-count");

const layerGroups = new Map();
const featurePointClouds = [];
const surfaceMeshes = [];
const featureById = new Map();
let scene;
let camera;
let renderer;
let raycaster;
let colliderGroup;
let selectedMarker;
let animationClock;

function colorOf(layer) {
  return new THREE.Color(LAYER_COLORS[layer] || "#d2f3e8");
}

function layerMatch(feature) {
  if (!feature.categories || feature.categories.length === 0) {
    return true;
  }
  for (const layer of feature.categories) {
    if (state.enabledLayers.has(layer)) {
      return true;
    }
  }
  return false;
}

function searchMatch(feature) {
  if (!state.searchText) {
    return true;
  }
  const text = [feature.name, feature.tag, ...(feature.components || []), ...(feature.categories || [])]
    .join(" ")
    .toLowerCase();
  return text.includes(state.searchText);
}

function updateFiltered() {
  const all = state.data.features.filter((feature) => layerMatch(feature) && searchMatch(feature));
  if (state.density >= 0.999) {
    state.filteredFeatures = all;
  } else {
    const stride = Math.max(1, Math.round(1 / state.density));
    state.filteredFeatures = all.filter((_, index) => index % stride === 0);
  }
  renderObjectList();
}

function buildFeatureIndex() {
  featureById.clear();
  for (const feature of state.data.features) {
    featureById.set(feature.id, feature);
  }
}

function renderStats() {
  const stats = state.data.meta;
  const items = [
    ["GameObjects", stats.gameObjectCount],
    ["Features", stats.featureCount],
    ["Colliders", stats.colliderCount],
    ["Triggers", state.data.stats.triggerColliderCount],
  ];
  statsEl.innerHTML = items
    .map(([key, value]) => `<div class="stat-card"><span>${key}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderLegend() {
  legendEl.innerHTML = Object.entries(LAYER_COLORS)
    .map(
      ([layer, color]) =>
        `<div class="legend-row"><span class="legend-swatch" style="background:${color}"></span>${layer}</div>`
    )
    .join("");
}

function renderSelection(item, mode) {
  if (!item) {
    selectionEl.textContent = "Nothing selected.";
    return;
  }

  if (mode === "collider") {
    selectionEl.textContent = [
      `Collider ${item.id}`,
      `GameObject: ${item.gameObjectName} (${item.gameObjectId})`,
      `Type: ${item.type}`,
      `Trigger: ${item.isTrigger}`,
      `Enabled: ${item.enabled}`,
      `Center: (${item.center.x}, ${item.center.y}, ${item.center.z})`,
      item.size ? `Size: (${item.size.x}, ${item.size.y}, ${item.size.z})` : "",
      Number.isFinite(item.radius) ? `Radius: ${item.radius}` : "",
      Number.isFinite(item.height) ? `Height: ${item.height}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return;
  }

  selectionEl.textContent = [
    `GameObject ${item.id}`,
    `Name: ${item.name}`,
    `Active: ${item.active}`,
    `Layer: ${item.layer}`,
    `Tag: ${item.tag || "(none)"}`,
    `Position: (${item.position.x}, ${item.position.y}, ${item.position.z})`,
    `Categories: ${(item.categories || []).join(", ") || "(none)"}`,
    `Components: ${(item.components || []).join(", ") || "(none)"}`,
  ].join("\n");
}

function renderObjectList() {
  filteredCountEl.textContent = `${state.filteredFeatures.length} objects visible`;
  const slice = state.filteredFeatures.slice(0, 300);
  const rows = slice
    .map((feature) => {
      const cats = (feature.categories || []).join("|");
      return `<button class="object-row" data-id="${feature.id}">${feature.name} [${cats}] (${feature.position.x.toFixed(1)}, ${feature.position.y.toFixed(1)}, ${feature.position.z.toFixed(1)})</button>`;
    })
    .join("");
  const extra =
    state.filteredFeatures.length > slice.length
      ? `<div class="object-row">... ${state.filteredFeatures.length - slice.length} more</div>`
      : "";
  listEl.innerHTML = rows + extra;
}

function setSelectedMarker(position) {
  selectedMarker.position.copy(position);
  selectedMarker.visible = true;
}

function focusCameraOn(position) {
  const offset = new THREE.Vector3(25, 12, 25);
  camera.position.copy(position.clone().add(offset));
  camera.lookAt(position);
  state.yaw = camera.rotation.y;
  state.pitch = camera.rotation.x;
}

function clearSceneObjects() {
  for (const points of featurePointClouds) {
    points.geometry.dispose();
    points.material.dispose();
    points.parent?.remove(points);
  }
  featurePointClouds.length = 0;

  for (const mesh of surfaceMeshes) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  surfaceMeshes.length = 0;

  for (const wire of [...colliderGroup.children]) {
    wire.geometry.dispose();
    wire.material.dispose();
    colliderGroup.remove(wire);
  }
}

function addMapSurfaceLayer() {
  const mapGeometry = state.data.mapGeometry;
  if (!mapGeometry || !Array.isArray(mapGeometry.meshes) || !Array.isArray(mapGeometry.instances)) {
    return;
  }

  const meshesById = new Map();
  for (const meshDef of mapGeometry.meshes) {
    if (!Array.isArray(meshDef.positions) || !Array.isArray(meshDef.indices)) {
      continue;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(meshDef.positions, 3));
    geometry.setIndex(meshDef.indices);
    geometry.computeVertexNormals();
    meshesById.set(meshDef.id, geometry);
  }

  const byMeshId = new Map();
  for (const instance of mapGeometry.instances) {
    if (!meshesById.has(instance.meshId)) {
      continue;
    }
    if (!byMeshId.has(instance.meshId)) {
      byMeshId.set(instance.meshId, []);
    }
    byMeshId.get(instance.meshId).push(instance);
  }

  const surfaceLayer = layerGroups.get("visible");
  const tempMatrix = new THREE.Matrix4();
  const tempPosition = new THREE.Vector3();
  const tempRotation = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();

  for (const [meshId, instances] of byMeshId) {
    const geometry = meshesById.get(meshId);
    const material = new THREE.MeshStandardMaterial({
      color: "#9eb8a3",
      roughness: 0.92,
      metalness: 0.03,
      flatShading: false,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, instances.length);
    instanced.frustumCulled = false;
    instanced.userData = {
      mode: "surface",
      instances,
    };

    for (let i = 0; i < instances.length; i += 1) {
      const inst = instances[i];
      tempPosition.set(inst.position.x, inst.position.y, inst.position.z);
      tempRotation.set(inst.rotation.x, inst.rotation.y, inst.rotation.z, inst.rotation.w);
      tempScale.set(inst.scale.x, inst.scale.y, inst.scale.z);
      tempMatrix.compose(tempPosition, tempRotation, tempScale);
      instanced.setMatrixAt(i, tempMatrix);
    }
    instanced.instanceMatrix.needsUpdate = true;

    surfaceLayer.add(instanced);
    surfaceMeshes.push(instanced);
  }
}

function addFeatureLayers() {
  const featuresByLayer = new Map();
  for (const layer of Object.keys(LAYER_COLORS)) {
    featuresByLayer.set(layer, []);
  }

  for (const feature of state.filteredFeatures) {
    const categories = feature.categories || [];
    if (categories.length === 0) {
      featuresByLayer.get("script").push(feature);
      continue;
    }
    for (const layer of categories) {
      if (featuresByLayer.has(layer)) {
        featuresByLayer.get(layer).push(feature);
      }
    }
  }

  for (const [layer, features] of featuresByLayer) {
    if (layer === "visible" && surfaceMeshes.length > 0) {
      continue;
    }
    if (features.length === 0) {
      continue;
    }

    const positions = new Float32Array(features.length * 3);
    for (let i = 0; i < features.length; i += 1) {
      positions[i * 3] = featurePosition(features[i]).x;
      positions[i * 3 + 1] = featurePosition(features[i]).y;
      positions[i * 3 + 2] = featurePosition(features[i]).z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: colorOf(layer),
      size: layer === "trigger" ? 8.5 : 6.8,
      sizeAttenuation: false,
      transparent: true,
      opacity: layer === "trigger" ? 1 : 0.92,
      depthWrite: false,
      fog: false,
    });

    const points = new THREE.Points(geometry, material);
    points.userData = {
      mode: "feature-points",
      layer,
      features,
    };
    points.visible = state.enabledLayers.has(layer);
    layerGroups.get(layer).add(points);
    featurePointClouds.push(points);
  }
}

function addColliderVisual(collider) {
  const isTrigger = Boolean(collider.isTrigger);
  const color = isTrigger ? new THREE.Color("#ff5c7a") : new THREE.Color("#7dff9f");
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: isTrigger ? 0.9 : 0.58,
  });

  const center = new THREE.Vector3(collider.center.x, collider.center.y, collider.center.z);
  let geometry;
  if (collider.type === "BoxCollider" && collider.size) {
    geometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(
        Math.max(collider.size.x, 0.01),
        Math.max(collider.size.y, 0.01),
        Math.max(collider.size.z, 0.01)
      )
    );
  } else if ((collider.type === "SphereCollider" || collider.type === "CapsuleCollider") && Number.isFinite(collider.radius)) {
    geometry = new THREE.EdgesGeometry(new THREE.SphereGeometry(Math.max(collider.radius, 0.1), 10, 8));
  } else {
    geometry = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.7));
  }

  const wire = new THREE.LineSegments(geometry, lineMaterial);
  wire.position.copy(center);
  wire.userData = {
    mode: "collider",
    collider,
  };
  wire.visible = isTrigger ? state.enabledLayers.has("trigger") : state.enabledLayers.has("collider");
  colliderGroup.add(wire);
}

function addColliderLayers() {
  for (const collider of state.data.colliders) {
    if (state.searchText) {
      const text = `${collider.gameObjectName} ${collider.type}`.toLowerCase();
      if (!text.includes(state.searchText)) {
        continue;
      }
    }
    addColliderVisual(collider);
  }
}

function rebuildMapVisuals() {
  clearSceneObjects();
  addMapSurfaceLayer();
  addFeatureLayers();
  addColliderLayers();
}

function featurePosition(feature) {
  return new THREE.Vector3(feature.position.x, feature.position.y, feature.position.z);
}

function updateCameraRotation() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;
}

function applyMovement(delta) {
  if (!state.isPointerLocked) {
    return;
  }

  const speedScale = state.keys.has("ShiftLeft") || state.keys.has("ShiftRight") ? 2.7 : 1;
  const speed = state.moveSpeed * speedScale * delta;

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0);
  const move = new THREE.Vector3();

  if (state.keys.has("KeyW")) {
    move.add(forward);
  }
  if (state.keys.has("KeyS")) {
    move.sub(forward);
  }
  if (state.keys.has("KeyD")) {
    move.add(right);
  }
  if (state.keys.has("KeyA")) {
    move.sub(right);
  }
  if (state.keys.has("KeyE")) {
    move.add(up);
  }
  if (state.keys.has("KeyQ")) {
    move.sub(up);
  }

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed);
    camera.position.add(move);
  }
}

function pickInCenter() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.params.Points.threshold = 3.6;
  raycaster.params.Line.threshold = 2.0;

  const intersections = raycaster.intersectObjects(scene.children, true);
  for (const hit of intersections) {
    if (hit.object.userData?.mode === "feature-points") {
      const feature = hit.object.userData.features[hit.index];
      if (!feature) {
        continue;
      }
      state.selected = feature;
      renderSelection(feature, "feature");
      setSelectedMarker(featurePosition(feature));
      return;
    }

    if (hit.object.userData?.mode === "collider") {
      const collider = hit.object.userData.collider;
      state.selected = collider;
      renderSelection(collider, "collider");
      setSelectedMarker(new THREE.Vector3(collider.center.x, collider.center.y, collider.center.z));
      return;
    }

    if (hit.object.userData?.mode === "surface") {
      const instanceId = hit.instanceId;
      const inst = instanceId != null ? hit.object.userData.instances[instanceId] : null;
      const feature = inst ? featureById.get(inst.gameObjectId) : null;
      if (feature) {
        state.selected = feature;
        renderSelection(feature, "feature");
        setSelectedMarker(featurePosition(feature));
      } else if (inst) {
        selectionEl.textContent = [
          `Surface Instance`,
          `GameObject: ${inst.gameObjectName} (${inst.gameObjectId})`,
          `Mesh: ${inst.meshId}`,
        ].join("\n");
      }
      return;
    }
  }
}

function resetCamera() {
  const b = state.data.bounds;
  const center = new THREE.Vector3((b.minX + b.maxX) * 0.5, 80, (b.minZ + b.maxZ) * 0.5);
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  camera.position.set(center.x + span * 0.12, center.y + span * 0.06, center.z + span * 0.12);
  camera.lookAt(center);
  state.yaw = camera.rotation.y;
  state.pitch = camera.rotation.x;
}

function configureThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#0f1f25");
  scene.fog = new THREE.Fog(0x0f1f25, 900, 7000);

  camera = new THREE.PerspectiveCamera(68, 1, 0.1, 12000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  viewportEl.appendChild(renderer.domElement);

  raycaster = new THREE.Raycaster();

  const hemi = new THREE.HemisphereLight(0x99c3ff, 0x223322, 0.8);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xfff0d7, 0.65);
  dir.position.set(90, 180, -40);
  scene.add(dir);

  const grid = new THREE.GridHelper(5000, 140, 0x3a6a68, 0x264844);
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.position.y = 0;
  scene.add(grid);

  colliderGroup = new THREE.Group();
  colliderGroup.name = "colliders";
  scene.add(colliderGroup);

  for (const layer of Object.keys(LAYER_COLORS)) {
    const group = new THREE.Group();
    group.name = `layer-${layer}`;
    group.visible = state.enabledLayers.has(layer);
    layerGroups.set(layer, group);
    scene.add(group);
  }

  selectedMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 12, 12),
    new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9 })
  );
  selectedMarker.visible = false;
  scene.add(selectedMarker);

  animationClock = new THREE.Clock();
}

function resizeRenderer() {
  const width = Math.max(1, viewportEl.clientWidth);
  const height = Math.max(1, viewportEl.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, animationClock.getDelta());
  applyMovement(delta);
  renderer.render(scene, camera);
}

function wireEvents() {
  for (const box of document.querySelectorAll("[data-layer]")) {
    box.addEventListener("change", (event) => {
      const layer = event.target.getAttribute("data-layer");
      if (event.target.checked) {
        state.enabledLayers.add(layer);
      } else {
        state.enabledLayers.delete(layer);
      }

      if (layerGroups.has(layer)) {
        layerGroups.get(layer).visible = state.enabledLayers.has(layer);
      }
      updateFiltered();
      rebuildMapVisuals();
    });
  }

  document.getElementById("search").addEventListener("input", (event) => {
    state.searchText = String(event.target.value || "").trim().toLowerCase();
    updateFiltered();
    rebuildMapVisuals();
  });

  document.getElementById("density").addEventListener("input", (event) => {
    const value = Number(event.target.value || 100);
    state.density = Math.max(0.01, value / 100);
    updateFiltered();
    rebuildMapVisuals();
  });

  document.getElementById("reset-view").addEventListener("click", () => {
    resetCamera();
  });

  listEl.addEventListener("click", (event) => {
    const row = event.target.closest(".object-row[data-id]");
    if (!row) {
      return;
    }

    const id = Number(row.getAttribute("data-id"));
    const feature = state.data.features.find((entry) => entry.id === id);
    if (!feature) {
      return;
    }

    state.selected = feature;
    renderSelection(feature, "feature");
    const position = featurePosition(feature);
    setSelectedMarker(position);
    focusCameraOn(position);
  });

  viewportEl.addEventListener("click", () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    state.isPointerLocked = document.pointerLockElement === renderer.domElement;
  });

  document.addEventListener("mousemove", (event) => {
    if (!state.isPointerLocked) {
      return;
    }
    const sensitivity = 0.0019;
    state.yaw -= event.movementX * sensitivity;
    state.pitch -= event.movementY * sensitivity;
    state.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
    updateCameraRotation();
  });

  document.addEventListener("keydown", (event) => {
    state.keys.add(event.code);
    if (event.code === "KeyF") {
      pickInCenter();
    }
  });

  document.addEventListener("keyup", (event) => {
    state.keys.delete(event.code);
  });

  window.addEventListener("resize", resizeRenderer);
}

async function boot() {
  const response = await fetch("./map-data.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load map-data.json (${response.status})`);
  }

  state.data = await response.json();
  buildFeatureIndex();
  configureThree();
  renderStats();
  renderLegend();
  wireEvents();
  updateFiltered();
  rebuildMapVisuals();
  resizeRenderer();
  resetCamera();

  if (state.data.features.length > 0) {
    state.selected = state.data.features[0];
    renderSelection(state.selected, "feature");
    setSelectedMarker(featurePosition(state.selected));
  }

  animate();
}

boot().catch((error) => {
  selectionEl.textContent = `Error: ${error.message}`;
});