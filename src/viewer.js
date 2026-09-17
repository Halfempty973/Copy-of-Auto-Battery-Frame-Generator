// three.js preview of the generated frame. Meshes come from replicad and are
// converted to BufferGeometry by replicad-threejs-helper. Model is in mm.
// Also renders bright overall dimension lines (L x W x H) with arrowheads.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { syncGeometries } from "replicad-threejs-helper";

const DIM_COLOR = 0xffc83d; // bright amber, reads well on grey in light/dark

// Model / grid colours per theme (the canvas is transparent, so the model
// floats over the glass pane + ambient background).
const THEMES = {
  dark: { face: 0xc2c2c8, edge: 0x23262c, gridMain: 0x5b616e, gridSub: 0x3a3f49 },
  light: { face: 0x9298a3, edge: 0x39414f, gridMain: 0x9aa8bc, gridSub: 0xc4cedb },
};
const themeColors = () =>
  THEMES[document.documentElement.dataset.theme === "light" ? "light" : "dark"];

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0); // transparent -> ambient shows through

  const scene = new THREE.Scene(); // no background: the page/glass shows through

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 8000);
  camera.up.set(0, 0, 1); // Z up (CAD convention)
  camera.position.set(180, -220, 200);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
  keyLight.position.set(0.6, -1, 1.4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-1, 0.8, -0.6);
  scene.add(fillLight);

  let grid = null;
  function buildGrid() {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
    }
    const t = themeColors();
    grid = new THREE.GridHelper(600, 60, t.gridMain, t.gridSub);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.rotateX(Math.PI / 2);
    scene.add(grid);
  }
  buildGrid();

  const group = new THREE.Group();
  scene.add(group);
  const dimsGroup = new THREE.Group();
  scene.add(dimsGroup);

  const faceMat = new THREE.MeshStandardMaterial({
    color: themeColors().face,
    metalness: 0.15,
    roughness: 0.65,
    side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: themeColors().edge });

  // Re-read theme colours (call on theme toggle).
  function applyTheme() {
    const t = themeColors();
    faceMat.color.setHex(t.face);
    edgeMat.color.setHex(t.edge);
    buildGrid();
  }

  let geoms = [];
  let meshObj = null;
  let edgeObj = null;
  let framed = false; // auto-fit only on the first build; keep the user's angle after
  let lastBB = null; // centred bbox of the latest model (for double-click re-fit)

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  // ---- dimension overlay ----
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    g.clear();
  }

  function makeLabel(text) {
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d");
    const fs = 64;
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    const tw = Math.ceil(ctx.measureText(text).width);
    cv.width = tw + 32;
    cv.height = fs + 28;
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(24,24,28,0.82)";
    roundRect(ctx, 0, 0, cv.width, cv.height, 14);
    ctx.fill();
    ctx.fillStyle = "#ffd873";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cv.width / 2, cv.height / 2 + 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
    );
    const mmTall = 7;
    spr.scale.set((mmTall * cv.width) / cv.height, mmTall, 1);
    spr.renderOrder = 1000;
    return spr;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function doubleArrow(a, b) {
    const g = new THREE.Group();
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length();
    if (len < 1e-3) return g;
    dir.normalize();
    const lineMat = new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A, B]), lineMat);
    line.renderOrder = 999;
    g.add(line);
    const headLen = Math.min(3.5, len * 0.18);
    const coneGeo = new THREE.ConeGeometry(headLen * 0.45, headLen, 14);
    const coneMat = new THREE.MeshBasicMaterial({ color: DIM_COLOR, depthTest: false });
    const up = new THREE.Vector3(0, 1, 0);
    for (const [pos, d] of [[B, dir], [A, dir.clone().negate()]]) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.copy(pos);
      cone.quaternion.setFromUnitVectors(up, d);
      cone.renderOrder = 999;
      g.add(cone);
    }
    return g;
  }

  function extLine(a, b) {
    const mat = new THREE.LineBasicMaterial({ color: DIM_COLOR, transparent: true, opacity: 0.45, depthTest: false });
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]),
      mat
    );
    l.renderOrder = 998;
    return l;
  }

  function buildDims(bb) {
    disposeGroup(dimsGroup);
    const { min, max } = bb;
    const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
    const off = Math.max(8, Math.max(size.x, size.y) * 0.08);
    const mid = (a, b) => (a + b) / 2;

    // Length (X): in front (y = min.y - off), at base level.
    const yF = min.y - off;
    dimsGroup.add(doubleArrow([min.x, yF, min.z], [max.x, yF, min.z]));
    dimsGroup.add(extLine([min.x, min.y, min.z], [min.x, yF, min.z]));
    dimsGroup.add(extLine([max.x, min.y, min.z], [max.x, yF, min.z]));
    let lbl = makeLabel(`L  ${size.x.toFixed(1)} mm`);
    lbl.position.set(mid(min.x, max.x), yF - 5, min.z);
    dimsGroup.add(lbl);

    // Width (Y): on the left (x = min.x - off), at base level.
    const xL = min.x - off;
    dimsGroup.add(doubleArrow([xL, min.y, min.z], [xL, max.y, min.z]));
    dimsGroup.add(extLine([min.x, min.y, min.z], [xL, min.y, min.z]));
    dimsGroup.add(extLine([min.x, max.y, min.z], [xL, max.y, min.z]));
    lbl = makeLabel(`W  ${size.y.toFixed(1)} mm`);
    lbl.position.set(xL - 5, mid(min.y, max.y), min.z);
    dimsGroup.add(lbl);

    // Height (Z): back-right vertical edge.
    const xR = max.x + off * 0.7;
    dimsGroup.add(doubleArrow([xR, max.y, min.z], [xR, max.y, max.z]));
    dimsGroup.add(extLine([max.x, max.y, min.z], [xR, max.y, min.z]));
    dimsGroup.add(extLine([max.x, max.y, max.z], [xR, max.y, max.z]));
    lbl = makeLabel(`H  ${size.z.toFixed(1)} mm`);
    lbl.position.set(xR + 6, max.y, mid(min.z, max.z));
    dimsGroup.add(lbl);
  }

  function frameCamera(bb) {
    resize(); // make sure camera.aspect is current before fitting
    // Pad the framed volume so the dimension lines + labels stay in view.
    const sx = bb.max.x - bb.min.x,
      sy = bb.max.y - bb.min.y,
      sz = bb.max.z - bb.min.z;
    const off = Math.max(8, Math.max(sx, sy) * 0.08);
    const pad = off + 30; // dimension offset + label allowance per side
    const c = new THREE.Vector3(
      (bb.min.x + bb.max.x) / 2,
      (bb.min.y + bb.max.y) / 2,
      (bb.min.z + bb.max.z) / 2
    );
    // Bounding-sphere radius of the padded box (orientation-independent fit).
    const hx = sx / 2 + pad,
      hy = sy / 2 + pad,
      hz = sz / 2 + pad * 0.4;
    const radius = Math.max(Math.hypot(hx, hy, hz), 12);
    // Fit to the tighter of vertical / horizontal FOV (handles portrait panes).
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fitFov = Math.min(vFov, hFov);
    const dist = (radius / Math.sin(fitFov / 2)) * 1.08;
    controls.target.copy(c);
    const dirVec = new THREE.Vector3(0.45, -0.8, 0.5).normalize();
    camera.position.copy(c).addScaledVector(dirVec, dist);
    camera.near = Math.max(dist / 1000, 0.5);
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function update(shape) {
    const faces = shape.mesh({ tolerance: 0.05, angularTolerance: 20 });
    const edges = shape.meshEdges({ keepMesh: true });
    geoms = syncGeometries([{ name: "frame", faces, edges }], geoms);
    const g = geoms[0];
    if (meshObj) group.remove(meshObj);
    if (edgeObj) group.remove(edgeObj);
    meshObj = new THREE.Mesh(g.faces, faceMat);
    edgeObj = new THREE.LineSegments(g.lines, edgeMat);
    group.add(meshObj);
    group.add(edgeObj);

    g.faces.computeBoundingBox();
    const bb = g.faces.boundingBox;
    // Centre the model (and its dimension overlay) on the grid origin — the
    // exported STEP keeps its own coordinates; this is display-only.
    const offX = -(bb.min.x + bb.max.x) / 2;
    const offY = -(bb.min.y + bb.max.y) / 2;
    group.position.set(offX, offY, 0);
    dimsGroup.position.set(offX, offY, 0);
    buildDims(bb); // built in model coords; the group offset centres it
    lastBB = {
      min: { x: bb.min.x + offX, y: bb.min.y + offY, z: bb.min.z },
      max: { x: bb.max.x + offX, y: bb.max.y + offY, z: bb.max.z },
    };
    // Auto-fit only the first time — refreshes keep the user's camera angle.
    if (!framed) {
      frameCamera(lastBB);
      framed = true;
    }
  }

  function clear() {
    if (meshObj) group.remove(meshObj);
    if (edgeObj) group.remove(edgeObj);
    meshObj = edgeObj = null;
    geoms = [];
    disposeGroup(dimsGroup);
    framed = false; // next build starts fresh -> auto-fit again
  }

  // Double-click the viewport to re-fit the camera to the current model.
  canvas.addEventListener("dblclick", () => {
    if (lastBB) frameCamera(lastBB);
  });

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  setTimeout(resize, 0);

  return { update, clear, resize, applyTheme };
}
