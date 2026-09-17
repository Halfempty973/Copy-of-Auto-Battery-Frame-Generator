// Multi-island behaviour of buildOutline:
//  1. COVERAGE: every active cell (centre + hole rim) lies inside the outline —
//     regression for the opening-erosion eating peripheral cells.
//  2. join OFF: separate groups -> separate clean regions (no cross-group
//     merging, spikes or teardrops).
//  3. join ON: single connected region; hug bridges at least bridgeWidth wide.
// Pure JS — run directly.
import { buildOutline } from "../src/outline.js";
import { key, cellCenter, activeCenters } from "../src/gridModel.js";

const BASE = {
  pitch: 22.5, holeD: 21.4, lipD: 18, wall: 2, cornerRadius: 12.7,
  cols: 20, rows: 10, joinGroups: false, bridgeWidth: 10,
};

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function pointInRegions(pt, regions) {
  for (const reg of regions) {
    if (pointInRing(pt, reg.outer) && !reg.holes.some((h) => pointInRing(pt, h)))
      return true;
  }
  return false;
}

function coverageOk(cells, params, regions) {
  const holeR = params.holeD / 2;
  const missed = [];
  for (const k of cells) {
    const [c, r] = k.split(",").map(Number);
    const [x, y] = cellCenter(c, r, params);
    const probes = [[x, y]];
    for (let a = 0; a < 8; a++)
      probes.push([x + holeR * Math.cos((a * Math.PI) / 4), y + holeR * Math.sin((a * Math.PI) / 4)]);
    if (!probes.every((p) => pointInRegions(p, regions))) missed.push(k);
  }
  return missed;
}

// Boundary width at a point: twice the min distance from the point to any ring.
function widthAt(pt, regions) {
  let d = Infinity;
  for (const reg of regions) {
    for (const ring of [reg.outer, ...reg.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy || 1;
        let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2;
        t = Math.max(0, Math.min(1, t));
        d = Math.min(d, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)));
      }
    }
  }
  return 2 * d;
}

let ok = true;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) ok = false;
};

// --- Shape A: sparse triangular sprawl (like the user's screenshot 1) ---
{
  const params = { ...BASE, layout: "triangular", outlineStyle: "straight" };
  const cells = new Set(
    [[4,1],[5,1],[6,1],[7,1],[3,2],[4,2],[5,2],[6,2],[2,3],[3,3],[5,3],[6,3],[2,4],[3,4],[4,4]]
      .map(([c, r]) => key(c, r))
  );
  const regions = buildOutline(cells, params);
  const missed = coverageOk(cells, params, regions);
  check("A sprawl straight: all 15 cells covered", missed.length === 0, missed.length ? `missed ${missed.join(" ")}` : "");
}

// --- Shape B: two separated groups, all four style/join combos ---
{
  const groupCells = () => {
    const cells = new Set();
    for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) cells.add(key(c, r));
    for (let c = 7; c < 10; c++) for (let r = 0; r < 2; r++) cells.add(key(c, r));
    return cells;
  };
  for (const layout of ["square", "triangular"]) {
    for (const style of ["straight", "hug"]) {
      const cells = groupCells();
      // join OFF -> 2 regions, full coverage
      let params = { ...BASE, layout, outlineStyle: style, joinGroups: false };
      let regions = buildOutline(cells, params);
      let missed = coverageOk(cells, params, regions);
      check(`B ${layout}/${style} join=off: 2 separate regions`, regions.length === 2, `got ${regions.length}`);
      check(`B ${layout}/${style} join=off: coverage`, missed.length === 0);
      // join ON -> 1 region, full coverage
      params = { ...BASE, layout, outlineStyle: style, joinGroups: true };
      regions = buildOutline(cells, params);
      missed = coverageOk(cells, params, regions);
      check(`B ${layout}/${style} join=on: 1 joined region`, regions.length === 1, `got ${regions.length}`);
      check(`B ${layout}/${style} join=on: coverage`, missed.length === 0);
      if (style === "hug" && regions.length === 1) {
        // spar width at the bridge midpoint (between the closest cells)
        const a = cellCenter(2, 0, params), b = cellCenter(7, 0, params);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const w = widthAt(mid, regions);
        check(`B ${layout}/hug join=on: spar width >= ${params.bridgeWidth}`, w >= params.bridgeWidth - 0.4, `w=${w.toFixed(1)}mm`);
      }
    }
  }
}

// --- Shape C: single cell far from a big group (user's screenshot 2) ---
{
  const params = { ...BASE, layout: "triangular", outlineStyle: "hug", joinGroups: false };
  const cells = new Set();
  for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) cells.add(key(c, r));
  cells.add(key(7, 0)); // lone cell, close enough to formerly cause teardrops
  const regions = buildOutline(cells, params);
  const missed = coverageOk(cells, params, regions);
  check("C hug lone cell: 2 regions", regions.length === 2, `got ${regions.length}`);
  check("C hug lone cell: coverage", missed.length === 0);
  // the lone cell's region must be a clean circle: all boundary points ~R from centre
  const lone = cellCenter(7, 0, params);
  const R = params.holeD / 2 + params.wall;
  let devMax = 0;
  for (const reg of regions) {
    if (!pointInRing(lone, reg.outer)) continue;
    for (const p of reg.outer)
      devMax = Math.max(devMax, Math.abs(Math.hypot(p[0] - lone[0], p[1] - lone[1]) - R));
  }
  check("C lone cell region is a clean circle (no teardrop)", devMax < 0.1, `max radial dev ${devMax.toFixed(3)}mm`);
}

// --- Shape D: ONE-CELL GAPS must not connect (unless joined) ---
{
  // triangular: same column two rows apart (the sqrt(3) second ring) with the
  // row between EMPTY -> must be 2 bodies when join is off.
  let params = { ...BASE, layout: "triangular", outlineStyle: "straight", joinGroups: false };
  let cells = new Set([key(3, 2), key(3, 4)]);
  let regions = buildOutline(cells, params);
  check("D triangular gap (sqrt3) join=off: 2 bodies", regions.length === 2, `got ${regions.length}`);
  regions = buildOutline(cells, { ...params, joinGroups: true });
  check("D triangular gap join=on: 1 body", regions.length === 1, `got ${regions.length}`);

  // square: same row, one empty site between -> 2 bodies when join off.
  params = { ...BASE, layout: "square", outlineStyle: "straight", joinGroups: false };
  cells = new Set([key(2, 2), key(4, 2)]);
  regions = buildOutline(cells, params);
  check("D square gap join=off: 2 bodies", regions.length === 2, `got ${regions.length}`);

  // second-ring links WITHIN a group must still straighten staggered edges but
  // never span an empty gap: U of cells with an empty prong gap keeps its notch.
  params = { ...BASE, layout: "triangular", outlineStyle: "straight", joinGroups: false };
  cells = new Set([key(2, 2), key(2, 3), key(2, 4), key(3, 3)]); // L with (3,2)/(3,4) empty
  regions = buildOutline(cells, params);
  const missed = coverageOk(cells, params, regions);
  check("D L-group: 1 body, coverage", regions.length === 1 && missed.length === 0, `regions=${regions.length}`);
}

console.log(ok ? "\nISLANDS CHECK PASSED" : "\nISLANDS CHECK FAILED");
if (!ok) process.exit(1);
