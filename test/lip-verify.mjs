// Verify the retention lip: at the base (z<baseTh) the hole should be lip-ø,
// above the base it should be cell-ø. Measures hole-wall radius per z-band from
// a fine mesh of a single-cell frame.
import { readFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs/src/replicad_single.js";
import { setOC } from "replicad";
import { buildModel, derived } from "../src/cad.js";
import { key } from "../src/gridModel.js";

const root = process.cwd();

const params = {
  pitch: 22.5, holeD: 21.4, lipD: 18, wallHeight: 10, baseThickness: 0.6,
  wall: 2, cornerRadius: 5, chamfer: 0.5, cols: 4, rows: 4,
  layout: "square", outlineStyle: "straight",
};

async function main() {
  setOC(await opencascade({
    wasmBinary: readFileSync(root + "/node_modules/replicad-opencascadejs/src/replicad_single.wasm"),
  }));

  const cells = new Set([key(1, 1)]); // single cell at (1,1)
  const [cx, cy] = [1 * params.pitch, 1 * params.pitch];
  const solid = buildModel(cells, params);
  const d = derived(params);

  // Fine mesh
  const m = solid.mesh({ tolerance: 0.02, angularTolerance: 15 });
  const v = m.vertices;

  // For vertices on the hole wall (radius < 11.2 from axis, i.e. inside the
  // outer wall region but on/near the bore), collect min radial distance per band.
  // Cylindrical faces only produce vertices at their z-boundaries, so bands
  // must span the boundary rings (base: z=0 and z=baseTh; wall: z=baseTh..top).
  const bands = {
    base: { zLo: -0.1, zHi: d.baseTh + 0.05, min: Infinity },
    wall: { zLo: d.baseTh + 0.06, zHi: d.totalH + 0.1, min: Infinity },
  };
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    const r = Math.hypot(x - cx, y - cy);
    if (r < 0.1 || r > 11.5) continue; // ignore axis noise and outer wall
    for (const b of Object.values(bands)) {
      if (z >= b.zLo && z <= b.zHi) b.min = Math.min(b.min, r);
    }
  }

  // Dump per-z-level min radius for the bore.
  const buckets = new Map();
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    const r = Math.hypot(x - cx, y - cy);
    if (r < 0.1 || r > 11.6) continue;
    const zk = (Math.round(z * 20) / 20).toFixed(2);
    const cur = buckets.get(zk);
    if (!cur || r < cur) buckets.set(zk, r);
  }
  console.log("z-level : minRadius (bore profile)");
  for (const zk of [...buckets.keys()].sort((a, b) => +a - +b))
    console.log(`  z=${zk}  r=${buckets.get(zk).toFixed(2)}`);

  // Definitive open-hole check: a clear bore has NO mesh vertices strictly
  // inside the lip radius. A membrane (even fan-triangulated) would put a
  // center vertex there.
  let insideCount = 0;
  let insideZ = [];
  for (let i = 0; i < v.length; i += 3) {
    const r = Math.hypot(v[i] - cx, v[i + 1] - cy);
    if (r < d.lipR - 1.0) {
      insideCount++;
      insideZ.push(+v[i + 2].toFixed(2));
    }
  }
  console.log(`vertices strictly inside the bore (r < ${(d.lipR - 1).toFixed(1)}): ${insideCount}` +
    (insideCount ? ` at z=${[...new Set(insideZ)].join(",")}` : " — hole is fully open"));

  const baseR = +bands.base.min.toFixed(3);
  const wallR = +bands.wall.min.toFixed(3);
  console.log(`base band (z ${bands.base.zLo}–${bands.base.zHi.toFixed(2)}): min hole radius = ${baseR}  (expect ~${d.lipR})`);
  console.log(`wall band (z ${bands.wall.zLo.toFixed(2)}–${bands.wall.zHi.toFixed(2)}): min hole radius = ${wallR}  (expect ~${d.holeR})`);

  const okBase = Math.abs(baseR - d.lipR) < 0.15;
  const okWall = Math.abs(wallR - d.holeR) < 0.15;
  const okOpen = insideCount === 0;
  if (okBase && okWall && okOpen)
    console.log("\nLIP VERIFY PASSED — retention lip present, tab hole fully open, correct diameters.");
  else { console.log(`\nLIP VERIFY FAILED (base=${okBase} wall=${okWall} open=${okOpen})`); process.exit(1); }
}

main().catch((e) => { console.error("LIP VERIFY ERROR:", e); process.exit(1); });
