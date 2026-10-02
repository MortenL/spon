import { describe, expect, it } from 'vitest';
import { camContext, closedSlotOf, faceGeometry, faceRegion, fitArcs, type Path2D, slotShapeOf } from '../src';
import { faceAt } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { arcSlotPts, obroundPts, rectPts } from './fixtures/terraced.mjs';

const plate = rectPts(0, 0, 100, 60);
/** A loop as faceGeometry gives it: points fitted with lines and arcs. */
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
    const r = slotShapeOf(loopOf(rectPts(0, 0, 40, 8)), 0.01)!;
    expect(r).toMatchObject({ kind: 'line', ends: ['square', 'square'] });
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
    expect(topSlots([{ poly: obroundPts(30, 50, 30, 10, 8), z: 4 }])).toHaveLength(1);
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
  });

  it('skips stepped floors, short rectangles and round holes', () => {
    expect(topSlots([{ poly: obroundPts(30, 50, 30, 10), z: 6 }, { poly: rectPts(40, 27, 45, 33), z: 4 }])).toEqual([]); // a step inside the floor
    expect(topSlots([{ poly: rectPts(20, 26, 32, 34), z: 7 }])).toEqual([]);
    expect(topSlots([{ poly: Array.from({ length: 64 }, (_, i) => [50 + 5 * Math.cos((i * Math.PI) / 32), 30 + 5 * Math.sin((i * Math.PI) / 32)]), z: 0 }])).toEqual([]);
  });
});
