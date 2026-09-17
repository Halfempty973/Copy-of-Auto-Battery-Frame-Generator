// Exhaustive tab-hole check: for realistic stepped shapes across many parameter
// sets, probe EVERY active cell's lip bore with a fat axial rod. Report any cell
// where the rod hits material (a blockage / disc), with its z-extent.
import { readFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC, makeCylinder } from "replicad";
import { buildModel } from "../src/cad.js";
import { key, cellCenter } from "../src/gridModel.js";

const root = process.cwd();

const BASE = {
  pitch: 22.5, holeD: 21.4, lipD: 18, wallHeight: 10, baseThickness: 0.6,
  wall: 2, cornerRadius: 5, cols: 12, rows: 8, layout: "square", outlineStyle: "straight",
};

// stepped shape like the reference/screenshots
function stepped() {
  const l = [];
  for (let c = 0; c < 8; c++) { l.push([c, 0]); l.push([c, 1]); }
  for (let c = 2; c < 8; c++) l.push([c, 2]);
  for (let c = 2; c < 6; c++) l.push([c, 3]);
  return l;
}

function zExtent(shape) {
  try {
    const m = shape.mesh({ tolerance: 0.05, angularTolerance: 30 });
    if (!m.vertices.length) return null;
    let lo = Infinity, hi = -Infinity;
    for (let i = 2; i < m.vertices.length; i += 3) { lo = Math.min(lo, m.vertices[i]); hi = Math.max(hi, m.vertices[i]); }
    return { lo, hi };
  } catch { return null; }
}

async function probeAll(params, cellList) {
  const set = new Set(cellList.map(([c, r]) => key(c, r)));
  const solid = buildModel(set, params);
  const rProbe = params.lipD / 2 - 0.3;
  const H = params.baseThickness + params.wallHeight;
  let blocked = 0;
  const details = [];
  for (const [c, r] of cellList) {
    const [cx, cy] = cellCenter(c, r, params);
    const rod = makeCylinder(rProbe, H + 2, [cx, cy, -1]);
    const ext = zExtent(solid.intersect(rod));
    if (ext) { blocked++; if (details.length < 4) details.push(`(${c},${r}) z=${ext.lo.toFixed(2)}..${ext.hi.toFixed(2)}`); }
  }
  return { blocked, total: cellList.length, details };
}

async function main() {
  setOC(await opencascade({
    wasmBinary: readFileSync(root + "/node_modules/replicad-opencascadejs/src/replicad_single.wasm"),
  }));

  const configs = [
    { label: "square/straight default", p: {} },
    { label: "triangular/straight default", p: { layout: "triangular" } },
    { label: "square/hug default", p: { outlineStyle: "hug" } },
    { label: "base 0.4", p: { baseThickness: 0.4 } },
    { label: "base 1.0", p: { baseThickness: 1.0 } },
    { label: "lipD 16", p: { lipD: 16 } },
    { label: "lipD 20", p: { lipD: 20 } },
    { label: "wall 1", p: { wall: 1 } },
    { label: "wall 3", p: { wall: 3 } },
    { label: "wallHeight 5", p: { wallHeight: 5 } },
    { label: "wallHeight 20", p: { wallHeight: 20 } },
    { label: "pitch 21.5 (tight)", p: { pitch: 21.5 } },
  ];

  // POSITIVE CONTROL: probe a point in the solid wall between two cells — the
  // rod MUST hit material, proving the probe detects blockages.
  {
    const params = { ...BASE };
    const set = new Set(stepped().map(([c, r]) => key(c, r)));
    const solid = buildModel(set, params);
    const [x0, y0] = cellCenter(3, 0, params);
    const [x1] = cellCenter(4, 0, params);
    const wallX = (x0 + x1) / 2; // between two holes -> solid
    const rod = makeCylinder(0.4, 30, [wallX, y0, -1]);
    const ext = zExtent(solid.intersect(rod));
    console.log(`CONTROL (solid wall point): ${ext ? `material z=${ext.lo.toFixed(2)}..${ext.hi.toFixed(2)} — probe WORKS ✓` : "NOTHING — probe BROKEN ✗"}`);
  }

  let anyBlocked = false;
  for (const { label, p } of configs) {
    const params = { ...BASE, ...p };
    const res = await probeAll(params, stepped());
    const flag = res.blocked ? `✗ ${res.blocked}/${res.total} BLOCKED: ${res.details.join("; ")}` : `✓ all ${res.total} open`;
    if (res.blocked) anyBlocked = true;
    console.log(`${label.padEnd(28)} ${flag}`);
  }
  console.log(anyBlocked ? "\nFOUND BLOCKAGES" : "\nALL CONFIGS: tab holes fully open");
}
main().catch((e) => { console.error(e); process.exit(1); });
