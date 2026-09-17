// Pure geometry/lattice math for the cell grid. No DOM, no CAD — safe to unit-test.

export const key = (col, row) => `${col},${row}`;
export const parseKey = (k) => k.split(",").map(Number);

// Centre of a cell in millimetres (model space, Y up).
export function cellCenter(col, row, params) {
  const p = params.pitch;
  if (params.layout === "triangular") {
    const h = (p * Math.sqrt(3)) / 2;
    return [col * p + (row % 2 ? p / 2 : 0), row * h];
  }
  return [col * p, row * p];
}

// Lattice neighbours that are EXACTLY one pitch away (used for hug-style
// connectors and adjacency). Returns candidate [col,row] pairs (unbounded).
export function neighbors(col, row, layout) {
  if (layout === "triangular") {
    const odd = row % 2 !== 0;
    // Column offsets for the cells in the row above / below.
    const a = odd ? 0 : -1;
    const b = odd ? 1 : 0;
    return [
      [col - 1, row],
      [col + 1, row],
      [col + a, row - 1],
      [col + b, row - 1],
      [col + a, row + 1],
      [col + b, row + 1],
    ];
  }
  return [
    [col - 1, row],
    [col + 1, row],
    [col, row - 1],
    [col, row + 1],
  ];
}

// Centres (mm) of every active cell.
export function activeCenters(cells, params) {
  const out = [];
  for (const k of cells) {
    const [c, r] = parseKey(k);
    out.push(cellCenter(c, r, params));
  }
  return out;
}

// Adjacent active pairs (each once) that are one pitch apart, as [[x1,y1],[x2,y2]].
export function activePairs(cells, params) {
  const pairs = [];
  for (const k of cells) {
    const [c, r] = parseKey(k);
    for (const [nc, nr] of neighbors(c, r, params.layout)) {
      const nk = key(nc, nr);
      if (!cells.has(nk)) continue;
      // Emit each undirected pair once.
      if (k < nk) pairs.push([cellCenter(c, r, params), cellCenter(nc, nr, params)]);
    }
  }
  return pairs;
}

// Mirror a selection horizontally within [0, cols-1] (index space).
export function mirrorCells(cells, cols) {
  const out = new Set();
  for (const k of cells) {
    const [c, r] = parseKey(k);
    out.add(key(cols - 1 - c, r));
  }
  return out;
}

// Every lattice site in the cols x rows grid, with its mm centre — for rendering.
export function allSites(params) {
  const sites = [];
  for (let r = 0; r < params.rows; r++) {
    for (let c = 0; c < params.cols; c++) {
      sites.push({ col: c, row: r, center: cellCenter(c, r, params) });
    }
  }
  return sites;
}
