// Thin wrappers around clipper-lib for integer-space 2D boolean + offset ops.
// All public functions take/return millimetre paths ([[x,y],...]); scaling to
// clipper's integer space happens internally.
import ClipperLib from "clipper-lib";

const C = ClipperLib;
export const SCALE = 1e4; // 0.1 micron resolution; max coord ~500mm -> 5e6, safe

export const toClipper = (pts) =>
  pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
export const fromClipper = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

export function circlePath(cx, cy, r, segs = 96) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (2 * Math.PI * i) / segs;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// Rectangle centred at (cx,cy), size w x h, rotated by `angle` radians.
export function rectPath(cx, cy, w, h, angle = 0) {
  const hw = w / 2,
    hh = h / 2;
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [cx + x * ca - y * sa, cy + x * sa + y * ca]);
}

// Union of a list of mm polygons -> list of mm polygons (flat, no nesting info).
export function union(mmPolys) {
  const c = new C.Clipper();
  c.AddPaths(mmPolys.map(toClipper), C.PolyType.ptSubject, true);
  const sol = [];
  c.Execute(
    C.ClipType.ctUnion,
    sol,
    C.PolyFillType.pftNonZero,
    C.PolyFillType.pftNonZero
  );
  return sol; // clipper integer paths
}

// Union returning a PolyTree so caller can recover outer/hole nesting.
export function unionTree(mmPolys) {
  const c = new C.Clipper();
  c.AddPaths(mmPolys.map(toClipper), C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(
    C.ClipType.ctUnion,
    tree,
    C.PolyFillType.pftNonZero,
    C.PolyFillType.pftNonZero
  );
  return tree;
}

// Offset clipper integer paths by `deltaMm` (mm). Positive = grow.
// miterLimit only matters for jtMiter: sharp corners whose miter would exceed
// limit*delta get squared off — raise it when offsetting acute polygon tips.
export function offset(intPaths, deltaMm, joinType = C.JoinType.jtRound, miterLimit = 2) {
  const co = new C.ClipperOffset(miterLimit, 0.02 * SCALE); // arcTolerance 0.02mm
  co.AddPaths(intPaths, joinType, C.EndType.etClosedPolygon);
  const sol = [];
  co.Execute(sol, deltaMm * SCALE);
  return sol;
}

// Drop truly collinear vertices: b is removed only when it deviates less than
// tolMm from the chord a-c AND the boundary direction barely turns at b. The
// angle condition is essential — around a finely-sampled small corner arc,
// EVERY vertex sits close to its local chord, and a distance-only test deletes
// the whole corner (collapsing the shape). Long straight edges still merge into
// single segments, which keeps them exactly straight through later round-join
// offsets (join wobble only appears at vertices).
export function removeCollinear(intPaths, tolMm = 0.002, maxTurnDeg = 3) {
  const tol = tolMm * SCALE;
  const cosMin = Math.cos((maxTurnDeg * Math.PI) / 180);
  return intPaths.map((path) => {
    const n = path.length;
    if (n < 4) return path;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = path[(i - 1 + n) % n];
      const b = path[i];
      const c = path[(i + 1) % n];
      const dx = c.X - a.X;
      const dy = c.Y - a.Y;
      const L = Math.hypot(dx, dy);
      if (L < 1) continue; // a and c coincide -> b is a spike/duplicate
      const dist = Math.abs((b.X - a.X) * dy - (b.Y - a.Y) * dx) / L;
      const u1x = b.X - a.X, u1y = b.Y - a.Y;
      const u2x = c.X - b.X, u2y = c.Y - b.Y;
      const l1 = Math.hypot(u1x, u1y) || 1;
      const l2 = Math.hypot(u2x, u2y) || 1;
      const cosTurn = (u1x * u2x + u1y * u2y) / (l1 * l2);
      if (dist <= tol && cosTurn >= cosMin) continue; // collinear -> drop b
      out.push(b);
    }
    return out.length >= 3 ? out : path;
  });
}

// Replace tight vertex clusters that sit BETWEEN two long edges with the exact
// intersection point of those edges — i.e. re-sharpen corners that a welding
// micro-closing turned into tiny arcs. Clusters NOT bounded by two long edges
// (disc rims, round caps) are kept untouched, and rings that are one big
// cluster (small circles) pass through unchanged.
export function sharpenCorners(intPaths, gapTolMm = 0.6, minEdgeMm = 2, maxDevMm = 1.5) {
  const gapTol = gapTolMm * SCALE;
  const minEdge = minEdgeMm * SCALE;
  const maxDev = maxDevMm * SCALE;
  return intPaths.map((path) => {
    const n = path.length;
    if (n < 4) return path;
    // rotate so index 0 starts right after a big gap (never splits a cluster)
    let start = -1;
    for (let i = 0; i < n; i++) {
      const p = path[(i - 1 + n) % n];
      if (Math.hypot(path[i].X - p.X, path[i].Y - p.Y) >= gapTol) {
        start = i;
        break;
      }
    }
    if (start < 0) return path; // whole ring is one cluster (tiny circle)
    const rot = [];
    for (let i = 0; i < n; i++) rot.push(path[(start + i) % n]);
    const out = [];
    let i = 0;
    while (i < n) {
      // find the maximal cluster starting at i
      let j = i;
      while (
        j + 1 < n &&
        Math.hypot(rot[j + 1].X - rot[j].X, rot[j + 1].Y - rot[j].Y) < gapTol
      )
        j++;
      if (j === i) {
        out.push(rot[i]);
        i++;
        continue;
      }
      // cluster rot[i..j]: bounded by A (before) and B (after)
      const A = rot[(i - 1 + n) % n];
      const B = rot[(j + 1) % n];
      const r1 = rot[i];
      const r2 = rot[j];
      const e1 = Math.hypot(r1.X - A.X, r1.Y - A.Y);
      const e2 = Math.hypot(B.X - r2.X, B.Y - r2.Y);
      let replaced = false;
      if (e1 >= minEdge && e2 >= minEdge) {
        // intersection of line(A->r1) and line(r2->B)
        const d1x = r1.X - A.X, d1y = r1.Y - A.Y;
        const d2x = B.X - r2.X, d2y = B.Y - r2.Y;
        const den = d1x * d2y - d1y * d2x;
        if (Math.abs(den) > 1e-9) {
          const t = ((r2.X - A.X) * d2y - (r2.Y - A.Y) * d2x) / den;
          const X = { X: Math.round(A.X + t * d1x), Y: Math.round(A.Y + t * d1y) };
          let cx = 0, cy = 0;
          for (let k = i; k <= j; k++) { cx += rot[k].X; cy += rot[k].Y; }
          cx /= j - i + 1; cy /= j - i + 1;
          if (Math.hypot(X.X - cx, X.Y - cy) <= maxDev) {
            out.push(X);
            replaced = true;
          }
        }
      }
      if (!replaced) for (let k = i; k <= j; k++) out.push(rot[k]); // keep (caps)
      i = j + 1;
    }
    return out.length >= 3 ? out : path;
  });
}

// Re-union integer paths into a PolyTree (used after offsets to recover nesting).
export function retree(intPaths) {
  const c = new C.Clipper();
  c.AddPaths(intPaths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(
    C.ClipType.ctUnion,
    tree,
    C.PolyFillType.pftNonZero,
    C.PolyFillType.pftNonZero
  );
  return tree;
}

// Walk a PolyTree into [{outer:[[x,y]...], holes:[[[x,y]...]]}] in mm.
export function treeToRegions(tree) {
  const regions = [];
  const walk = (node) => {
    for (const outer of node.Childs()) {
      regions.push({
        outer: fromClipper(outer.Contour()),
        holes: outer.Childs().map((h) => fromClipper(h.Contour())),
      });
      for (const hole of outer.Childs()) walk(hole); // islands inside holes
    }
  };
  walk(tree);
  return regions;
}

// Morphological rounding of all corners to radius rMm, preserving edge position:
// close (dilate,erode) then open (erode,dilate), round joins. Returns int paths.
// Falls back to the input if any stage collapses the shape.
export function roundCorners(intPaths, rMm) {
  if (rMm <= 0) return intPaths;
  const steps = [
    [+rMm, C.JoinType.jtRound], // dilate  (close)
    [-rMm, C.JoinType.jtRound], // erode
    [-rMm, C.JoinType.jtRound], // erode   (open)
    [+rMm, C.JoinType.jtRound], // dilate
  ];
  let cur = intPaths;
  for (const [d, jt] of steps) {
    const next = offset(cur, d, jt);
    if (!next || next.length === 0) return intPaths; // guard: don't vanish
    cur = next;
  }
  return cur;
}

export { C as ClipperLib };
