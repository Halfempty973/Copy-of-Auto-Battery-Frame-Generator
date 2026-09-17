// Convert a closed polygon ring (from clipper) into a sequence of line and
// circular-arc segments, so the CAD outline uses true curves instead of many
// short line segments. This makes rounded corners and hug-circle boundaries
// exact and shrinks the STEP file.
//
// fitSegments(ring) -> [{type:"line", end:[x,y]} | {type:"arc", mid:[x,y], end:[x,y]}]
// The path is understood to start at ring[0]; the last segment ends back at
// ring[0].

const TOL = 0.015; // max deviation (mm) of polygon points from the fitted primitive
const MAX_ARC_RAD = (100 * Math.PI) / 180; // cap arc sweep -> full circles split into >=4 arcs

function circleFrom3(a, b, c) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { cx: ux, cy: uy, r: Math.hypot(ax - ux, ay - uy) };
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function fitsLine(P, i, j, tol) {
  for (let k = i + 1; k < j; k++) if (distToSeg(P[k], P[i], P[j]) > tol) return false;
  return true;
}

// Returns the fitted circle if P[i..j] lie on one arc within tol and the sweep
// is under the cap; else null.
function fitsArc(P, i, j, tol) {
  if (j - i < 2) return null;
  const mid = (i + j) >> 1;
  const circ = circleFrom3(P[i], P[mid], P[j]);
  // Reject non-circles and implausibly large radii: real features (fillets,
  // cell/lip circles, hug walls) are small; a huge-radius "arc" is a nearly
  // straight run that should stay a line.
  if (!circ || circ.r > 80 || circ.r < 1e-3) return null;
  for (let k = i; k <= j; k++) {
    const dr = Math.abs(Math.hypot(P[k][0] - circ.cx, P[k][1] - circ.cy) - circ.r);
    if (dr > tol) return null;
  }
  // monotonic sweep within cap
  const ang = (p) => Math.atan2(p[1] - circ.cy, p[0] - circ.cx);
  let sweep = 0;
  let prev = ang(P[i]);
  let sign = 0;
  for (let k = i + 1; k <= j; k++) {
    let dth = ang(P[k]) - prev;
    while (dth > Math.PI) dth -= 2 * Math.PI;
    while (dth < -Math.PI) dth += 2 * Math.PI;
    if (dth !== 0) {
      const s = Math.sign(dth);
      if (sign === 0) sign = s;
      else if (s !== sign) return null; // direction reversed -> not a clean arc
    }
    sweep += dth;
    prev = ang(P[k]);
  }
  if (Math.abs(sweep) > MAX_ARC_RAD) return null;
  return circ;
}

export function fitSegments(ring, tol = TOL) {
  const n = ring.length;
  if (n < 3) {
    return ring.slice(1).map((p) => ({ type: "line", end: p }));
  }
  const P = ring.concat([ring[0]]); // closed
  const N = P.length;
  const segs = [];
  let i = 0;
  let guard = 0;
  while (i < N - 1 && guard++ < N * 2) {
    // Longest line run.
    let jLine = i + 1;
    while (jLine + 1 < N && fitsLine(P, i, jLine + 1, tol)) jLine++;
    // Longest arc run.
    let jArc = i + 1;
    while (jArc + 1 < N && fitsArc(P, i, jArc + 1, tol)) jArc++;

    // Prefer a line unless the arc covers strictly more points AND spans enough
    // of them to be a genuine curve. Any 3 points fit a circle, so a short arc
    // (e.g. a straight edge + one corner point) would bulge outward — require
    // >=4 points before trusting an arc.
    const useArc = jArc > jLine && jArc - i >= 3;
    if (useArc) {
      segs.push({ type: "arc", mid: P[(i + jArc) >> 1], end: P[jArc] });
      i = jArc;
    } else {
      segs.push({ type: "line", end: P[jLine] });
      i = jLine;
    }
  }
  return segs;
}
