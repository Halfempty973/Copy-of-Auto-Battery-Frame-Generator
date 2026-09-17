// Check that fitSegments() reconstructs the polygon faithfully: sample the
// fitted line/arc segments back into points and compare to the source ring.
// Pure JS — run directly.
import { buildOutline } from "../src/outline.js";
import { fitSegments } from "../src/arcFit.js";
import { key } from "../src/gridModel.js";

const base = { pitch: 22.5, holeD: 21.4, wall: 2, cornerRadius: 5, cols: 8, rows: 8 };

function cells(list) {
  const s = new Set();
  for (const [c, r] of list) s.add(key(c, r));
  return s;
}

function circleFrom3(a, b, c) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax*ax+ay*ay, b2 = bx*bx+by*by, c2 = cx*cx+cy*cy;
  const ux = (a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/d;
  const uy = (a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/d;
  return { cx: ux, cy: uy, r: Math.hypot(ax-ux, ay-uy) };
}

function sampleArc(start, mid, end) {
  const c = circleFrom3(start, mid, end);
  if (!c) return [start, end];
  const ang = (p) => Math.atan2(p[1]-c.cy, p[0]-c.cx);
  let a0 = ang(start), am = ang(mid), a1 = ang(end);
  const norm = (x) => { while (x> Math.PI) x-=2*Math.PI; while (x<=-Math.PI) x+=2*Math.PI; return x; };
  // go start->mid->end direction
  let d1 = norm(am - a0); const dir = Math.sign(d1) || 1;
  let total = norm(a1 - a0); if (Math.sign(total) !== dir) total += dir*2*Math.PI;
  const pts = [];
  const steps = 24;
  for (let i=0;i<=steps;i++){ const a=a0+total*i/steps; pts.push([c.cx+c.r*Math.cos(a), c.cy+c.r*Math.sin(a)]); }
  return pts;
}

function bbox(pts){ let mn=[1e9,1e9],mx=[-1e9,-1e9]; for(const[x,y]of pts){mn[0]=Math.min(mn[0],x);mn[1]=Math.min(mn[1],y);mx[0]=Math.max(mx[0],x);mx[1]=Math.max(mx[1],y);} return {mn,mx,w:+(mx[0]-mn[0]).toFixed(3),h:+(mx[1]-mn[1]).toFixed(3)};}

const shapes = {
  single: [[2,2]],
  row4: [[0,0],[1,0],[2,0],[3,0]],
  block4x2: [[0,0],[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[3,1]],
};

let worst = 0;
for (const style of ["straight","hug"]) {
  for (const [name,list] of Object.entries(shapes)) {
    const params = { ...base, layout:"square", outlineStyle:style };
    const regions = buildOutline(cells(list), params);
    const ring = regions[0].outer;
    const segs = fitSegments(ring);
    // reconstruct
    const recon = [ring[0]];
    let cur = ring[0];
    for (const s of segs) {
      if (s.type === "arc") { const sp = sampleArc(cur, s.mid, s.end); recon.push(...sp.slice(1)); }
      else recon.push(s.end);
      cur = s.end;
    }
    const bOrig = bbox(ring), bRec = bbox(recon);
    const nArc = segs.filter(s=>s.type==="arc").length;
    const nLine = segs.filter(s=>s.type==="line").length;
    const dW = Math.abs(bOrig.w-bRec.w), dH = Math.abs(bOrig.h-bRec.h);
    worst = Math.max(worst, dW, dH);
    console.log(`${style}/${name}: ring=${ring.length}pts -> ${segs.length}segs (${nArc} arc, ${nLine} line)  origBBox=${bOrig.w}x${bOrig.h} reconBBox=${bRec.w}x${bRec.h}  dW=${dW.toFixed(3)} dH=${dH.toFixed(3)}`);
  }
}
console.log(`\nworst bbox delta = ${worst.toFixed(3)} mm ${worst < 0.1 ? "OK" : "FAIL — arc fit distorts shape"}`);
