import { describe, expect, it } from 'vitest';
import { flattenPath, nearestS, type Path2D, pathFromPoints, pathLength, segmentEnd, segmentStart } from '../src';
import { offsetOpenPath } from '../src/geometry/offset/openOffset';

const L: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }], false);
const tol = 0.01;

function check(line: Path2D, lap: Path2D, distance: number) {
  for (const p of flattenPath(lap, 0.001)) {
    const d = nearestS(line, p).distance;
    expect(d).toBeGreaterThanOrEqual(distance - 1e-6); // never closer than requested (the line is the part's edge)
    expect(d).toBeLessThanOrEqual(distance + tol + 1e-6);
  }
}

describe('offsetOpenPath', () => {
  it('offsets to the left and right of the drawn direction', () => {
    const left = offsetOpenPath(L, 'left', 3, tol)!;
    const right = offsetOpenPath(L, 'right', 3, tol)!;
    // going +X first: left is +Y, right is −Y
    expect(segmentStart(left.path.segments[0]).y).toBeCloseTo(3, 2);
    expect(segmentStart(right.path.segments[0]).y).toBeCloseTo(-3, 2);
    // both follow the line's direction: they start near x = 0 and end near y = 30
    expect(segmentStart(left.path.segments[0]).x).toBeCloseTo(0, 1);
    expect(segmentEnd(left.path.segments.at(-1)!).y).toBeCloseTo(30, 1);
    check(L, left.path, 3);
    check(L, right.path, 3);
    expect(left.rounded || right.rounded).toBe(false);
    // the inside of the corner is shorter, the outside longer (round join)
    expect(pathLength(left.path)).toBeLessThan(pathLength(L));
    expect(pathLength(right.path)).toBeGreaterThan(pathLength(L));
  });

  it('keeps an arc an arc', () => {
    const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 20, startAngle: 0, sweep: Math.PI / 2 }] };
    const out = offsetOpenPath(arc, 'right', 2, tol)!; // right of a CCW arc is outward
    expect(out.path.segments.some((s) => s.kind === 'arc')).toBe(true);
    check(arc, out.path, 2);
  });

  it('trims a bend that is too tight for the tool and says so (review focus 4)', () => {
    // a U-turn 4 mm wide; offsetting 3 mm to the inside cannot follow it
    const u: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 4 }, { x: 0, y: 4 }], false);
    const inside = offsetOpenPath(u, 'left', 3, tol);
    expect(inside).not.toBeNull();
    expect(inside!.rounded).toBe(true);
    check(u, inside!.path, 3);
    const tightArc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 2, startAngle: 0, sweep: Math.PI }] };
    const r = offsetOpenPath(tightArc, 'left', 3, tol); // left of a CCW arc is toward the centre
    if (r) {
      expect(r.rounded).toBe(true);
      check(tightArc, r.path, 3);
    }
  });

  it('flags a slot narrower than the tool, but not inside corners it can reach', () => {
    // a hook: the 4 mm U-turn is swallowed, the rest of the line is still followed
    const hook: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 4 }, { x: 10, y: 4 }, { x: 10, y: 30 }], false);
    const h = offsetOpenPath(hook, 'left', 3, tol)!;
    expect(h.rounded).toBe(true);
    expect(segmentEnd(h.path.segments.at(-1)!).y).toBeCloseTo(30, 1);
    check(hook, h.path, 3);
    // a U-turn 6.5 mm wide: two inside corners the 3 mm offset still fits between
    const wide: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 6.5 }, { x: 0, y: 6.5 }], false);
    const w = offsetOpenPath(wide, 'left', 3, tol)!;
    expect(w.rounded).toBe(false);
    check(wide, w.path, 3);
    // a notch with a 2 mm floor: too narrow from above, a plain bump from below
    const notch: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: -5 }, { x: 14, y: -5 }, { x: 16, y: 0 }, { x: 30, y: 0 }], false);
    expect(offsetOpenPath(notch, 'left', 3, tol)!.rounded).toBe(true);
    expect(offsetOpenPath(notch, 'right', 3, tol)!.rounded).toBe(false);
  });

  it('starts and ends level with the ends of a curved line', () => {
    const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 20, startAngle: 0, sweep: Math.PI / 2 }] };
    for (const side of ['left', 'right'] as const) {
      const out = offsetOpenPath(arc, side, 2, tol)!;
      expect(Math.abs(segmentStart(out.path.segments[0]).y)).toBeLessThan(0.05);
      expect(Math.abs(segmentEnd(out.path.segments.at(-1)!).x)).toBeLessThan(0.05);
      expect(out.rounded).toBe(false);
    }
  });
});
