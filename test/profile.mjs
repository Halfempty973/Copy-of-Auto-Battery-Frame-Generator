// Profile build phases + meshing + STEP export for a large pack.
import { readFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC } from "replicad";
import { buildModel } from "../src/cad.js";
import { key } from "../src/gridModel.js";

const root = process.cwd();
const params = {
  pitch: 22.5, holeD: 21.4, lipD: 18, wallHeight: 10, baseThickness: 0.6,
  wall: 2, cornerRadius: 5, chamfer: 0.5, cols: 16, rows: 8,
  layout: "triangular", outlineStyle: "straight",
};

async function main() {
  setOC(await opencascade({
    wasmBinary: readFileSync(root + "/node_modules/replicad-opencascadejs/src/replicad_single.wasm"),
  }));

  const cells = new Set();
  for (let c = 0; c < 11; c++) for (let r = 0; r < 3; r++) cells.add(key(c, r));
  for (let c = 6; c < 11; c++) cells.add(key(c, 3));

  const timings = [];
  const t0 = Date.now();
  const solid = buildModel(cells, params, { profile: (l, ms) => timings.push([l, ms]) });
  const buildMs = Date.now() - t0;

  let t = Date.now();
  solid.mesh({ tolerance: 0.08, angularTolerance: 30 });
  solid.meshEdges({ keepMesh: true });
  const meshMs = Date.now() - t;

  t = Date.now();
  const step = await solid.blobSTEP().arrayBuffer();
  const stepMs = Date.now() - t;

  console.log(`${cells.size} cells:`);
  for (const [l, ms] of timings) console.log(`  ${l.padEnd(14)} ${ms} ms`);
  console.log(`  ${"mesh".padEnd(14)} ${meshMs} ms`);
  console.log(`  ${"STEP export".padEnd(14)} ${stepMs} ms`);
  console.log(`  TOTAL build ${buildMs} ms (+mesh ${meshMs} +step ${stepMs})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
