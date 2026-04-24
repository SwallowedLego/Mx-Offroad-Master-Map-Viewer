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
  density: 1,
  searchText: "",
  hover: null,
  selected: null,
  filteredFeatures: [],
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  movedWhilePanning: false,
  lastPointer: null,
};

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const selectionEl = document.getElementById("selection");
const listEl = document.getElementById("object-list");
const statsEl = document.getElementById("stats");
const legendEl = document.getElementById("legend");

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function worldToScreen(x, z) {
  const b = state.data.bounds;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const worldW = Math.max(1e-6, b.maxX - b.minX);
  const worldH = Math.max(1e-6, b.maxZ - b.minZ);
  const sx = ((x - b.minX) / worldW) * width;
  const sy = ((z - b.minZ) / worldH) * height;
  return {
    x: sx * state.zoom + state.panX,
    y: sy * state.zoom + state.panY,
  };
}

function screenToWorld(sx, sy) {
  const b = state.data.bounds;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const x = ((sx - state.panX) / Math.max(1e-6, state.zoom) / width) * (b.maxX - b.minX) + b.minX;
  const z = ((sy - state.panY) / Math.max(1e-6, state.zoom) / height) * (b.maxZ - b.minZ) + b.minZ;
  return { x, z };
}

function layerMatch(feature) {
  if (!feature.categories || feature.categories.length === 0) {
    return true;
  }
  for (const cat of feature.categories) {
    if (state.enabledLayers.has(cat)) {
      return true;
    }
  }
  return false;
}

function searchMatch(feature) {
  if (!state.searchText) {
    return true;
  }
  const needle = state.searchText;
  const blob = [feature.name, feature.tag, ...(feature.components || []), ...(feature.categories || [])]
    .join(" ")
    .toLowerCase();
  return blob.includes(needle);
}

function updateFiltered() {
  const filtered = state.data.features.filter((f) => layerMatch(f) && searchMatch(f));
  if (state.density < 1) {
    const stride = Math.max(1, Math.round(1 / state.density));
    state.filteredFeatures = filtered.filter((_, i) => i % stride === 0);
  } else {
    state.filteredFeatures = filtered;
  }
  renderObjectList();
}

function drawGrid() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.save();
  ctx.strokeStyle = "rgba(130, 206, 188, 0.14)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFeatures() {
  for (const feature of state.filteredFeatures) {
    const p = worldToScreen(feature.position.x, feature.position.z);
    const color = pickFeatureColor(feature);
    ctx.fillStyle = color;
    const r = state.selected?.id === feature.id ? 5 : 2.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawColliders() {
  const shouldShowCollider = state.enabledLayers.has("collider");
  const shouldShowTrigger = state.enabledLayers.has("trigger");
  if (!shouldShowCollider && !shouldShowTrigger) {
    return;
  }

  for (const col of state.data.colliders) {
    if (col.isTrigger && !shouldShowTrigger) {
      continue;
    }
    if (!col.isTrigger && !shouldShowCollider) {
      continue;
    }
    if (state.searchText) {
      const text = `${col.gameObjectName} ${col.type}`.toLowerCase();
      if (!text.includes(state.searchText)) {
        continue;
      }
    }

    const c = worldToScreen(col.center.x, col.center.z);
    ctx.save();
    ctx.strokeStyle = col.isTrigger ? "#ff5574" : "#76ff9e";
    ctx.fillStyle = col.isTrigger ? "rgba(255,85,116,0.2)" : "rgba(118,255,158,0.14)";
    ctx.lineWidth = col.isTrigger ? 2 : 1.2;

    if (col.type === "BoxCollider" && col.size) {
      const rx = Math.abs((col.size.x / (state.data.bounds.maxX - state.data.bounds.minX)) * canvas.clientWidth * 0.5 * state.zoom);
      const rz = Math.abs((col.size.z / (state.data.bounds.maxZ - state.data.bounds.minZ)) * canvas.clientHeight * 0.5 * state.zoom);
      ctx.beginPath();
      ctx.rect(c.x - rx, c.y - rz, rx * 2, rz * 2);
      ctx.fill();
      ctx.stroke();
    } else if ((col.type === "SphereCollider" || col.type === "CapsuleCollider") && Number.isFinite(col.radius)) {
      const rr = Math.abs((col.radius / (state.data.bounds.maxX - state.data.bounds.minX)) * canvas.clientWidth * state.zoom);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(2, rr), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(c.x - 4, c.y);
      ctx.lineTo(c.x + 4, c.y);
      ctx.moveTo(c.x, c.y - 4);
      ctx.lineTo(c.x, c.y + 4);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function pickFeatureColor(feature) {
  const priority = ["trigger", "collider", "visible", "script", "physics", "light", "camera", "audio", "particle"];
  for (const layer of priority) {
    if (feature.categories?.includes(layer)) {
      return LAYER_COLORS[layer];
    }
  }
  return "#d2f3e8";
}

function draw() {
  if (!state.data) {
    return;
  }
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  drawGrid();
  drawColliders();
  drawFeatures();
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
    .map(([k, v]) => `<div class="stat-card"><span>${k}</span><strong>${v}</strong></div>`)
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
  const slice = state.filteredFeatures.slice(0, 350);
  const html = slice
    .map((f) => {
      const cats = (f.categories || []).join("|");
      return `<button class="object-row" data-id="${f.id}">${f.name} [${cats}] (${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)})</button>`;
    })
    .join("");
  const plus = state.filteredFeatures.length > slice.length ? `<div class="object-row">... ${state.filteredFeatures.length - slice.length} more</div>` : "";
  listEl.innerHTML = html + plus;
}

function pickNearest(pointerX, pointerY) {
  const radius = 10;
  let best = null;
  let bestDist = Infinity;

  for (const feature of state.filteredFeatures) {
    const p = worldToScreen(feature.position.x, feature.position.z);
    const d = Math.hypot(pointerX - p.x, pointerY - p.y);
    if (d < radius && d < bestDist) {
      bestDist = d;
      best = { mode: "feature", item: feature };
    }
  }

  for (const col of state.data.colliders) {
    if (col.isTrigger && !state.enabledLayers.has("trigger")) {
      continue;
    }
    if (!col.isTrigger && !state.enabledLayers.has("collider")) {
      continue;
    }
    const c = worldToScreen(col.center.x, col.center.z);
    const d = Math.hypot(pointerX - c.x, pointerY - c.y);
    if (d < radius && d < bestDist) {
      bestDist = d;
      best = { mode: "collider", item: col };
    }
  }

  return best;
}

function wireEvents() {
  for (const box of document.querySelectorAll("[data-layer]")) {
    box.addEventListener("change", (e) => {
      const key = e.target.getAttribute("data-layer");
      if (e.target.checked) {
        state.enabledLayers.add(key);
      } else {
        state.enabledLayers.delete(key);
      }
      updateFiltered();
      draw();
    });
  }

  document.getElementById("search").addEventListener("input", (e) => {
    state.searchText = String(e.target.value || "").trim().toLowerCase();
    updateFiltered();
    draw();
  });

  document.getElementById("density").addEventListener("input", (e) => {
    const v = Number(e.target.value);
    state.density = Math.max(0.01, v / 100);
    updateFiltered();
    draw();
  });

  document.getElementById("reset-view").addEventListener("click", () => {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    draw();
  });

  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".object-row[data-id]");
    if (!row) {
      return;
    }
    const id = Number(row.getAttribute("data-id"));
    const feature = state.data.features.find((f) => f.id === id);
    if (!feature) {
      return;
    }
    state.selected = feature;
    renderSelection(feature, "feature");
    const p = worldToScreen(feature.position.x, feature.position.z);
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    state.panX += centerX - p.x;
    state.panY += centerY - p.y;
    draw();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * -0.08;
    const prev = state.zoom;
    state.zoom = Math.min(12, Math.max(0.25, state.zoom + delta));
    const mx = e.offsetX;
    const my = e.offsetY;
    state.panX = mx - ((mx - state.panX) / prev) * state.zoom;
    state.panY = my - ((my - state.panY) / prev) * state.zoom;
    draw();
  }, { passive: false });

  canvas.addEventListener("pointerdown", (e) => {
    state.isPanning = true;
    state.movedWhilePanning = false;
    state.lastPointer = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.isPanning || !state.lastPointer) {
      return;
    }
    const dx = e.clientX - state.lastPointer.x;
    const dy = e.clientY - state.lastPointer.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      state.movedWhilePanning = true;
    }
    state.lastPointer = { x: e.clientX, y: e.clientY };
    state.panX += dx;
    state.panY += dy;
    draw();
  });

  canvas.addEventListener("pointerup", (e) => {
    const moved = state.movedWhilePanning;
    state.isPanning = false;
    state.movedWhilePanning = false;
    state.lastPointer = null;
    if (!moved) {
      const picked = pickNearest(e.offsetX, e.offsetY);
      if (picked) {
        state.selected = picked.item;
        renderSelection(picked.item, picked.mode);
        draw();
      }
    }
  });

  window.addEventListener("resize", resizeCanvas);
}

async function boot() {
  const res = await fetch("./map-data.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load map-data.json (${res.status})`);
  }
  state.data = await res.json();
  renderStats();
  renderLegend();
  updateFiltered();
  wireEvents();
  resizeCanvas();

  if (state.data.features.length > 0) {
    state.selected = state.data.features[0];
    renderSelection(state.selected, "feature");
  }
}

boot().catch((err) => {
  selectionEl.textContent = `Error: ${err.message}`;
});