// The stepped test solid, shared by stepped.ts and make-fixtures.mjs (which writes stepped.stl from it).
// A closed box stack in mm: a base slab 60 x 40 x 10 (z 0..10) with a boss 20 x 20 x 10 on top (x 20..40, y 10..30,
// z 10..20). Slab faces are split along the boss footprint so the surface is watertight; triangles have outward normals.

/** Returns { pos, idx }: flat vertex coordinates and triangle vertex indices. */
export function steppedData() {
  const key = new Map();
  const pos = [];
  const idx = [];
  const v = (p) => {
    const k = p.join(',');
    let i = key.get(k);
    if (i === undefined) { i = pos.length / 3; key.set(k, i); pos.push(...p); }
    return i;
  };
  /** A quad given counter-clockwise seen from outside. */
  const quad = (a, b, c, d) => {
    const [ia, ib, ic, id] = [v(a), v(b), v(c), v(d)];
    idx.push(ia, ib, ic, ia, ic, id);
  };
  const xs = [0, 20, 40, 60], ys = [0, 10, 30, 40];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      quad([x0, y1, 0], [x1, y1, 0], [x1, y0, 0], [x0, y0, 0]); // bottom, facing down
      if (i !== 1 || j !== 1) quad([x0, y0, 10], [x1, y0, 10], [x1, y1, 10], [x0, y1, 10]); // slab top around the boss
    }
    quad([xs[i], 0, 0], [xs[i + 1], 0, 0], [xs[i + 1], 0, 10], [xs[i], 0, 10]); // y = 0
    quad([xs[i + 1], 40, 0], [xs[i], 40, 0], [xs[i], 40, 10], [xs[i + 1], 40, 10]); // y = 40
    quad([0, ys[i + 1], 0], [0, ys[i], 0], [0, ys[i], 10], [0, ys[i + 1], 10]); // x = 0
    quad([60, ys[i], 0], [60, ys[i + 1], 0], [60, ys[i + 1], 10], [60, ys[i], 10]); // x = 60
  }
  quad([20, 10, 10], [40, 10, 10], [40, 10, 20], [20, 10, 20]); // boss y = 10
  quad([40, 30, 10], [20, 30, 10], [20, 30, 20], [40, 30, 20]); // boss y = 30
  quad([20, 30, 10], [20, 10, 10], [20, 10, 20], [20, 30, 20]); // boss x = 20
  quad([40, 10, 10], [40, 30, 10], [40, 30, 20], [40, 10, 20]); // boss x = 40
  quad([20, 10, 20], [40, 10, 20], [40, 30, 20], [20, 30, 20]); // boss top

  return { pos, idx };
}
