// Application state: parameters + active cell selection, with localStorage
// persistence. No DOM/CAD dependencies.
import { key, parseKey } from "./gridModel.js";

export const DEFAULTS = {
  pitch: 22.5, // centre-to-centre spacing (mm)
  holeD: 21.4, // cell hole diameter (mm)
  lipD: 18, // retention-lip hole diameter in the base (mm)
  wallHeight: 10, // open cell-wall depth above the base (mm)
  baseThickness: 0.6, // retention base layer (mm) — total height = base + wall
  wall: 2, // material beyond the outermost hole edge (mm)
  cornerRadius: 12.7, // outer corner rounding for straight style (mm) = holeD/2 + wall
  cornerRadiusManual: false, // false -> cornerRadius tracks holeD/2 + wall
  cols: 16,
  rows: 8,
  layout: "square", // "square" | "triangular"
  outlineStyle: "straight", // "straight" | "hug"
  joinGroups: false, // bridge separate cell groups into one body
  bridgeWidth: 10, // minimum width of hug-style bridge spars (mm)
  autoPreview: true, // regenerate the 3D preview automatically on any change
};

// The tracked default for cornerRadius: a corner arc that reads as a larger
// circle flowing around the corner cell.
export function autoCornerRadius(params) {
  return +(params.holeD / 2 + params.wall).toFixed(2);
}

// Numeric fields (for input parsing/validation).
export const NUMERIC = [
  "pitch", "holeD", "lipD", "wallHeight", "baseThickness",
  "wall", "cornerRadius", "bridgeWidth", "cols", "rows",
];

const LS_KEY = "batteryFrameGenerator.v1";

export function createState() {
  const state = {
    params: { ...DEFAULTS },
    cells: new Set(),
  };

  state.save = () => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ params: state.params, cells: [...state.cells] })
      );
    } catch {}
  };

  state.load = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.params) state.params = { ...DEFAULTS, ...data.params };
      if (Array.isArray(data.cells)) state.cells = new Set(data.cells);
      return true;
    } catch {
      return false;
    }
  };

  // Drop any selected cells that fall outside the current grid bounds.
  state.clampCells = () => {
    for (const k of [...state.cells]) {
      const [c, r] = parseKey(k);
      if (c < 0 || r < 0 || c >= state.params.cols || r >= state.params.rows)
        state.cells.delete(k);
    }
  };

  return state;
}

export { key };
