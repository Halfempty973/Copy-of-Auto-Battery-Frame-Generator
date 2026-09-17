// Verify the straight-sides outline: edges are straight LINES (horizontal,
// vertical or angled) and every arc on the border has the SAME radius rc.
// Shapes: a full staggered block and a consistent staircase. (A lone cell
// protruding less than the ball radius is smoothed by design — not tested.)
// Pure JS — run directly.
import { buildOutline } from "../src/outline.js";
import { fitSegments } from "../src/arcFit.js";
import { key } from "../src/gridModel.js";

const BASE = {
  pitch: 22.5, holeD: 21.4, wall: 2, cornerRadius: 12.7,
  cols: 16, rows: 8, outlineStyle: "straight",
};

function block() {
  const cells = new Set();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) cells.add(key(c, r));
  return cells;
}
// Staircase with CONSISTENT row shift -> straight diagonal edges.
// square: +1 col per row (45 deg); triangular: +half pitch per row (60 deg).
function staircase(layout) {
  const cells = new Set();
  for (let r = 0; r < 4; r++) {
    const start = layout === "square" ? r : Math.floor(r / 2);
    for (let c = 0; c < 6; c++) cells.add(key(start + c, r));
  }
  return cells;
}

function circleFrom3(p, q, r) {
  const d = 2 * (p[0] * (q[1] - r[1]) + q[0] * (r[1] - p[1]) + r[0] * (p[1] - q[1]));
  if (Math.abs(d) < 1e-9) return Infinity;
  const p2 = p[0] ** 2 + p[1] ** 2, q2 = q[0] ** 2 + q[1] ** 2, r2 = r[0] ** 2 + r[1] ** 2;
  const ux = (p2 * (q[1] - r[1]) + q2 * (r[1] - p[1]) + r2 * (p[1] - q[1])) / d;
  const uy = (p2 * (r[0] - q[0]) + q2 * (p[0] - r[0]) + r2 * (q[0] - p[0])) / d;
  return Math.hypot(p[0] - ux, p[1] - uy);
}

// Straightness is asserted via the arc-fitter itself: fitSegments emits "line"
// segments only for genuinely straight runs (0.015mm tolerance). A wavy or
// bowed border would fit as arcs (radius-checked) or short line fragments —
// so we require LONG fitted lines to exist.

let ok = true;
for (const layout of ["square", "triangular"]) {
  for (const [name, cells] of [["block", block()], ["staircase", staircase(layout)]]) {
    const params = { ...BASE, layout };
    const regions = buildOutline(cells, params);
    if (regions.length !== 1) {
      console.log(`${layout}/${name}: regions=${regions.length} (expected 1) ✗`);
      ok = false;
      continue;
    }
    const ring = regions[0].outer;
    const xs = ring.map((p) => p[0]);
    const spanX = Math.max(...xs) - Math.min(...xs);
    if (spanX < 5 * params.pitch) {
      console.log(`${layout}/${name}: span ${spanX.toFixed(1)}mm too small ✗`);
      ok = false;
      continue;
    }
    const segs = fitSegments(ring);
    const radii = [];
    let longestLine = 0;
    let cur = ring[0];
    for (const s of segs) {
      if (s.type === "arc") radii.push(circleFrom3(cur, s.mid, s.end));
      else longestLine = Math.max(longestLine, Math.hypot(s.end[0] - cur[0], s.end[1] - cur[1]));
      cur = s.end;
    }
    const nLines = segs.length - radii.length;
    const rMin = Math.min(...radii), rMax = Math.max(...radii);
    const arcsOk = rMin > params.cornerRadius - 0.7 && rMax < params.cornerRadius + 0.7;
    const linesOk = nLines >= 3 && longestLine > 4 * params.pitch;
    if (!arcsOk || !linesOk) ok = false;
    console.log(
      `${layout.padEnd(10)}/${name.padEnd(9)} segs=${segs.length} (${nLines} lines, ${radii.length} arcs) ` +
        `radii ${rMin.toFixed(2)}..${rMax.toFixed(2)} (target ${params.cornerRadius}) ${arcsOk ? "UNIFORM ✓" : "MISMATCHED ✗"}  ` +
        `longest line ${longestLine.toFixed(1)}mm ${linesOk ? "STRAIGHT ✓" : "✗"}`
    );
  }
}
console.log(ok ? "\nUNIFORM RADIUS CHECK PASSED" : "\nUNIFORM RADIUS CHECK FAILED");
if (!ok) process.exit(1);
