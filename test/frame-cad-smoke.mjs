// Full-frame CAD test: builds a realistic staggered pack (like the reference
// screenshot) and a square grid, checks dimensions, perf, and exports.
// Bundle via `node build-test.mjs test/frame-cad-smoke.mjs` then run the .cjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC } from "replicad";
import { buildModel, derived } from "../src/cad.js";
import { key } from "../src/gridModel.js";

const root = process.cwd();

const DEFAULTS = {
  pitch: 22.5,
  holeD: 21.4,
  lipD: 18,
  wallHeight: 10,
  baseThickness: 0.6,
  wall: 2,
  cornerRadius: 5,
  chamfer: 0.5,
  cols: 16,
  rows: 8,
  layout: "square",
  outlineStyle: "straight",
};

function cellsFrom(list) {
  const s = new Set();
  for (const [c, r] of list) s.add(key(c, r));
  return s;
}

// Reference-like staggered layout: a long 3-row band + a raised block on top.
function screenshotLayout() {
  const list = [];
  for (let c = 0; c < 11; c++) for (let r = 0; r < 3; r++) list.push([c, r]);
  for (let c = 6; c < 11; c++) list.push([c, 3]); // raised block
  return cellsFrom(list);
}

function meshBBox(solid) {
  const m = solid.mesh({ tolerance: 0.1, angularTolerance: 30 });
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], m.vertices[i + k]);
      mx[k] = Math.max(mx[k], m.vertices[i + k]);
    }
  return {
    size: mx.map((v, i) => +(v - mn[i]).toFixed(2)),
    tris: m.triangles.length / 3,
  };
}

async function main() {
  const wasmBinary = readFileSync(
    root + "/node_modules/replicad-opencascadejs/src/replicad_single.wasm"
  );
  setOC(await opencascade({ wasmBinary }));
  mkdirSync(root + "/test/out", { recursive: true });

  const twoIslands = cellsFrom([[0,0],[1,0],[0,1],[1,1],[7,0],[8,0],[7,1],[8,1]]);
  const cases = [
    { name: "screenshot-triangular-straight", params: { ...DEFAULTS, layout: "triangular", outlineStyle: "straight" }, cells: screenshotLayout() },
    { name: "square-straight-4x2", params: { ...DEFAULTS }, cells: cellsFrom([[0,0],[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[3,1]]) },
    { name: "square-hug-20cells", params: { ...DEFAULTS, outlineStyle: "hug" }, cells: cellsFrom(Array.from({length:20},(_,i)=>[i%5, Math.floor(i/5)])) },
    { name: "two-islands-separate", params: { ...DEFAULTS, joinGroups: false }, cells: twoIslands },
    { name: "two-islands-joined-straight", params: { ...DEFAULTS, joinGroups: true }, cells: twoIslands },
    { name: "two-islands-joined-hug", params: { ...DEFAULTS, outlineStyle: "hug", joinGroups: true, bridgeWidth: 10 }, cells: twoIslands },
  ];

  for (const { name, params, cells } of cases) {
    const t0 = Date.now();
    const solid = buildModel(cells, params);
    const ms = Date.now() - t0;
    const bb = meshBBox(solid);
    const d = derived(params);
    console.log(`\n[${name}] ${cells.size} cells  build ${ms}ms  meta=${JSON.stringify(solid.__meta)}`);
    console.log(`  bbox size (mm): ${bb.size.join(" x ")}  tris=${bb.tris}`);
    console.log(`  expected Z = ${d.totalH} (base ${d.baseTh} + wall ${params.wallHeight})`);
    if (Math.abs(bb.size[2] - d.totalH) > 0.05)
      throw new Error(`Height wrong for ${name}: ${bb.size[2]} != ${d.totalH}`);

    const step = Buffer.from(await solid.blobSTEP().arrayBuffer());
    writeFileSync(`${root}/test/out/${name}.step`, step);
    console.log(`  STEP ${step.length} bytes -> test/out/${name}.step`);
  }
  console.log("\nFRAME CAD SMOKE PASSED");
}

main().catch((e) => {
  console.error("FRAME CAD SMOKE FAILED:", e);
  process.exit(1);
});
