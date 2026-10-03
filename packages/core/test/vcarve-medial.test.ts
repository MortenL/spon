import { describe, expect, it } from 'vitest';
import { medialGraph, sampleShape, sampleSpacing, type Vec2 } from '../src';

const rect = (w: number, h: number): Vec2[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const circle = (r: number, n = 256): Vec2[] => Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / n), y: r * Math.sin((2 * Math.PI * i) / n) }));
const s = sampleSpacing(0.01); // 0.04
const graph = (polys: Vec2[][]) => medialGraph(sampleShape(polys, s), s);
const maxR = (g: ReturnType<typeof graph>) => Math.max(...g.nodes.map((n) => n.r));
const near = (g: ReturnType<typeof graph>, p: Vec2, d: number) => g.nodes.some((n) => Math.hypot(n.x - p.x, n.y - p.y) <= d);

describe('sampling', () => {
  it('samples evenly, keeps corners, and records arc length per loop', () => {
    const sh = sampleShape([rect(40, 10)], s);
    expect(sh.loopLengths).toEqual([100]);
    expect(sh.samples.length).toBeGreaterThanOrEqual(100 / s);
    expect(sh.corners).toHaveLength(4);
    for (let i = 1; i < sh.samples.length; i++) expect(sh.samples[i].s - sh.samples[i - 1].s).toBeLessThanOrEqual(s + 1e-9);
  });
});

describe('centreline', () => {
  it('a rectangle: the middle line at half the width, and diagonals into all four corners', () => {
    const g = graph([rect(40, 10)]);
    expect(maxR(g)).toBeCloseTo(5, 1);
    for (const c of rect(40, 10)) expect(g.nodes.some((n) => n.r === 0 && Math.hypot(n.x - c.x, n.y - c.y) < 1e-9)).toBe(true);
    expect(near(g, { x: 20, y: 5 }, s)).toBe(true);
    for (const n of g.nodes) expect(n.x >= -1e-9 && n.x <= 40 + 1e-9 && n.y >= -1e-9 && n.y <= 10 + 1e-9).toBe(true);
  });

  it('a circle: reaches the centre at the full radius', () => {
    const g = graph([circle(5)]);
    expect(near(g, { x: 0, y: 0 }, 2 * s)).toBe(true);
    expect(maxR(g)).toBeCloseTo(5, 1);
  });

  it('a 60° wedge: ends exactly at the tip', () => {
    const tip = { x: 0, y: 0 };
    const g = graph([[tip, { x: 30, y: -30 * Math.tan(Math.PI / 6) }, { x: 30, y: 30 * Math.tan(Math.PI / 6) }]]);
    expect(g.nodes.some((n) => n.r === 0 && Math.hypot(n.x, n.y) < 1e-9)).toBe(true);
    const tipNode = g.nodes.findIndex((n) => n.r === 0 && Math.hypot(n.x, n.y) < 1e-9);
    expect(g.edges.some(([a, b]) => a === tipNode || b === tipNode)).toBe(true);
  });

  it('a ring: every node lies between the outlines (review focus 3)', () => {
    const outer = circle(10), hole = circle(5).reverse();
    const g = graph([outer, hole]);
    for (const n of g.nodes) { const d = Math.hypot(n.x, n.y); expect(d).toBeGreaterThanOrEqual(5 - 1e-6); expect(d).toBeLessThanOrEqual(10 + 1e-6); }
    expect(maxR(g)).toBeCloseTo(2.5, 1);
  });

  it('a straight edge makes no noise branches: nodes near the boundary are only corner diagonals', () => {
    const g = graph([rect(40, 10)]);
    // away from the corners, every node is at least 4.5 mm from the long walls (on the middle line)
    for (const n of g.nodes) if (n.x > 6 && n.x < 34) expect(n.r).toBeGreaterThan(4.5);
  });

  it('tiny and degenerate shapes stay finite and small (review focus 1)', () => {
    for (const polys of [[rect(0.3, 0.05)], [circle(0.5, 16)], [rect(5, 5).map((p) => ({ x: p.x * 1e-9, y: p.y }))]]) {
      const g = graph(polys);
      for (const n of g.nodes) { expect(Number.isFinite(n.x + n.y + n.r)).toBe(true); expect(n.r).toBeLessThan(5); }
    }
  });
});

describe('corners', () => {
  const cornerNodes = (g: ReturnType<typeof graph>) => g.nodes.filter((n) => n.r === 0).length;
  const ngon = (n: number, r = 5): Vec2[] => circle(r, n);
  it('flattened curves make no corner nodes or spokes', () => {
    for (const polys of [[circle(0.1, 64)], [circle(0.5, 16)], [circle(5)]]) {
      const sh = sampleShape(polys, s);
      expect(sh.corners).toHaveLength(0);
      expect(cornerNodes(medialGraph(sh, s))).toBe(0);
    }
  });
  it('a regular 12-gon (30 degree turns) reaches its corners; a 13-gon (about 27.7) does not', () => {
    expect(cornerNodes(graph([ngon(12)]))).toBe(12);
    expect(cornerNodes(graph([ngon(13)]))).toBe(0);
  });
});
