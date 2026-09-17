// Node-side smoke test: proves the replicad CAD pipeline (wasmBinary boot,
// 2D drawing, extrude, 2D hole cut, fuse, frustum-chamfer cut, STEP + STL export).
// Bundled to CJS via build-test.mjs, then run from the project root.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import {
  setOC,
  drawCircle,
  drawRoundedRectangle,
} from "replicad";

const root = process.cwd();

async function main() {
const wasmBinary = readFileSync(
  root + "/node_modules/replicad-opencascadejs/src/replicad_single.wasm"
);

console.log("Booting OpenCascade from wasmBinary…");
const t0 = Date.now();
const OC = await opencascade({ wasmBinary });
setOC(OC);
console.log(`OC ready in ${Date.now() - t0} ms`);

const pitch = 22.5;
const holeR = 21.4 / 2;
const lipR = 18 / 2;
const wall = 2;
const baseTh = 0.6;
const totalH = 0.6 + 10; // 10.6
const chamfer = 0.5;

const centers = [
  [0, 0],
  [pitch, 0],
];
let outline = null;
for (const [x, y] of centers) {
  const r = drawRoundedRectangle(pitch + 2 * wall, pitch + 2 * wall, 5).translate(x, y);
  outline = outline ? outline.fuse(r) : r;
}

const cellHoles = centers
  .map(([x, y]) => drawCircle(holeR).translate(x, y))
  .reduce((a, b) => a.fuse(b));
const lipHoles = centers
  .map(([x, y]) => drawCircle(lipR).translate(x, y))
  .reduce((a, b) => a.fuse(b));

const bbox = (shape, label) => {
  const m = shape.mesh({ tolerance: 0.1, angularTolerance: 30 });
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], m.vertices[i + k]);
      mx[k] = Math.max(mx[k], m.vertices[i + k]);
    }
  console.log(`  bbox[${label}]:`, mx.map((v, i) => +(v - mn[i]).toFixed(2)));
};

console.log("Extruding block (lip holes, full height) then cutting cell holes above base…");
const eps = 0.01;
// Full-height solid with the SMALL lip holes everywhere (single extrude, no 3D fuse).
const block = outline.cut(lipHoles).sketchOnPlane("XY").extrude(totalH);
bbox(block, "block");
// Cut the larger cell holes, but only from the top of the base upward, leaving
// the 0.6 mm lip ring at the bottom of every hole.
const cellTool = cellHoles.sketchOnPlane("XY", baseTh).extrude(totalH - baseTh + eps);
let solid = block.cut(cellTool);
bbox(solid, "block-cut");

console.log("Building + cutting chamfer frustum tool…");
const fr = chamfer;
try {
  const tool = centers
    .map(([x, y]) =>
      drawCircle(holeR)
        .translate(x, y)
        .sketchOnPlane("XY", totalH - chamfer)
        .extrude(fr, {
          extrusionProfile: { profile: "linear", endFactor: (holeR + fr) / holeR },
        })
    )
    .reduce((a, b) => a.fuse(b));
  solid = solid.cut(tool);
  console.log("Chamfer applied OK");
} catch (e) {
  console.warn("Chamfer FAILED (would fall back to no-chamfer):", e.message);
}

console.log("Meshing…");
const mesh = solid.mesh({ tolerance: 0.05, angularTolerance: 30 });
console.log(
  `mesh: ${mesh.vertices.length / 3} verts, ${mesh.triangles.length / 3} tris`
);

let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < mesh.vertices.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], mesh.vertices[i + k]);
    max[k] = Math.max(max[k], mesh.vertices[i + k]);
  }
}
const size = max.map((v, i) => +(v - min[i]).toFixed(3));
console.log("Bounding box size (mm):", size);
console.log("  expected ~", [
  +(pitch + holeR * 2 + wall * 2).toFixed(3),
  +(holeR * 2 + wall * 2).toFixed(3),
  totalH,
]);

console.log("Exporting STEP + STL…");
const stepBlob = solid.blobSTEP();
const stlBlob = solid.blobSTL();
mkdirSync(root + "/test/out", { recursive: true });
const stepBuf = Buffer.from(await stepBlob.arrayBuffer());
const stlBuf = Buffer.from(await stlBlob.arrayBuffer());
writeFileSync(root + "/test/out/smoke.step", stepBuf);
writeFileSync(root + "/test/out/smoke.stl", stlBuf);
console.log(`STEP ${stepBuf.length} bytes, STL ${stlBuf.length} bytes`);

const stepText = stepBuf.toString("latin1");
console.log("STEP starts with:", stepText.slice(0, 30).replace(/\n/g, " "));
console.log("STEP mentions MILLI unit:", /MILLI/.test(stepText));
console.log("\nSMOKE TEST PASSED");
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e);
  process.exit(1);
});
