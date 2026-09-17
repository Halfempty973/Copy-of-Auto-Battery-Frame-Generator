# Auto Battery Frame Generator

A single-file, fully offline web app that generates **STEP** (and STL) files for
3D-printable battery cell frames — designed for **21700** cells in spot-welded
packs. Click cells onto a grid, set your dimensions, and export real CAD
geometry with true arcs.

## Use it

Open **`Battery Frame Generator.html`** in Chrome or Edge (double-click — no
install, no internet needed; the OpenCascade CAD kernel is embedded in the
file).

1. Click / drag on the circle grid to place cells (drag paints, drag on active
   cells erases).
2. Pick the arrangement (**square** or **triangular/staggered**) and outline
   style (**straight sides** or **hug every cell**).
3. Adjust parameters (all in mm):

   | Parameter | Default | Meaning |
   |---|---|---|
   | Cell pitch | 22.5 | centre-to-centre spacing (all neighbours in triangular mode) |
   | Cell hole ø | 21.4 | bore each cell drops into |
   | Wall height | 10 | open cell-wall depth above the base |
   | Retention base | 0.6 | bottom layer that stops cells pushing through (total height = base + wall) |
   | Base lip hole ø | 18 | clear through-hole in the base for terminal / tab access |
   | Outer wall | 2 | material beyond the outermost hole edge |
   | Corner radius | hole ø/2 + wall (auto) | outer corner fillet (straight-sides style); tracks hole/wall until edited manually |
   | Join separate groups | off | off: disconnected cell groups export as separate bodies; on: groups are bridged into one part |
   | Bridge min width | 10 | minimum width of hug-style bridge spars between joined groups |

4. **Update 3D preview** (orbit with the mouse; overall L×W×H dimensions are
   drawn on the model; **Auto-update preview** rebuilds on every change), then
   **Export STEP** or **Export STL**.

Each hole is a stepped bore: the cell rests on a flat retention lip with a
clear tab-access hole through the base, so terminals stay reachable for
spot-welding. Use **Mirror horizontally** to make the opposite-end frame of an
asymmetric pack.

### Interface

A liquid-glass UI: translucent panels floating over a soft animated background,
with a light/dark theme. Controls in the top corners:

- **Theme toggle** (header, top-right) — switch light / dark; remembered.
- **Fullscreen** (⤢, top-right of the cell-grid and 3D-preview panes) — expand
  either pane to the whole screen for easier editing / viewing; press again or
  `Esc` to exit. Double-click the 3D preview to re-fit the camera.

The look is self-contained: the Inter font is embedded in the HTML, so it works
identically offline on any machine.

## Rebuild from source

Requires Node.js (the repo was built with a portable Node in `tools/`,
which is not committed):

```
npm install
node node_modules/esbuild/install.js   # if npm blocked esbuild's postinstall
node build.mjs                          # -> dist/ + "Battery Frame Generator.html"
```

### Tests (Node, no browser)

CAD tests must be bundled first because the emscripten glue can't be imported
directly by Node's ESM loader:

```
node build-test.mjs test/face-census.mjs && node test/out/face-census.cjs
node build-test.mjs test/lip-verify.mjs  && node test/out/lip-verify.cjs
node build-test.mjs test/hole-probe.mjs  && node test/out/hole-probe.cjs
node test/outline-smoke.mjs             # pure JS, runs directly
node test/arcfit-check.mjs
```

## Architecture

- **UI**: vanilla JS + SVG click-grid ([src/gridView.js](src/gridView.js)),
  three.js preview with dimension overlays ([src/viewer.js](src/viewer.js)).
- **2D outline**: [clipper-lib](https://www.npmjs.com/package/clipper-lib)
  integer booleans; miter-join offsets keep straight edges exactly straight,
  corners are filleted explicitly ([src/outline.js](src/outline.js)).
- **Arc fitting**: outline polylines are converted back to true line/arc
  segments so the STEP contains real curves — ~10–20× smaller files
  ([src/arcFit.js](src/arcFit.js)).
- **Solid modelling**: [replicad](https://replicad.xyz)
  (OpenCascade → WebAssembly). One outline extrusion, then two sequential
  compound cuts for the stepped holes ([src/cad.js](src/cad.js)). The tools of
  a single boolean cut are kept mutually disjoint — OCC booleans leave
  membrane faces if a compound tool self-intersects.
- **Packaging**: esbuild bundles everything (wasm inlined as base64) into one
  IIFE injected into [src/template.html](src/template.html) — works from
  `file://` with zero network requests ([build.mjs](build.mjs)).
