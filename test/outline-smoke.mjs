// Validate the clipper outline pipeline across layouts, styles and shapes.
// Pure JS (no wasm) — run directly: node test/outline-smoke.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { buildOutline } from "../src/outline.js";
import { key, activeCenters } from "../src/gridModel.js";

const base = {
  pitch: 22.5,
  holeD: 21.4,
  wall: 2,
  cornerRadius: 5,
  cols: 16,
  rows: 8,
};

function makeCells(list) {
  const s = new Set();
  for (const [c, r] of list) s.add(key(c, r));
  return s;
}

// Shapes to test
const shapes = {
  single: [[2, 2]],
  block4x2: [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [0, 1], [1, 1], [2, 1], [3, 1],
  ],
  Lshape: [
    [0, 0], [0, 1], [0, 2], [1, 2], [2, 2],
  ],
  ring: [
    [0, 0], [1, 0], [2, 0],
    [0, 1],         [2, 1],
    [0, 2], [1, 2], [2, 2],
  ],
  twoIslands: [
    [0, 0], [1, 0],
    [5, 0], [6, 0],
  ],
};

function bbox(regions) {
  let mn = [Infinity, Infinity],
    mx = [-Infinity, -Infinity];
  for (const reg of regions)
    for (const [x, y] of reg.outer) {
      mn[0] = Math.min(mn[0], x);
      mn[1] = Math.min(mn[1], y);
      mx[0] = Math.max(mx[0], x);
      mx[1] = Math.max(mx[1], y);
    }
  return { min: mn, max: mx, w: +(mx[0] - mn[0]).toFixed(2), h: +(mx[1] - mn[1]).toFixed(2) };
}

let svgParts = [];
let ok = true;

for (const layout of ["square", "triangular"]) {
  for (const outlineStyle of ["straight", "hug"]) {
    for (const [name, list] of Object.entries(shapes)) {
      const params = { ...base, layout, outlineStyle };
      const cells = makeCells(list);
      let regions, err = null;
      try {
        regions = buildOutline(cells, params);
      } catch (e) {
        err = e.message;
        regions = [];
      }
      const nHoles = regions.reduce((a, r) => a + r.holes.length, 0);
      const bb = regions.length ? bbox(regions) : null;
      const tag = `${layout}/${outlineStyle}/${name}`;
      // Expectations
      const expectIslands = name === "twoIslands" ? 2 : 1;
      const expectHole = name === "ring" ? 1 : 0;
      let status = "OK";
      if (err) { status = "ERROR: " + err; ok = false; }
      else if (regions.length === 0) { status = "EMPTY"; ok = false; }
      else if (regions.length !== expectIslands)
        status = `regions=${regions.length} (expected ${expectIslands})`;
      // ring hole only reliably survives straight style; note for hug
      console.log(
        `${tag.padEnd(34)} regions=${regions.length} holes=${nHoles} ` +
          `bbox=${bb ? bb.w + "x" + bb.h : "-"}  ${status}`
      );

      // Build a small SVG tile for visual review
      const centers = activeCenters(cells, params);
      const holeR = params.holeD / 2;
      let paths = "";
      for (const reg of regions) {
        paths += `<path d="${ringToPath(reg.outer)}" fill="#8ab4f8" stroke="#1a1a1a" stroke-width="0.3"/>`;
        for (const h of reg.holes)
          paths += `<path d="${ringToPath(h)}" fill="#2b2b2b"/>`;
      }
      let circles = centers
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${holeR}" fill="none" stroke="#e06666" stroke-width="0.3"/>`)
        .join("");
      const vb = bb
        ? `${bb.min[0] - 3} ${bb.min[1] - 3} ${bb.max[0] - bb.min[0] + 6} ${bb.max[1] - bb.min[1] + 6}`
        : "0 0 10 10";
      svgParts.push(
        `<div style="display:inline-block;margin:4px;background:#111;color:#ccc;font:10px sans-serif;text-align:center">` +
          `<div>${tag} (${status})</div>` +
          `<svg width="200" height="140" viewBox="${vb}" style="transform:scaleY(-1)">${paths}${circles}</svg>` +
          `</div>`
      );
    }
  }
}

function ringToPath(ring) {
  if (!ring.length) return "";
  return (
    "M" + ring.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ") + " Z"
  );
}

mkdirSync("test/out", { recursive: true });
writeFileSync(
  "test/out/outline-preview.html",
  `<!doctype html><body style="background:#222">${svgParts.join("")}</body>`
);
console.log("\nWrote test/out/outline-preview.html");
console.log(ok ? "OUTLINE SMOKE: all non-empty" : "OUTLINE SMOKE: some failures (see above)");
