import type { Tool, Toolpath } from '../../src';

export interface HeightField {
  x0: number; y0: number; step: number; nx: number; ny: number;
  /** Top surface Z per cell (index j * nx + i, cell centre at x0 + (i + 0.5) step), starts at `surface`. */
  z: Float64Array;
  /** The initial surface Z. */
  surface: number;
}

export function heightField(bounds: { minX: number; minY: number; maxX: number; maxY: number }, step: number, surface: number): HeightField {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step), ny = Math.ceil((bounds.maxY - bounds.minY) / step);
  return { x0: bounds.minX, y0: bounds.minY, step, nx, ny, z: new Float64Array(nx * ny).fill(surface), surface };
}

type P = { x: number; y: number; z: number };

/** Height of a non-V tool's underside at distance d from its axis above the tip (Infinity beyond the radius). */
function liftOf(tool: Tool): (d: number) => number {
  const r = tool.diameter / 2;
  const rc = tool.type === 'ball' ? r : Math.min(tool.cornerRadius, r);
  return (d) => {
    if (d > r) return Infinity;
    const e = d - (r - rc);
    return e <= 0 ? 0 : rc - Math.sqrt(Math.max(0, rc * rc - e * e));
  };
}

/** Lowers cells within `reach` of the segment a-b by the tool's height at the distance of the cell from the segment (constant z). */
function stampConst(f: HeightField, a: P, b: P, z: number, reach: number, lift: (d: number) => number): void {
  const { step, nx, ny, x0, y0 } = f;
  const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - x0) / step - 0.5)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + reach - x0) / step - 0.5));
  const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - y0) / step - 0.5)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + reach - y0) / step - 0.5));
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  for (let j = j0; j <= j1; j++) {
    const cy = y0 + (j + 0.5) * step;
    for (let i = i0; i <= i1; i++) {
      const cx = x0 + (i + 0.5) * step;
      const u = l2 > 1e-18 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / l2)) : 0;
      const zz = z + lift(Math.hypot(cx - a.x - u * dx, cy - a.y - u * dy));
      const k = j * nx + i;
      if (zz < f.z[k]) f.z[k] = zz;
    }
  }
}

/** Lowers cells by a V-bit moving a to b with z linear along the way (exact: minimum over the segment of z(s) + dist / t). */
function stampV(f: HeightField, a: P, b: P, t: number): void {
  const { step, nx, ny, x0, y0 } = f;
  const reach = Math.max(0, (f.surface - Math.min(a.z, b.z)) * t);
  if (reach <= 0) return;
  const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - x0) / step - 0.5)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + reach - x0) / step - 0.5));
  const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - y0) / step - 0.5)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + reach - y0) / step - 0.5));
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  const m = L > 1e-12 ? (b.z - a.z) / L : 0, kk = -m * t;
  for (let j = j0; j <= j1; j++) {
    const cy = y0 + (j + 0.5) * step;
    for (let i = i0; i <= i1; i++) {
      const cx = x0 + (i + 0.5) * step;
      let zz: number;
      if (L < 1e-12) zz = Math.min(a.z, b.z) + Math.hypot(cx - a.x, cy - a.y) / t;
      else {
        const u = ((cx - a.x) * dx + (cy - a.y) * dy) / L;
        const p = Math.abs((cx - a.x) * dy - (cy - a.y) * dx) / L;
        const fn = (s: number) => a.z + m * s + Math.hypot(p, s - u) / t;
        zz = Math.min(fn(0), fn(L));
        if (Math.abs(kk) < 1) zz = Math.min(zz, fn(Math.max(0, Math.min(L, u + (kk * p) / Math.sqrt(1 - kk * kk)))));
      }
      const k = j * nx + i;
      if (zz < f.z[k]) f.z[k] = zz;
    }
  }
}

/**
 * Lowers the field by every cutting move of `tp` with `tool`. A V-bit cuts z_tip + dist / tan(alpha), swept exactly along each segment
 * (finer than sampling every step / 2); a flat tool cuts z within its radius; a bull-nose its corner profile. Arcs are chorded to 0.002 mm.
 */
export function sweep(f: HeightField, tp: Toolpath, tool: Tool): void {
  const v = tool.type === 'vbit';
  const t = Math.tan((tool.tipAngleDeg * Math.PI) / 360);
  const r = tool.diameter / 2, lift = v ? null : liftOf(tool);
  const seg = (a: P, b: P) => {
    if (v) { stampV(f, a, b, t); return; }
    const len = Math.hypot(b.x - a.x, b.y - a.y), dz = Math.abs(b.z - a.z);
    const n = dz > 1e-9 ? Math.max(1, Math.ceil(len / 0.05)) : 1;
    for (let k = 0; k < n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
      const q = { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n, z: a.z + ((b.z - a.z) * (k + 1)) / n };
      stampConst(f, p, q, Math.min(p.z, q.z), r, lift!);
    }
  };
  let cur: P | null = null;
  for (const m of tp.moves) {
    if (m.kind === 'cycle') continue;
    if (m.kind === 'rapid') { cur = { ...m.to }; continue; }
    if (!cur) { cur = { ...m.to }; continue; }
    if (m.kind === 'line') seg(cur, m.to);
    else {
      const rad = Math.hypot(cur.x - m.center.x, cur.y - m.center.y);
      const a0 = Math.atan2(cur.y - m.center.y, cur.x - m.center.x), a1 = Math.atan2(m.to.y - m.center.y, m.to.x - m.center.x);
      let d = a1 - a0;
      if (m.ccw) { while (d <= 1e-9) d += 2 * Math.PI; } else { while (d >= -1e-9) d -= 2 * Math.PI; }
      const n = Math.max(2, Math.ceil(Math.abs(d) / (2 * Math.acos(Math.max(0, 1 - 0.002 / Math.max(rad, 0.01))))));
      let prev: P = cur;
      for (let k = 1; k <= n; k++) {
        const a = a0 + (d * k) / n;
        const q = { x: m.center.x + rad * Math.cos(a), y: m.center.y + rad * Math.sin(a), z: cur.z + ((m.to.z - cur.z) * k) / n };
        seg(prev, q);
        prev = q;
      }
    }
    cur = { ...m.to };
  }
}
