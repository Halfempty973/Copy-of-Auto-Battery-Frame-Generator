// Build the 2D frame outline (in mm) from the active cell selection using
// clipper-lib. Returns [{outer:[[x,y],...], holes:[[[x,y],...],...]}, ...].
//
// Two styles:
//   straight — straight lines at ANY angle wherever cells line up: a polygon
//              is traced through the boundary cell centres (diagonal runs
//              merge into single angled lines), offset outward by holeR+wall
//              with exact miter joins, then every corner is rounded with one
//              uniform ball radius.
//   hug      — rolling-ball outline: a circle of radius holeR+wall rolled
//              around the pack, so cell wraps and every concave junction share
//              ONE uniform radius.
import { activeCenters, cellCenter, parseKey, key } from "./gridModel.js";
import {
  circlePath,
  rectPath,
  union,
  offset,
  retree,
  treeToRegions,
  removeCollinear,
  sharpenCorners,
  ClipperLib,
} from "./clipperUtils.js";

const MITER = ClipperLib.JoinType.jtMiter;
const HULL_W = 0.2; // width of the thin centre-to-centre hull connectors (mm)

// Morphological corner rounding with ONE ball radius rc, so every arc on the
// border — convex and concave alike — has exactly the same radius. Steps and
// notches too small for the ball are absorbed into smooth waves instead of
// getting mismatched pinched fillets. Straight edges longer than the ball stay
// exactly straight (inputs are collinear-cleaned, so round-join wobble cannot
// appear mid-edge).
//   closing (dilate +rc, erode -rc): concave corners -> radius rc
//   opening (erode -rc, dilate +rc): convex corners  -> radius rc
// The opening's erosion can annihilate features whose half-width <= rc (e.g. a
// single-cell frame): retry with a smaller ball, so the result is never empty.
function roundUniform(intPaths, rc) {
  if (rc <= 0) return intPaths;
  let cur = intPaths;
  // closing: dilate with MITER so convex corners pass through EXACTLY (a round
  // dilation would polygonize them into arcs the erosion then has to collapse,
  // leaving sub-0.05mm vertex fuzz at every corner); erode with ROUND so the
  // concave corners come out as clean rc arcs.
  cur = offset(offset(cur, +rc, MITER, 8), -rc);
  if (!cur.length) return intPaths;
  // opening, guarded. Start a hair under rc: features that fit the ball
  // EXACTLY (e.g. a single row is exactly 2*rc wide) would otherwise erode to
  // zero width and force a much smaller fallback radius.
  let r = Math.max(rc - 0.02, rc * 0.9);
  for (let i = 0; i < 8; i++) {
    const eroded = offset(cur, -r);
    if (eroded.length) {
      const opened = offset(eroded, +r);
      if (opened.length) return opened;
    }
    r *= 0.85; // feature too small for this ball — try a smaller one
    if (r < 0.5) break;
  }
  return cur; // opening impossible; keep the closed (concave-rounded) outline
}

export function buildOutline(cells, params) {
  if (!cells.size) return [];
  const holeR = params.holeD / 2;
  const islands = splitIslands(cells, params);
  const style = params.outlineStyle === "hug" ? hugOutline : straightOutline;

  let intPaths = [];
  if (params.joinGroups && islands.length > 1) {
    // One connected body: bridge the islands (minimum-spanning set of
    // closest-cell-pair connectors), built in the active style.
    const bridges = bridgeSegments(islands, params);
    intPaths = style(cells, params, holeR, bridges);
  } else {
    // Each island is outlined INDEPENDENTLY so groups can never interfere
    // (no cross-island merging, spikes or teardrops) — the export simply
    // contains several separate bodies.
    for (const isl of islands) intPaths.push(...style(isl, params, holeR, []));
  }
  return treeToRegions(retree(intPaths));
}

// TIGHT adjacency — genuinely touching lattice neighbours only (pitch ring,
// plus corner-touching sqrt(2) diagonals on square grids). This decides
// CONNECTIVITY: cells with an empty site between them are separate groups
// unless "join separate groups" is on. (The hull's longer-range links are used
// only for boundary shaping WITHIN an already-connected group.)
function tightNeighbors(col, row, params) {
  const maxDist = params.pitch * (params.layout === "square" ? 1.5 : 1.1);
  const p0 = cellCenter(col, row, params);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const p1 = cellCenter(col + dc, row + dr, params);
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) <= maxDist)
        out.push([col + dc, row + dr]);
    }
  }
  return out;
}

// Connected components of the selection under TIGHT adjacency.
function splitIslands(cells, params) {
  const seen = new Set();
  const islands = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const isl = new Set();
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const k = queue.pop();
      isl.add(k);
      const [c, r] = parseKey(k);
      for (const [nc, nr] of tightNeighbors(c, r, params)) {
        const nk = key(nc, nr);
        if (cells.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          queue.push(nk);
        }
      }
    }
    islands.push(isl);
  }
  return islands;
}

// Minimum-spanning bridges between islands (Prim): each bridge connects the
// closest pair of cell centres between two islands.
function bridgeSegments(islands, params) {
  const centerSets = islands.map((isl) => activeCenters(isl, params));
  const n = centerSets.length;
  const inTree = new Set([0]);
  const bridges = [];
  while (inTree.size < n) {
    let best = null;
    for (const i of inTree) {
      for (let j = 0; j < n; j++) {
        if (inTree.has(j)) continue;
        for (const a of centerSets[i]) {
          for (const b of centerSets[j]) {
            const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (!best || d < best.d) best = { d, a, b, j };
          }
        }
      }
    }
    bridges.push([best.a, best.b]);
    inTree.add(best.j);
  }
  return bridges;
}

// Lattice neighbours used for hull tracing, by centre distance:
//   square:     pitch (orthogonal) + sqrt(2)*pitch (diagonal) -> diagonal cell
//               runs become single straight angled lines.
//   triangular: pitch (6-ring) + sqrt(3)*pitch (second ring) -> a staggered
//               column edge bridges into ONE straight line instead of a
//               half-pitch zigzag smaller than the corner ball.
function hullNeighbors(col, row, params) {
  const maxDist = params.pitch * (params.layout === "square" ? 1.5 : 1.8);
  const p0 = cellCenter(col, row, params);
  const out = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (!dc && !dr) continue;
      const p1 = cellCenter(col + dc, row + dr, params);
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) <= maxDist)
        out.push([col + dc, row + dr]);
    }
  }
  return out;
}

// Ensure CCW winding so NonZero unions never self-cancel.
function ccw(tri) {
  const [a, b, c] = tri;
  const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return area2 >= 0 ? tri : [a, c, b];
}

// Straight-edged polygon through the cell centres: thin centre-to-centre
// connectors between adjacent cells + fill triangles for mutually-adjacent
// triples (tiny squares only for isolated cells). Collinear boundary chains —
// horizontal, vertical OR diagonal — merge into single straight lines.
function centerHullPolys(cells, params) {
  const tightMax = params.pitch * (params.layout === "square" ? 1.5 : 1.1);

  // Are two cells genuinely touching?
  const touching = (pa, pb) => Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) <= tightMax;

  // A hull link is valid if the cells touch, OR (second-ring link, used to
  // straighten staggered edges) if some ACTIVE cell touches both — a
  // second-ring link must never span an empty one-cell gap.
  const linkOk = (c1, r1, c2, r2) => {
    const pa = cellCenter(c1, r1, params);
    const pb = cellCenter(c2, r2, params);
    if (touching(pa, pb)) return true;
    for (const [tc, tr] of tightNeighbors(c1, r1, params)) {
      if (!cells.has(key(tc, tr))) continue;
      if (touching(cellCenter(tc, tr, params), pb)) return true;
    }
    return false;
  };

  const polys = [];
  const seenTri = new Set();
  for (const k of cells) {
    const [c, r] = parseKey(k);
    const p0 = cellCenter(c, r, params);
    // A tiny disc at every centre: line end-caps and isolated cells offset to
    // exact round caps/circles of radius R instead of mitered flat-cap corners.
    polys.push(circlePath(p0[0], p0[1], HULL_W / 2, 24));
    const adj = [];
    for (const [nc, nr] of hullNeighbors(c, r, params)) {
      const nk = key(nc, nr);
      if (!cells.has(nk)) continue;
      if (!linkOk(c, r, nc, nr)) continue;
      const p1 = cellCenter(nc, nr, params);
      adj.push({ nc, nr, nk, p1 });
      if (k < nk) {
        const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        polys.push(rectPath((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, len, HULL_W, ang));
      }
    }
    if (!adj.length) continue; // disc already covers an isolated cell
    // Fill triangles between mutually-adjacent neighbour pairs.
    for (let i = 0; i < adj.length; i++) {
      for (let j = i + 1; j < adj.length; j++) {
        const a = adj[i], b = adj[j];
        const mutual =
          hullNeighbors(a.nc, a.nr, params).some(
            ([mc, mr]) => mc === b.nc && mr === b.nr
          ) && linkOk(a.nc, a.nr, b.nc, b.nr);
        if (!mutual) continue;
        const tk = [k, a.nk, b.nk].sort().join("|");
        if (seenTri.has(tk)) continue;
        seenTri.add(tk);
        polys.push(ccw([p0, a.p1, b.p1]));
      }
    }
  }
  return polys;
}

function straightOutline(cells, params, holeR, bridges) {
  const R = holeR + params.wall;
  const polys = centerHullPolys(cells, params);
  // Bridges between joined islands go through the same hull machinery, so a
  // bridge becomes a straight arm of the full frame width (2R).
  for (const [a, b] of bridges) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    polys.push(rectPath((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len, HULL_W, ang));
  }
  let hull = union(polys);
  // Where thin connectors meet at different angles the union boundary has
  // micro-slivers and notches (~0.1-0.3mm) that a big miter offset would
  // amplify into spikes and squared-off staircase artifacts. Weld them with a
  // micro-closing (grow+shrink 0.3mm), then scrub the residual near-collinear
  // vertices so the big offset sees only clean macro edges.
  hull = offset(offset(hull, +0.3), -0.3);
  // Re-sharpen the corners the weld turned into tiny arcs (round caps and disc
  // rims are preserved), then merge collinear runs into single segments.
  hull = sharpenCorners(hull);
  hull = removeCollinear(hull, 0.08);
  // Offset the centre hull outward so every boundary cell keeps `wall` beyond
  // its hole (connector half-width compensated). MITER keeps straight runs —
  // at any angle — exactly straight; limit 3 covers 60-degree staircase tips
  // while bounding any residual spike. Then round every corner with ONE
  // uniform ball radius.
  const off = removeCollinear(offset(hull, R - HULL_W / 2, MITER, 3));
  const rounded = roundUniform(off, params.cornerRadius);
  // COVERAGE GUARANTEE: the opening's erosion can numerically drop thin stub
  // arms (a whole cell vanishing from the outline). The round-join offset of
  // the hull is the exact minimal frame that always covers every cell, and is
  // mathematically a subset of the intended rounded outline — union it back in
  // so any numerically-lost patch is restored, without changing corners.
  const safety = offset(hull, R - HULL_W / 2);
  return [...rounded, ...safety];
}

function hugOutline(cells, params, holeR, bridges) {
  // Rolling-ball outline: the border is exactly what a circle of radius
  // R = holeR + wall traces when rolled around the outside of the pack, so the
  // wrap around each cell AND every concave fillet between cells share the
  // same uniform radius R.
  //
  // Construction (morphological closing of the cell set): dilate the cell
  // centres by 2R (union of 2R discs), then erode by R. Adjacent and diagonal
  // cell groups merge with smooth R-radius junctions; voids too small for the
  // rolling circle close up.
  const R = holeR + params.wall;
  const centers = activeCenters(cells, params);
  const polys = centers.map(([x, y]) => circlePath(x, y, 2 * R, 144));
  // Bridges between joined islands: spars of at least `bridgeWidth`. The spar
  // is laid into the dilated shape 2R wider so the R-erosion leaves exactly
  // the requested width, with smooth R fillets where it meets each island.
  const sparW = Math.max(params.bridgeWidth || 10, 1) + 2 * R;
  for (const [a, b] of bridges) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    polys.push(rectPath((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len, sparW, ang));
  }
  const dilated = union(polys);
  return offset(dilated, -R); // erode -> uniform-radius border
}
