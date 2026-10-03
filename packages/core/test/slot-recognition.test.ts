import { describe, expect, it } from 'vitest';
import { camContext, closedSlotOf, faceGeometry, faceRegion, fitArcs, type Path2D, slotShapeOf } from '../src';
import { faceAt } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { arcSlotPts, obroundPts, rectPts } from './fixtures/terraced.mjs';

const plate = rectPts(0, 0, 100, 60);
/** A loop as faceGeometry gives it: points fitted with lines and arcs. */
/** The centreline end points of a straight shape, rounded to 0.01 mm. */
const endPts = (s: NonNullable<ReturnType<typeof slotShapeOf>>) => {
  const g = s.centreline.segments[0] as { from: { x: number; y: number }; to: { x: number; y: number } };
  return [g.from, g.to].map((q) => [Math.round(q.x * 10) / 10 + 0, Math.round(q.y * 10) / 10 + 0]);
};
/** The centreline end points, ordered by x. */
const ends = (s: NonNullable<ReturnType<typeof slotShapeOf>>) => endPts(s).sort((a, b) => a[0] - b[0]);
const loopOf = (pts: number[][]) => fitArcs(pts.map(([x, y]) => ({ x, y })), true, 0.01);

/** The closed slots of the plate's top face (raw z 10), recognised loop by loop. */
function topSlots(cuts: Parameters<typeof terracedSetup>[2]) {
  const s = terracedSetup(plate, 10, cuts);
  const ctx = camContext(s.job, s.geometry);
  const g = s.geometry as Extract<typeof s.geometry, { kind: 'mesh' }>;
  const face = faceAt(g, 1, 1, 10);
  const f = faceGeometry(ctx, faceRegion(g.mesh, g.adjacency, face.seed));
  return f.loops.map((_, k) => closedSlotOf(ctx, f, face, k)).filter((x) => x !== null);
}

describe('slot shapes', () => {
  it('fits an obround and a square-ended rectangle', () => {
    const ob = slotShapeOf(loopOf(obroundPts(10, 30, 0, 8)), 0.01)!;
    expect(ob).toMatchObject({ kind: 'line', ends: ['round', 'round'] });
    expect(ob.width).toBeCloseTo(8, 3);
    expect(ends(ob)).toEqual([[10, 0], [30, 0]]);
    const r = slotShapeOf(loopOf(rectPts(0, 0, 40, 8)), 0.01)!;
    expect(r).toMatchObject({ kind: 'line', ends: ['square', 'square'] });
  });

  it('fits a slot with one round and one square end', () => {
    const pts: number[][] = [[0, 0], [30, 0]];
    for (let i = 1; i < 32; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 32; pts.push([30 + 4 * Math.cos(a), 4 + 4 * Math.sin(a)]); }
    pts.push([30, 8], [0, 8]);
    const s = slotShapeOf(loopOf(pts), 0.01)!;
    expect(s.ends.slice().sort()).toEqual(['round', 'square']);
    const [a, b] = endPts(s);
    const [sq, rd] = s.ends[0] === 'square' ? [a, b] : [b, a];
    expect(sq).toEqual([0, 4]);
    expect(rd).toEqual([30, 4]);
  });

  it('fits an arc slot about its centre', () => {
    const s = slotShapeOf(loopOf(arcSlotPts(0, 0, 30, 8, Math.PI / 4, (3 * Math.PI) / 4)), 0.01)!;
    expect(s.kind).toBe('arc');
    expect(s.width).toBeCloseTo(8, 2);
    const seg = s.centreline.segments[0] as Extract<Path2D['segments'][number], { kind: 'arc' }>;
    expect(seg.radius).toBeCloseTo(30, 2);
    expect(Math.abs(seg.sweep)).toBeCloseTo(Math.PI / 2, 2);
  });

  it('rejects short rectangles, circles and trapezoids (review focus 2)', () => {
    const P = loopOf;
    expect(slotShapeOf(P(rectPts(0, 0, 12, 8)), 0.01)).toBeNull();
    expect(slotShapeOf(P(Array.from({ length: 64 }, (_, i) => [5 * Math.cos((i * Math.PI) / 32), 5 * Math.sin((i * Math.PI) / 32)])), 0.01)).toBeNull();
    expect(slotShapeOf(P([[0, 0], [40, 0], [38, 8], [2, 8]]), 0.01)).toBeNull();
    expect(slotShapeOf(P([[3, 0], [40, 0], [40, 8], [0, 8], [0, 3]]), 0.01)).toBeNull(); // 3 mm corner chamfer
    expect(slotShapeOf(P([[0, 0], [40, 0], [39.3, 8], [0.7, 8]]), 0.01)).toBeNull(); // 0.7 mm end offsets
    // an arc slot with one slanted (non-radial) square end
    const slant: number[][] = [];
    for (let i = 0; i <= 32; i++) { const a = Math.PI / 4 + (Math.PI / 2) * (i / 32); slant.push([34 * Math.cos(a), 34 * Math.sin(a)]); }
    for (let i = 32; i >= 0; i--) { const a = Math.PI / 4 + 0.15 + (Math.PI / 2 - 0.15) * (i / 32); slant.push([26 * Math.cos(a), 26 * Math.sin(a)]); }
    expect(slotShapeOf(P(slant), 0.01)).toBeNull();
  });
});

describe('closed slots in models', () => {
  it('finds an obround through slot with its centre-to-centre length', () => {
    const [s] = topSlots([{ poly: obroundPts(30, 43.5, 30, 6.5), z: 0 }]);
    expect(s).toMatchObject({ ends: ['round', 'round'], through: true, shape: { kind: 'line' } });
    expect(s.shape.width).toBeCloseTo(6.5, 2);
    expect(s.ref).toMatchObject({ kind: 'meshSlot', loop: expect.any(Number) });
  });

  it('finds a coarse 16-sided-end obround (review focus 2)', () => {
    const found = topSlots([{ poly: obroundPts(30, 50, 30, 10, 8), z: 4 }]);
    expect(found).toHaveLength(1);
    expect(found[0].ends).toEqual(['round', 'round']);
    expect(found[0].shape.width).toBeCloseTo(10, 1);
    expect(ends(found[0].shape).map(([x, y]) => [x - 5, y - 5])).toEqual([[30, 30], [50, 30]]);
  });

  it('finds a blind arc slot and its floor', () => {
    const [s] = topSlots([{ poly: arcSlotPts(50, 0, 40, 8, Math.PI / 3, (2 * Math.PI) / 3), z: 6 }]);
    expect(s).toMatchObject({ through: false, shape: { kind: 'arc' } });
    expect(s.top - s.bottom).toBeCloseTo(4, 6);
  });

  it('finds a square-ended keyway', () => {
    const [s] = topSlots([{ poly: rectPts(20, 26, 60, 34), z: 7 }]);
    expect(s).toMatchObject({ ends: ['square', 'square'], through: false });
    expect(s.shape.width).toBeCloseTo(8, 6);
    expect(ends(s.shape).map(([x, y]) => [x - 5, y - 5])).toEqual([[20, 30], [60, 30]]);
  });

  it('skips stepped floors, short rectangles and round holes', () => {
    expect(topSlots([{ poly: obroundPts(30, 50, 30, 10), z: 6 }, { poly: rectPts(40, 27, 45, 33), z: 4 }])).toEqual([]); // a step inside the floor
    expect(topSlots([{ poly: rectPts(20, 26, 32, 34), z: 7 }])).toEqual([]);
    expect(topSlots([{ poly: Array.from({ length: 64 }, (_, i) => [50 + 5 * Math.cos((i * Math.PI) / 32), 30 + 5 * Math.sin((i * Math.PI) / 32)]), z: 0 }])).toEqual([]);
  });
});
