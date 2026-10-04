import { describe, expect, it } from 'vitest';
import { flattenPath, importFile, shapesToSvg, type Vec2 } from '../src';

const roundTrip = (loops: Vec2[][]): Vec2[][] => {
  const r = importFile('x.svg', new TextEncoder().encode(shapesToSvg(loops)), { svgScale: 1 });
  if (!r.ok || r.kind !== 'drawing') throw new Error('did not import');
  return r.drawing.layers.flatMap((l) => l.paths).map((p) => flattenPath(p, 0.001));
};
const expectSame = (got: Vec2[][], want: Vec2[][]) => {
  expect(got).toHaveLength(want.length);
  want.forEach((loop, i) => {
    // the closing point may repeat the first
    const g = got[i].length === loop.length + 1 ? got[i].slice(0, -1) : got[i];
    expect(g).toHaveLength(loop.length);
    loop.forEach((p, k) => {
      expect(g[k].x).toBeCloseTo(p.x, 6);
      expect(g[k].y).toBeCloseTo(p.y, 6);
    });
  });
};
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe('shapesToSvg', () => {
  it('imports a rectangle back at the same coordinates', () => {
    const loops = [rect(10, 5, 40.25, 25.5)];
    expectSame(roundTrip(loops), loops);
  });

  it('imports a ring (outer and hole) back at the same coordinates', () => {
    const loops = [rect(0, 0, 30, 20), rect(8, 6, 22, 14).reverse()];
    expectSame(roundTrip(loops), loops);
  });

  it('keeps an asymmetric L-shape in place', () => {
    const l: Vec2[] = [{ x: 2, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 20 }, { x: 2, y: 20 }];
    expectSame(roundTrip([l]), [l]);
  });
});
