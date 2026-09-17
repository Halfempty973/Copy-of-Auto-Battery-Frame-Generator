// Build the 3D battery-frame solid from the cell selection + parameters.
//
// Construction (compound tools, no incremental boolean fusing — fast + robust):
//   1. Extrude the outline (from clipper) to full height  -> a solid block.
//   2. Cut ONE compound tool of stepped holes per cell:
//        - a lip-ø cylinder cut clear THROUGH the base   (tab-access opening)
//        - a cell-ø cylinder from the top of the base upward
//      Their union leaves a flat retention lip (the base annulus) that the cell
//      rests on, with a clear hole through it to reach the battery tab.
import { draw, drawCircle, makeCylinder, makeCompound } from "replicad";
import { buildOutline } from "./outline.js";
import { activeCenters } from "./gridModel.js";
import { fitSegments } from "./arcFit.js";

const EPS = 0.01;

// Build a ring as plain line segments (robust fallback).
function drawRingLines(ring) {
  let pen = draw([ring[0][0], ring[0][1]]);
  for (let i = 1; i < ring.length; i++) pen = pen.lineTo([ring[i][0], ring[i][1]]);
  return pen.close();
}

// Build a ring using true line + arc segments (smaller/exact STEP).
function drawRingArcs(ring) {
  const segs = fitSegments(ring);
  let pen = draw([ring[0][0], ring[0][1]]);
  const start = ring[0];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = i === segs.length - 1;
    // The final segment lands back on the start point; let close() draw it.
    const landsOnStart =
      Math.hypot(s.end[0] - start[0], s.end[1] - start[1]) < 1e-6;
    if (s.type === "arc") {
      pen = pen.threePointsArcTo([s.end[0], s.end[1]], [s.mid[0], s.mid[1]]);
    } else if (!(last && landsOnStart)) {
      pen = pen.lineTo([s.end[0], s.end[1]]);
    }
  }
  return pen.close();
}

function outlineDrawing(regions, useArcs) {
  const ringFn = useArcs ? drawRingArcs : drawRingLines;
  let d = null;
  for (const reg of regions) {
    let region = ringFn(reg.outer);
    for (const hole of reg.holes) region = region.cut(ringFn(hole));
    d = d ? d.fuse(region) : region;
  }
  return d;
}

export function derived(params) {
  return {
    holeR: params.holeD / 2,
    lipR: params.lipD / 2,
    baseTh: params.baseThickness,
    totalH: params.baseThickness + params.wallHeight,
    lipWidth: (params.holeD - params.lipD) / 2, // radial width of the retention shelf
  };
}

export function buildModel(cells, params, opts = {}) {
  const now =
    typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  const mark = (label, t0) => {
    if (opts.profile) opts.profile(label, Math.round(now() - t0));
  };

  const centers = activeCenters(cells, params);
  if (!centers.length) throw new Error("No cells selected.");
  const { holeR, lipR, baseTh, totalH } = derived(params);

  let t = now();
  const regions = buildOutline(cells, params);
  if (!regions.length) throw new Error("Could not build a frame outline.");
  mark("outline", t);

  // 1: solid block, single extrude. Build the outline with true arcs (exact,
  // small STEP); fall back to a polyline outline if the arc wire fails.
  t = now();
  let block;
  let usedArcs = true;
  try {
    block = outlineDrawing(regions, true).sketchOnPlane("XY").extrude(totalH);
  } catch (e) {
    console.warn("Arc outline failed, using polyline:", e && e.message);
    usedArcs = false;
    block = outlineDrawing(regions, false).sketchOnPlane("XY").extrude(totalH);
  }
  mark("extrude-block", t);

  // 2: stepped holes via TWO sequential cuts.
  //
  // IMPORTANT: the tools of a single boolean cut must not interfere with each
  // other — OCC booleans are undefined for self-overlapping compound tools and
  // leave internal membrane faces at the overlap (this exact bug once left a
  // thin disc closing off the tab hole above the lip). So the lip cylinders and
  // cell-bore cylinders are cut in two separate passes; the cylinders within
  // each pass are disjoint (cells are a full pitch apart).
  //
  //   Cut A: cell bores, ø holeD, from exactly z=baseTh to above the top. Their
  //          bottom faces sit strictly inside solid material -> transversal.
  //   Cut B: lip holes, ø lipD, from below the part up INTO the void cut by A
  //          (top face floats in the open bore -> no coincident faces).
  //
  // Result: a clear lipD through-hole in the base for the terminal, and a flat
  // retention shelf (annulus lipR..holeR) at exactly z=baseTh.
  t = now();
  const overshoot = Math.max(0.5, Math.min(1, params.wallHeight / 2));
  const cellTools = centers.map(([x, y]) =>
    makeCylinder(holeR, totalH - baseTh + EPS, [x, y, baseTh])
  );
  const lipTools = centers.map(([x, y]) =>
    makeCylinder(lipR, EPS + baseTh + overshoot, [x, y, -EPS])
  );
  let solid = block.cut(makeCompound(cellTools));
  solid = solid.cut(makeCompound(lipTools));
  mark("cut-holes", t);

  solid.__meta = { cellCount: centers.length, totalH, usedArcs };
  return solid;
}
