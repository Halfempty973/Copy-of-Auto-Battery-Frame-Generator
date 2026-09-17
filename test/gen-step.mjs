// Generate a fresh STEP of a stepped square-grid frame from the CURRENT code,
// and report the exact tab-hole profile so we can hand it over as a known-good
// reference.
import { readFileSync, writeFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC, makeCylinder } from "replicad";
import { buildModel } from "../src/cad.js";
import { key, cellCenter } from "../src/gridModel.js";

const root = process.cwd();
const params = {
  pitch: 22.5, holeD: 21.4, lipD: 18, wallHeight: 10, baseThickness: 0.6,
  wall: 2, cornerRadius: 5, cols: 12, rows: 8, layout: "square", outlineStyle: "straight",
};

async function main() {
  setOC(await opencascade({
    wasmBinary: readFileSync(root + "/node_modules/replicad-opencascadejs/src/replicad_single.wasm"),
  }));
  const l = [];
  for (let c = 0; c < 8; c++) { l.push([c, 0]); l.push([c, 1]); }
  for (let c = 2; c < 8; c++) l.push([c, 2]);
  for (let c = 2; c < 6; c++) l.push([c, 3]);
  const set = new Set(l.map(([c, r]) => key(c, r)));
  const solid = buildModel(set, params);

  // profile the bore of a middle cell
  const [cx, cy] = cellCenter(4, 1, params);
  const m = solid.mesh({ tolerance: 0.02, angularTolerance: 15 });
  const buckets = new Map();
  for (let i = 0; i < m.vertices.length; i += 3) {
    const r = Math.hypot(m.vertices[i] - cx, m.vertices[i + 1] - cy);
    if (r < 0.05 || r > 11.5) continue;
    const zk = (Math.round(m.vertices[i + 2] * 20) / 20).toFixed(2);
    const cur = buckets.get(zk);
    if (cur === undefined || r < cur) buckets.set(zk, r);
  }
  console.log("bore profile (z -> min radius) for a middle cell:");
  for (const zk of [...buckets.keys()].sort((a, b) => +a - +b))
    console.log(`  z=${zk}  r=${buckets.get(zk).toFixed(2)}`);

  const step = Buffer.from(await solid.blobSTEP().arrayBuffer());
  writeFileSync(root + "/test/out/reference-open-hole.step", step);
  console.log(`\nWrote reference-open-hole.step (${step.length} bytes)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
