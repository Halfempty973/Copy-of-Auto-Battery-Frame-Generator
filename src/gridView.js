// Interactive SVG cell grid: ghost circles the user clicks/drag-paints to place
// cells, with the computed 2D frame outline drawn live underneath.
// Model Y is up; SVG Y is down, so every Y is negated on the way out.
import { allSites, key } from "./gridModel.js";
import { buildOutline } from "./outline.js";

const SVGNS = "http://www.w3.org/2000/svg";

export function createGridView(svg, state, onChange) {
  let paintMode = null; // "add" | "erase"
  let painting = false;

  function ringsToPath(rings) {
    return rings
      .map(
        (r) =>
          "M" +
          r.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join(" L ") +
          " Z"
      )
      .join(" ");
  }

  function render() {
    const { params, cells } = state;
    const holeR = params.holeD / 2;
    const sites = allSites(params);

    let mn = [Infinity, Infinity];
    let mx = [-Infinity, -Infinity];
    for (const s of sites) {
      mn[0] = Math.min(mn[0], s.center[0]);
      mn[1] = Math.min(mn[1], s.center[1]);
      mx[0] = Math.max(mx[0], s.center[0]);
      mx[1] = Math.max(mx[1], s.center[1]);
    }
    const pad = holeR + params.wall + params.cornerRadius + 5;
    const x0 = mn[0] - pad;
    const x1 = mx[0] + pad;
    const y0 = -(mx[1] + pad);
    const y1 = -(mn[1] - pad);
    svg.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);

    const frag = document.createDocumentFragment();

    // Compute outline path data once (may transiently fail for odd selections).
    let outlineD = [];
    if (cells.size) {
      try {
        outlineD = buildOutline(cells, params).map((reg) =>
          ringsToPath([reg.outer, ...reg.holes])
        );
      } catch {
        outlineD = [];
      }
    }

    // 1) Outline FILL behind the circles (translucent).
    for (const d of outlineD) {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d);
      p.setAttribute("class", "outline-fill");
      p.setAttribute("fill-rule", "evenodd");
      p.setAttribute("pointer-events", "none");
      frag.appendChild(p);
    }

    // 2) Ghost/active site circles.
    for (const s of sites) {
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("cx", s.center[0].toFixed(3));
      c.setAttribute("cy", (-s.center[1]).toFixed(3));
      c.setAttribute("r", holeR.toFixed(3));
      const active = cells.has(key(s.col, s.row));
      c.setAttribute("class", "site " + (active ? "active" : "inactive"));
      c.dataset.col = s.col;
      c.dataset.row = s.row;
      frag.appendChild(c);
    }

    // 3) Outline STROKE on TOP of the circles so the boundary is always visible.
    for (const d of outlineD) {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d);
      p.setAttribute("class", "outline-stroke");
      p.setAttribute("pointer-events", "none");
      frag.appendChild(p);
    }

    svg.replaceChildren(frag);
  }

  const siteAt = (t) =>
    t && t.classList && t.classList.contains("site") ? t : null;

  function paint(el) {
    const k = key(+el.dataset.col, +el.dataset.row);
    const has = state.cells.has(k);
    if (paintMode === "add" && !has) state.cells.add(k);
    else if (paintMode === "erase" && has) state.cells.delete(k);
    else return; // no change -> skip re-render (smooth dragging)
    render();
    onChange();
  }

  svg.addEventListener("pointerdown", (e) => {
    const el = siteAt(e.target);
    if (!el) return;
    const k = key(+el.dataset.col, +el.dataset.row);
    paintMode = state.cells.has(k) ? "erase" : "add";
    painting = true;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
    paint(el);
    e.preventDefault();
  });

  svg.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const el = siteAt(document.elementFromPoint(e.clientX, e.clientY));
    if (el) paint(el);
  });

  const stop = (e) => {
    painting = false;
    paintMode = null;
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {}
  };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
  svg.addEventListener("pointerleave", () => {
    // keep capture-based painting working; only stop if capture lost
  });

  return { render };
}
