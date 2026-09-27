const TAU = 2 * Math.PI;

export type Plane = 17 | 18 | 19;

/** [first in-plane axis, second in-plane axis, normal] — right-handed, so CCW = increasing angle seen from +normal. */
export function planeAxes(plane: Plane): [number, number, number] {
  return plane === 17 ? [0, 1, 2] : plane === 18 ? [2, 0, 1] : [1, 2, 0];
}

export interface ArcGeometry {
  a: number;
  b: number;
  n: number;
  /** Centre in plane coordinates. */
  ca: number;
  cb: number;
  /** Radius at the start point. */
  r: number;
  /** Start angle (radians). */
  a0: number;
  /** Signed sweep: positive CCW, |sweep| ∈ (0, 2π]. */
  sweep: number;
  /** Travel along the plane normal (helix). */
  dn: number;
  /** Distance from centre to the end point (for mismatch checks). */
  endRadius: number;
}

type P3 = ArrayLike<number>;

export function arcGeometry(start: P3, end: P3, centre: P3, plane: Plane, cw: boolean): ArcGeometry {
  const [a, b, n] = planeAxes(plane);
  const ca = centre[a], cb = centre[b];
  const sa = start[a] - ca, sb = start[b] - cb;
  const ea = end[a] - ca, eb = end[b] - cb;
  const a0 = Math.atan2(sb, sa);
  const a1 = Math.atan2(eb, ea);
  const closed = Math.hypot(end[a] - start[a], end[b] - start[b]) < 1e-9;
  let sweep: number;
  if (closed) sweep = cw ? -TAU : TAU;
  else if (cw) sweep = -((((a0 - a1) % TAU) + TAU) % TAU);
  else sweep = (((a1 - a0) % TAU) + TAU) % TAU;
  return { a, b, n, ca, cb, r: Math.hypot(sa, sb), a0, sweep, dn: end[n] - start[n], endRadius: Math.hypot(ea, eb) };
}

export function arcPointInto(g: ArcGeometry, start: P3, fraction: number, out: { [k: number]: number }): void {
  const angle = g.a0 + g.sweep * fraction;
  out[g.a] = g.ca + g.r * Math.cos(angle);
  out[g.b] = g.cb + g.r * Math.sin(angle);
  out[g.n] = start[g.n] + g.dn * fraction;
}

export function arcLength(g: ArcGeometry): number {
  return Math.hypot(g.r * Math.abs(g.sweep), g.dn);
}

/** Grows min/max (3 values each) to contain the arc: end points plus every quadrant point inside the sweep. */
export function arcBoundsInto(g: ArcGeometry, start: P3, end: P3, min: number[], max: number[]): void {
  const include = (p: P3) => {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  };
  include(start);
  include(end);
  const lo = Math.min(g.a0, g.a0 + g.sweep);
  const hi = Math.max(g.a0, g.a0 + g.sweep);
  const first = Math.ceil(lo / (Math.PI / 2));
  const p = [0, 0, 0];
  for (let k = first; k * (Math.PI / 2) <= hi; k++) {
    const angle = k * (Math.PI / 2);
    const fraction = (angle - g.a0) / g.sweep;
    arcPointInto(g, start, fraction, p);
    include(p);
  }
}

/**
 * Centre for an R-format arc: +R takes the shorter arc (≤ 180°), −R the longer one.
 * Returns null when start = end (R cannot describe a full circle) or |R| is too small for the chord.
 */
export function centreFromRadius(start: P3, end: P3, plane: Plane, r: number, cw: boolean): [number, number, number] | null {
  const [a, b] = planeAxes(plane);
  const da = end[a] - start[a], db = end[b] - start[b];
  const d = Math.hypot(da, db);
  if (d < 1e-9) return null;
  const radius = Math.abs(r);
  const h2 = radius * radius - (d / 2) * (d / 2);
  if (h2 < -1e-6 * Math.max(1, radius * radius)) return null;
  const h = Math.sqrt(Math.max(0, h2));
  const left = !cw === r > 0; // CCW short arc and CW long arc have the centre left of the chord
  const s = left ? 1 : -1;
  const centre: [number, number, number] = [start[0], start[1], start[2]];
  centre[a] = start[a] + da / 2 + (-db / d) * h * s;
  centre[b] = start[b] + db / 2 + (da / d) * h * s;
  return centre;
}
