import { describe, expect, it } from 'vitest';
import { dropCutter, meshIndexFromTriangles, profileHeight, type ToolShape, toolShape } from '../src';
import { tool6 } from './fixtures/camSetup';

const flat = toolShape({ ...tool6, diameter: 6 }); // R 3, rc 0
const ball = toolShape({ ...tool6, type: 'ball', cornerRadius: 3 }); // R 3, rc 3
const bull = toolShape({ ...tool6, type: 'bull', cornerRadius: 1 }); // R 3, rc 1
const cone = toolShape({ ...tool6, type: 'vbit', tipAngleDeg: 90, diameter: 12 }); // R 6, alpha 45 deg

// a horizontal square top at z = 5 from (0,0) to (10,10)
const top = meshIndexFromTriangles([
  [0, 0, 5, 10, 0, 5, 10, 10, 5],
  [0, 0, 5, 10, 10, 5, 0, 10, 5],
], 2);
// a 45 degree slope rising along +x: z = x
const slope = meshIndexFromTriangles([
  [0, 0, 0, 10, 0, 10, 10, 10, 10],
  [0, 0, 0, 10, 10, 10, 0, 10, 0],
], 2);

describe('toolShape', () => {
  it('maps tool types', () => {
    expect(flat).toMatchObject({ kind: 'torus', radius: 3, cornerRadius: 0 });
    expect(ball).toMatchObject({ kind: 'torus', cornerRadius: 3 });
    expect(cone).toMatchObject({ kind: 'cone', radius: 6 });
    expect(cone.halfAngle).toBeCloseTo(Math.PI / 4, 12);
    expect(toolShape({ ...tool6, type: 'chamfer', tipAngleDeg: 179.95 })).toMatchObject({ kind: 'torus', cornerRadius: 0 });
  }, 120_000);
});

describe('profileHeight', () => {
  it('matches each shape', () => {
    expect(profileHeight(flat, 2)).toBe(0);
    expect(profileHeight(ball, 3)).toBeCloseTo(3, 9);
    expect(profileHeight(bull, 2)).toBe(0);
    expect(profileHeight(bull, 3)).toBeCloseTo(1, 9);
    expect(profileHeight(cone, 2)).toBeCloseTo(2, 9);
    expect(profileHeight(flat, 3.1)).toBe(Infinity);
  }, 120_000);
});

describe('dropCutter', () => {
  it('rests on a horizontal face, and on its edge from outside', () => {
    expect(dropCutter(top, flat, 5, 5, 0.01)).toBeCloseTo(5, 9);
    expect(dropCutter(top, flat, 12, 5, 0.01)).toBeCloseTo(5, 6);
    expect(dropCutter(top, flat, 13.5, 5, 0.01)).toBe(-Infinity);
    expect(dropCutter(top, ball, 12, 5, 0.01)).toBeCloseTo(5 - (3 - Math.sqrt(9 - 4)), 4);
    expect(dropCutter(top, cone, 12, 5, 0.01)).toBeCloseTo(5 - 2, 4);
  });

  it('touches a 45 degree slope where each shape should', () => {
    expect(dropCutter(slope, flat, 5, 5, 0.01)).toBeCloseTo(8, 6);
    expect(dropCutter(slope, ball, 5, 5, 0.01)).toBeCloseTo(5 + 3 * Math.SQRT2 - 3, 6);
    expect(dropCutter(slope, cone, 5, 5, 0.01)).toBeCloseTo(5, 6);
  });

  it('puts a cone on a steep plane at the rim and on a shallow one at the tip', () => {
    const steep = meshIndexFromTriangles([[0, 0, 0, 20, 0, 40, 20, 20, 40], [0, 0, 0, 20, 20, 40, 0, 20, 0]], 2); // z = 2x
    expect(dropCutter(steep, cone, 10, 10, 0.01)).toBeCloseTo(2 * 16 - 6, 6); // rim at x + 6, minus R / tan45
    const shallow = meshIndexFromTriangles([[0, 0, 0, 20, 0, 10, 20, 20, 10], [0, 0, 0, 20, 20, 10, 0, 20, 0]], 2); // z = x / 2
    expect(dropCutter(shallow, cone, 10, 10, 0.01)).toBeCloseTo(5, 6);
  });

  it('ignores downward-facing facets for the facet case but still sees their edges', () => {
    const under = meshIndexFromTriangles([[0, 0, 5, 10, 10, 5, 10, 0, 5]], 2);
    expect(dropCutter(under, flat, 8, 3, 0.01)).toBeCloseTo(5, 6);
  }, 120_000);
});

// ---------- randomized brute-force self-check ----------

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exact profile for the reference, written independently of profileHeight. */
function refProfile(s: ToolShape, d: number): number {
  if (d > s.radius) return Infinity;
  if (s.kind === 'cone') return d / Math.tan(s.halfAngle);
  const k = s.radius - s.cornerRadius;
  if (d <= k) return 0;
  return s.cornerRadius - Math.sqrt(Math.max(0, s.cornerRadius ** 2 - (d - k) ** 2));
}

type P = [number, number, number];
function reference(tri: number[], s: ToolShape, cx: number, cy: number): number {
  const v: P[] = [[tri[0], tri[1], tri[2]], [tri[3], tri[4], tri[5]], [tri[6], tri[7], tri[8]]];
  const f = (p: P) => p[2] - refProfile(s, Math.hypot(p[0] - cx, p[1] - cy));
  let best = -Infinity;
  // The facet: f is concave over (triangle intersect disc), so nested golden-section searches (y inside x) are exact.
  const zAt = (px: number, py: number): number => {
    const [a, b, c] = v;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const u = ((px - a[0]) * (c[1] - a[1]) - (py - a[1]) * (c[0] - a[0])) / det;
    const w = ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) / det;
    return a[2] + u * (b[2] - a[2]) + w * (c[2] - a[2]);
  };
  const slice = (px: number): [number, number] | null => {
    let lo = Infinity, hi = -Infinity;
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3];
      if (px < Math.min(p[0], q[0]) || px > Math.max(p[0], q[0])) continue;
      if (p[0] === q[0]) { lo = Math.min(lo, p[1], q[1]); hi = Math.max(hi, p[1], q[1]); continue; }
      const y = p[1] + ((px - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (lo > hi) return null;
    const half = Math.sqrt(Math.max(0, s.radius ** 2 - (px - cx) ** 2));
    if (Math.abs(px - cx) > s.radius) return null;
    lo = Math.max(lo, cy - half); hi = Math.min(hi, cy + half);
    return lo <= hi ? [lo, hi] : null;
  };
  const phi = 0.6180339887498949;
  const search = (lo: number, hi: number, fn: (t: number) => number): number => {
    let m1 = hi - phi * (hi - lo), m2 = lo + phi * (hi - lo), f1 = fn(m1), f2 = fn(m2), top = Math.max(fn(lo), fn(hi));
    for (let i = 0; i < 60; i++) {
      if (f1 < f2) { lo = m1; m1 = m2; f1 = f2; m2 = lo + phi * (hi - lo); f2 = fn(m2); } else { hi = m2; m2 = m1; f2 = f1; m1 = hi - phi * (hi - lo); f1 = fn(m1); }
      top = Math.max(top, f1, f2);
    }
    return top;
  };
  const xlo = Math.max(Math.min(v[0][0], v[1][0], v[2][0]), cx - s.radius), xhi = Math.min(Math.max(v[0][0], v[1][0], v[2][0]), cx + s.radius);
  if (xlo <= xhi) {
    const K = 1500;
    let inDom = NaN;
    for (let i = 0; i <= K; i++) { const px = xlo + ((xhi - xlo) * i) / K; if (slice(px)) { inDom = px; break; } }
    if (!Number.isNaN(inDom)) {
      const bisect = (good: number, bad: number): number => {
        for (let i = 0; i < 80; i++) { const m = (good + bad) / 2; if (slice(m)) good = m; else bad = m; }
        return good;
      };
      let xa = inDom, xb = inDom;
      const stepX = (xhi - xlo) / K;
      // grow outward until the slice disappears, then bisect the end
      for (let px = inDom; px >= xlo - 1e-15; px -= stepX) { if (slice(px)) xa = px; else { xa = bisect(xa, px); break; } }
      for (let px = inDom; px <= xhi + 1e-15; px += stepX) { if (slice(px)) xb = px; else { xb = bisect(xb, px); break; } }
      const g = (px: number): number => {
        const sl = slice(px);
        if (!sl) return -Infinity;
        return search(sl[0], sl[1], (py) => zAt(px, py) - refProfile(s, Math.hypot(px - cx, py - cy)));
      };
      best = Math.max(best, search(xa, xb, g));
    }
  }
  // every edge, densely, with a polish
  for (let e = 0; e < 3; e++) {
    const a = v[e], b = v[(e + 1) % 3];
    const g = (t: number) => f([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    const M = 4000;
    let bt = 0, bv = -Infinity;
    for (let i = 0; i <= M; i++) { const val = g(i / M); if (val > bv) { bv = val; bt = i / M; } }
    let st = 1 / M;
    while (st > 1e-12 && bv > -Infinity) {
      let moved = false;
      for (const dt of [st, -st]) {
        const t = bt + dt;
        if (t < 0 || t > 1) continue;
        const val = g(t);
        if (val > bv) { bv = val; bt = t; moved = true; }
      }
      if (!moved) st /= 2;
    }
    best = Math.max(best, bv);
  }
  return best;
}

describe('dropCutter against a brute-force reference', () => {
  it('agrees on random triangles and tool positions', () => {
    const rnd = mulberry(20261002);
    const shapes: ToolShape[] = [
      flat, ball, bull, cone,
      toolShape({ ...tool6, type: 'drill', tipAngleDeg: 118, diameter: 4 }),
      toolShape({ ...tool6, type: 'chamfer', tipAngleDeg: 30, diameter: 8 }),
    ];
    let finite = 0, worstUnder = 0, worstOver = 0;
    for (let n = 0; n < 400; n++) {
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) tri.push(rnd() * 10, rnd() * 10, rnd() * 10 - 5);
      // facets count only when they face up (a closed model's down-facing facets are never the top surface), so orient up
      if ((tri[3] - tri[0]) * (tri[7] - tri[1]) - (tri[4] - tri[1]) * (tri[6] - tri[0]) < 0) {
        for (let k = 0; k < 3; k++) { const t = tri[3 + k]; tri[3 + k] = tri[6 + k]; tri[6 + k] = t; }
      }
      const idx = meshIndexFromTriangles([tri], 2.5);
      for (const s of shapes) {
        for (let q = 0; q < 3; q++) {
          const x = rnd() * 16 - 3, y = rnd() * 16 - 3;
          const got = dropCutter(idx, s, x, y, 0.01);
          const ref = reference(tri, s, x, y);
          // the sampled reference may miss a sliver of the disc; the exact answer is then allowed to be finite
          if (ref === -Infinity) continue;
          finite++;
          worstUnder = Math.min(worstUnder, got - ref);
          worstOver = Math.max(worstOver, got - ref);
          expect(got, `under-estimate ${JSON.stringify({ s, tri, x, y, ref })}`).toBeGreaterThanOrEqual(ref - 1e-4);
          expect(got, `over-estimate (shape ${s.kind}, tri ${n})`).toBeLessThanOrEqual(ref + 1e-6);
        }
      }
    }
    expect(finite).toBeGreaterThan(500);
    expect(worstUnder).toBeGreaterThan(-1e-6);
    console.log(`drop-cutter self-check: ${finite} comparisons, worst under ${worstUnder.toExponential(2)}, worst over ${worstOver.toExponential(2)}`);
  }, 120_000);
});
