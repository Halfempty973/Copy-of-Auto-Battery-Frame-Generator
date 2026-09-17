// Face-level census of the generated solid — catches zero-thickness membrane
// faces that volume probes and vertex counts CANNOT see.
// For each B-rep face (mesh faceGroups), report z-extent and radial extent
// about the cell axis, and flag any horizontal face that is not one of the
// legitimate ones (bottom z=0, top z=totalH, shelf z=baseTh spanning lipR..holeR).
import { readFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC } from "replicad";
import { buildModel, derived } from "../src/cad.js";
import { key, cellCenter } from "../src/gridModel.js";

const root = process.cwd();

const BASE = {
  pitch: 22.5, holeD: 21.4, lipD: 18, wallHeight: 10, baseThickness: 0.6,
  wall: 2, cornerRadius: 5, cols: 16, rows: 8,
  layout: "square", outlineStyle: "hug",
};

async function main() {
  setOC(await opencascade({
    wasmBinary: readFileSync(root + "/node_modules/replicad-opencascadejs/src/replicad_single.wasm"),
  }));

  const CONFIGS = [
    { name: "1 cell, hug (user's case)", p: {}, cellList: [[7, 4]], probe: [7, 4] },
    { name: "3x3 straight, middle cell", p: { outlineStyle: "straight" }, cellList: (() => { const l = []; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) l.push([c, r]); return l; })(), probe: [1, 1] },
    { name: "stepped triangular, mid", p: { layout: "triangular", outlineStyle: "straight" }, cellList: (() => { const l = []; for (let c = 0; c < 8; c++) { l.push([c, 0]); l.push([c, 1]); } for (let c = 2; c < 8; c++) l.push([c, 2]); return l; })(), probe: [4, 1] },
    { name: "1 cell, base 1.0 lip 16", p: { baseThickness: 1.0, lipD: 16 }, cellList: [[7, 4]], probe: [7, 4] },
  ];

  let totalArtifacts = 0;
  for (const cfg of CONFIGS) {
    const params = { ...BASE, ...cfg.p };
    console.log(`\n=== ${cfg.name} ===`);
    totalArtifacts += censusOne(params, cfg.cellList, cfg.probe);
  }
  console.log(totalArtifacts ? `\n${totalArtifacts} TOTAL ARTIFACT FACE(S) — FAIL` : "\nALL CONFIGS CLEAN — no membrane faces anywhere");
  if (totalArtifacts) process.exit(1);
}

function censusOne(params, cellList, _probe) {
  const cells = new Set(cellList.map(([c, r]) => key(c, r)));
  const centers = cellList.map(([c, r]) => cellCenter(c, r, params));
  const d = derived(params);
  const solid = buildModel(cells, params);

  const m = solid.mesh({ tolerance: 0.02, angularTolerance: 15 });
  const v = m.vertices;
  const tri = m.triangles;

  const totalTris = tri.length / 3;
  const sumCounts = m.faceGroups.reduce((a, g) => a + g.count, 0);
  // start/count may be in triangle units or raw-index units; detect.
  const raw = sumCounts > totalTris; // counts already include the *3
  // radial distance to the NEAREST cell axis (correct for multi-cell shapes)
  const rNearest = (x, y) => {
    let best = Infinity;
    for (const [cx, cy] of centers) best = Math.min(best, Math.hypot(x - cx, y - cy));
    return best;
  };
  let artifacts = 0;
  let flats = 0;
  for (const g of m.faceGroups) {
    let zmin = Infinity, zmax = -Infinity, rmin = Infinity, rmax = -Infinity;
    const t0 = raw ? g.start / 3 : g.start;
    const tN = raw ? (g.start + g.count) / 3 : g.start + g.count;
    for (let t = t0; t < tN; t++) {
      for (const vi of [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]]) {
        const x = v[3 * vi], y = v[3 * vi + 1], z = v[3 * vi + 2];
        const r = rNearest(x, y);
        zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
        rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
      }
    }
    const flat = zmax - zmin < 0.001;
    if (!flat) continue;
    flats++;
    const z = zmin;
    const isBottom = Math.abs(z) < 0.005;
    const isTop = Math.abs(z - d.totalH) < 0.005;
    // A legit shelf is an ANNULUS about its cell axis: vertices on BOTH rims
    // (rmin≈lipR AND rmax≈holeR) at exactly z=baseTh. A membrane disc
    // fan-triangulates from ONE rim (rmin≈rmax) — anything else is an artifact.
    const isShelf =
      Math.abs(z - d.baseTh) < 0.005 &&
      Math.abs(rmin - d.lipR) < 0.05 &&
      Math.abs(rmax - d.holeR) < 0.05;
    if (!isBottom && !isTop && !isShelf) {
      artifacts++;
      console.log(`  ARTIFACT face ${g.faceId}: FLAT z=${z.toFixed(3)}  r ${rmin.toFixed(2)}..${rmax.toFixed(2)}`);
    }
  }
  console.log(`faces=${m.faceGroups.length} flat=${flats} artifacts=${artifacts} ${artifacts ? "✗ MEMBRANE" : "✓ clean"}`);
  return artifacts;
}
main().catch((e) => { console.error(e); process.exit(1); });
