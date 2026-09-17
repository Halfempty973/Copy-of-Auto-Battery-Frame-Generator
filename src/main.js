// Battery Frame Generator — app bootstrap and UI wiring.
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import wasmBinary from "replicad-opencascadejs/src/replicad_single.wasm";
import { setOC } from "replicad";

import { createState, DEFAULTS, NUMERIC, autoCornerRadius } from "./state.js";
import { createGridView } from "./gridView.js";
import { createViewer } from "./viewer.js";
import { buildModel, derived } from "./cad.js";
import { exportSTEP, exportSTL } from "./exporter.js";
import { key } from "./gridModel.js";

const $ = (id) => document.getElementById(id);

const busy = $("busy");
const busyMsg = $("busyMsg");
const toastEl = $("toast");
let toastTimer = null;

function setBusy(on, msg) {
  if (msg) busyMsg.textContent = msg;
  busy.classList.toggle("show", !!on);
}
function toast(msg, kind = "") {
  toastEl.textContent = msg;
  toastEl.className = "show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ""), 3200);
}
// Let the browser paint the busy overlay before a long main-thread CAD op.
const yieldPaint = () => new Promise((r) => setTimeout(r, 50));

const state = createState();
let gridView = null;
let viewer = null;
let lastShape = null; // cached solid; invalidated on any change
let buildCount = 0; // successful builds this session (exposed on the test hook)

function syncInputsFromState() {
  for (const k of NUMERIC) if ($(k)) $(k).value = state.params[k];
  $("layout").value = state.params.layout;
  $("outlineStyle").value = state.params.outlineStyle;
  $("autoPreview").checked = !!state.params.autoPreview;
  $("joinGroups").checked = !!state.params.joinGroups;
  updateDerivedUI();
}

function updateDerivedUI() {
  const p = state.params;
  const d = derived(p);
  $("cornerRadius").disabled = p.outlineStyle !== "straight";
  // Bridge width only applies to hug-style bridges between joined groups.
  $("bridgeWidth").disabled = !(p.joinGroups && p.outlineStyle === "hug");
  $("dims").textContent =
    `Total height ${d.totalH.toFixed(1)} mm (base ${p.baseThickness} + wall ${p.wallHeight}). ` +
    `Cells sit ${p.wallHeight} mm deep on a ${d.lipWidth.toFixed(2)} mm lip; ` +
    `${p.lipD} mm tab-access hole through the base.`;
  $("cellCount").textContent = state.cells.size;
  $("cellCountNote").textContent = state.cells.size ? `× 21700` : "";
  $("hCellCount").textContent = state.cells.size;
  validate();
}

function validate() {
  const p = state.params;
  const d = derived(p);
  const w = [];
  if (p.holeD >= p.pitch)
    w.push(`⚠ Hole ø (${p.holeD}) ≥ pitch (${p.pitch}); cells would overlap.`);
  else if (p.pitch - p.holeD < 0.8)
    w.push(`⚠ Only ${(p.pitch - p.holeD).toFixed(2)} mm wall between holes — thin/fragile.`);
  if (p.lipD >= p.holeD)
    w.push(`⚠ Lip hole ø (${p.lipD}) ≥ cell hole ø (${p.holeD}); no retention lip.`);
  else if (d.lipWidth < 0.5)
    w.push(`⚠ Retention lip is only ${d.lipWidth.toFixed(2)} mm wide — cells may push through.`);
  $("warnings").textContent = w.join("\n");
}

function invalidate() {
  lastShape = null;
}

// Debounced auto-preview: rebuild ~0.5 s after the last change (drag-painting
// keeps pushing the timer out). Toggleable for very large frames.
let autoTimer = null;
function scheduleAutoPreview() {
  if (!state.params.autoPreview) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (state.cells.size) generate({ silent: true });
    else viewer.clear();
  }, 500);
}

function onGridChange() {
  invalidate();
  updateDerivedUI();
  state.save();
  scheduleAutoPreview();
}

// ---- build / export ----
// silent=true (auto-update): no overlay, no success toast — builds quietly in
// the background. Errors are still surfaced as a toast.
async function generate({ silent = false } = {}) {
  if (!state.cells.size) {
    if (!silent) toast("Place at least one cell first.", "error");
    return null;
  }
  if (!silent) {
    setBusy(true, "Building model…");
    await yieldPaint();
  }
  try {
    const shape = buildModel(state.cells, state.params);
    viewer.update(shape);
    lastShape = shape;
    buildCount++;
    if (!silent) {
      const m = shape.__meta || {};
      toast(`Built ${m.cellCount} cells.`, "ok");
    }
    return shape;
  } catch (e) {
    console.error(e);
    toast("Build failed: " + (e && e.message ? e.message : e), "error");
    return null;
  } finally {
    if (!silent) setBusy(false);
  }
}

async function ensureShape() {
  if (lastShape) return lastShape;
  return await generate();
}

async function doExport(kind) {
  setBusy(true, "Preparing " + kind.toUpperCase() + "…");
  await yieldPaint();
  try {
    const shape = lastShape || buildModel(state.cells, state.params);
    lastShape = shape;
    if (kind === "step") exportSTEP(shape);
    else exportSTL(shape);
    toast(kind.toUpperCase() + " downloaded.", "ok");
  } catch (e) {
    console.error(e);
    toast("Export failed: " + (e && e.message ? e.message : e), "error");
  } finally {
    setBusy(false);
  }
}

// ---- wiring ----
function wireInputs() {
  for (const k of NUMERIC) {
    const el = $(k);
    if (!el) continue;
    el.addEventListener("change", () => {
      let v = parseFloat(el.value);
      if (!isFinite(v)) v = DEFAULTS[k];
      if (k === "cols" || k === "rows") v = Math.max(1, Math.round(v));
      state.params[k] = v;
      el.value = v;
      if (k === "cols" || k === "rows") state.clampCells();
      // Corner radius tracks holeD/2 + wall until the user edits it directly.
      if (k === "cornerRadius") {
        state.params.cornerRadiusManual = true;
      } else if ((k === "holeD" || k === "wall") && !state.params.cornerRadiusManual) {
        state.params.cornerRadius = autoCornerRadius(state.params);
        $("cornerRadius").value = state.params.cornerRadius;
      }
      invalidate();
      gridView.render();
      updateDerivedUI();
      state.save();
      scheduleAutoPreview();
    });
  }
  for (const k of ["layout", "outlineStyle"]) {
    $(k).addEventListener("change", () => {
      state.params[k] = $(k).value;
      invalidate();
      gridView.render();
      updateDerivedUI();
      state.save();
      scheduleAutoPreview();
    });
  }
  $("autoPreview").addEventListener("change", () => {
    state.params.autoPreview = $("autoPreview").checked;
    state.save();
    if (state.params.autoPreview && !lastShape) scheduleAutoPreview();
  });
  $("joinGroups").addEventListener("change", () => {
    state.params.joinGroups = $("joinGroups").checked;
    invalidate();
    gridView.render();
    updateDerivedUI();
    state.save();
    scheduleAutoPreview();
  });

  $("btnSelectAll").addEventListener("click", () => {
    for (let r = 0; r < state.params.rows; r++)
      for (let c = 0; c < state.params.cols; c++) state.cells.add(key(c, r));
    gridView.render();
    onGridChange();
  });
  $("btnClear").addEventListener("click", () => {
    state.cells.clear();
    gridView.render();
    onGridChange();
  });
  $("btnMirror").addEventListener("click", () => {
    const cols = state.params.cols;
    const mirrored = new Set();
    for (const kk of state.cells) {
      const [c, r] = kk.split(",").map(Number);
      mirrored.add(key(cols - 1 - c, r));
    }
    state.cells = mirrored;
    gridView.render();
    onGridChange();
  });

  $("btnGenerate").addEventListener("click", () => generate());
  $("btnExportStep").addEventListener("click", () => doExport("step"));
  $("btnExportStl").addEventListener("click", () => doExport("stl"));

  wireChrome();
}

// Theme toggle + fullscreen toggles for the two panes.
function wireChrome() {
  $("btnTheme").addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem("bfg-theme", next);
    } catch {}
    // The 3D viewer reads its colours from CSS variables — re-read them.
    viewer.applyTheme();
  });

  const toggleFull = (el) => () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen)
      el.requestFullscreen().catch(() => {}); // ignore if the browser blocks it
  };
  $("btnFullGrid").addEventListener("click", toggleFull($("gridWrap")));
  $("btnFullView").addEventListener("click", toggleFull($("viewWrap")));
  // The 3D canvas must resize to its new box on enter/exit fullscreen.
  document.addEventListener("fullscreenchange", () => {
    requestAnimationFrame(() => viewer.resize());
  });
}

async function boot() {
  setBusy(true, "Loading CAD kernel…");
  // Restore saved session (params + selection).
  state.load();
  // Keep the tracked corner-radius default in sync (also migrates old saves).
  if (!state.params.cornerRadiusManual)
    state.params.cornerRadius = autoCornerRadius(state.params);

  viewer = createViewer($("view"));
  gridView = createGridView($("grid"), state, onGridChange);
  syncInputsFromState();
  gridView.render();
  wireInputs();

  try {
    const OC = await opencascade({ wasmBinary });
    setOC(OC);
  } catch (e) {
    console.error(e);
    setBusy(true, "Failed to load CAD kernel — see console.");
    return;
  }
  setBusy(false);
  // Keep the preview canvas sized correctly once visible.
  requestAnimationFrame(() => viewer.resize());
  // Restore the preview for a saved layout.
  if (state.params.autoPreview && state.cells.size) scheduleAutoPreview();

  // Power-user / test hook.
  window.__bfg = {
    state,
    generate,
    render: () => gridView.render(),
    syncInputs: syncInputsFromState,
    key,
    get buildCount() {
      return buildCount;
    },
  };
}

boot();
