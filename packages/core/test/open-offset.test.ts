import { describe, expect, it } from 'vitest';
import { flattenPath, nearestS, type Path2D, pathFromPoints, pathLength, segmentEnd, segmentStart, type Vec2 } from '../src';
import { type OpenOffset, offsetOpenPath } from '../src/geometry/offset/openOffset';

const L: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }], false);
const tol = 0.01;
const P = (a: number[][]): Path2D => pathFromPoints(a.map(([x, y]) => ({ x, y })), false);

function check(line: Path2D, lap: Path2D, distance: number) {
  for (const p of flattenPath(lap, 0.001)) {
    const d = nearestS(line, p).distance;
    expect(d).toBeGreaterThanOrEqual(distance - 1e-6); // never closer than requested (the line is the part's edge)
    expect(d).toBeLessThanOrEqual(distance + tol + 1e-6);
  }
}
const checkAll = (line: Path2D, r: OpenOffset, distance: number) => r.paths.forEach((p) => check(line, p, distance));
const first = (r: OpenOffset) => segmentStart(r.paths[0].segments[0]);
const last = (r: OpenOffset) => segmentEnd(r.paths.at(-1)!.segments.at(-1)!);
const total = (r: OpenOffset) => r.paths.reduce((sum, p) => sum + pathLength(p), 0);

/**
 * No point of the result sits on an end cap: none lies behind an end of the line (along its end edge) unless the
 * rest of the line is just as near (where the tool touches the end and another edge at once).
 */
function withinEnds(line: Path2D, r: OpenOffset) {
  const pts = flattenPath(line, 0.001);
  const P2 = (q: Vec2[]) => pathFromPoints(q, false);
  const [head, tail] = [P2(pts.slice(1)), P2(pts.slice(0, -1))];
  const [a, a1, b0, b] = [pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]];
  const along = (p: Vec2, o: Vec2, q: Vec2) => ((p.x - o.x) * (q.x - o.x) + (p.y - o.y) * (q.y - o.y)) / Math.hypot(q.x - o.x, q.y - o.y);
  const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
  for (const lap of r.paths) {
    for (const p of flattenPath(lap, 0.001)) {
      // within tol: the clip boundary where a piece starts at the end disc
      if (along(p, a, a1) < -1e-6) expect(nearestS(head, p).distance).toBeLessThanOrEqual(dist(p, a) + tol);
      if (along(p, b, b0) < -1e-6) expect(nearestS(tail, p).distance).toBeLessThanOrEqual(dist(p, b) + tol);
    }
  }
}

describe('offsetOpenPath', () => {
  it('offsets to the left and right of the drawn direction', () => {
    const left = offsetOpenPath(L, 'left', 3, tol)!;
    const right = offsetOpenPath(L, 'right', 3, tol)!;
    expect(left.paths).toHaveLength(1);
    expect(right.paths).toHaveLength(1);
    // going +X first: left is +Y, right is −Y
    expect(first(left).y).toBeCloseTo(3, 2);
    expect(first(right).y).toBeCloseTo(-3, 2);
    // both follow the line's direction: they start near x = 0 and end near y = 30
    expect(first(left).x).toBeCloseTo(0, 1);
    expect(last(left).y).toBeCloseTo(30, 1);
    checkAll(L, left, 3);
    checkAll(L, right, 3);
    withinEnds(L, left);
    withinEnds(L, right);
    expect(left.rounded || right.rounded).toBe(false);
    // the inside of the corner is shorter, the outside longer (round join)
    expect(total(left)).toBeLessThan(pathLength(L));
    expect(total(right)).toBeGreaterThan(pathLength(L));
  });

  it('keeps an arc an arc', () => {
    const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 20, startAngle: 0, sweep: Math.PI / 2 }] };
    const out = offsetOpenPath(arc, 'right', 2, tol)!; // right of a CCW arc is outward
    expect(out.paths[0].segments.some((s) => s.kind === 'arc')).toBe(true);
    checkAll(arc, out, 2);
  });

  it('gives nothing inside a U-turn too narrow for the tool, and follows its outside (review focus 4)', () => {
    // a U-turn 4 mm wide; a 3 mm offset to the inside cannot enter it
    const u = P([[0, 0], [30, 0], [30, 4], [0, 4]]);
    expect(offsetOpenPath(u, 'left', 3, tol)).toBeNull();
    const outside = offsetOpenPath(u, 'right', 3, tol)!;
    expect(outside.rounded).toBe(false);
    expect(outside.paths).toHaveLength(1);
    checkAll(u, outside, 3);
    withinEnds(u, outside);
    const tightArc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 2, startAngle: 0, sweep: Math.PI }] };
    const r = offsetOpenPath(tightArc, 'left', 3, tol); // left of a CCW arc is toward the centre
    if (r) {
      expect(r.rounded).toBe(true);
      checkAll(tightArc, r, 3);
    }
  });

  it('flags a slot narrower than the tool, but not inside corners it can reach', () => {
    // a hook: the 4 mm U-turn is lost, the rest of the line is still followed
    const hook = P([[0, 0], [30, 0], [30, 4], [10, 4], [10, 30]]);
    const h = offsetOpenPath(hook, 'left', 3, tol)!;
    expect(h.rounded).toBe(true);
    expect(last(h).y).toBeCloseTo(30, 1);
    checkAll(hook, h, 3);
    // a U-turn 6.5 mm wide: two inside corners the 3 mm offset still fits between
    const wide = P([[0, 0], [30, 0], [30, 6.5], [0, 6.5]]);
    const w = offsetOpenPath(wide, 'left', 3, tol)!;
    expect(w.rounded).toBe(false);
    expect(w.paths).toHaveLength(1);
    checkAll(wide, w, 3);
    // a notch with a 2 mm floor: too narrow from above, a plain bump from below
    const notch = P([[0, 0], [10, 0], [12, -5], [14, -5], [16, 0], [30, 0]]);
    expect(offsetOpenPath(notch, 'left', 3, tol)!.rounded).toBe(true);
    expect(offsetOpenPath(notch, 'right', 3, tol)!.rounded).toBe(false);
  });

  it('starts and ends level with the ends of a curved line', () => {
    const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 20, startAngle: 0, sweep: Math.PI / 2 }] };
    for (const side of ['left', 'right'] as const) {
      const out = offsetOpenPath(arc, side, 2, tol)!;
      expect(Math.abs(first(out).y)).toBeLessThan(0.05);
      expect(Math.abs(last(out).x)).toBeLessThan(0.05);
      expect(out.rounded).toBe(false);
      withinEnds(arc, out);
    }
  });

  it('keeps cutting past a short first edge that the tool cannot follow', () => {
    // the 2 mm first edge is too short for a 3 mm offset to its right; the 20 mm edge after it is still cut. Only
    // the inside corner between them is lost, as at any inside corner, so this is not a rounded bend.
    const line = P([[0, 0], [0, 2], [20, 2], [20, 30]]);
    const r = offsetOpenPath(line, 'right', 3, tol)!;
    expect(r.rounded).toBe(false);
    expect(r.paths).toHaveLength(1);
    expect(first(r).x).toBeGreaterThan(2.8);
    expect(first(r).x).toBeLessThan(3);
    expect(first(r).y).toBeCloseTo(-1, 1);
    expect(last(r).x).toBeCloseTo(23, 1);
    expect(last(r).y).toBeCloseTo(30, 1);
    checkAll(line, r, 3);
    withinEnds(line, r);
    // nothing invented around the ends of a short hook
    const hook = P([[0, 0], [0, 2], [20, 2]]);
    const h = offsetOpenPath(hook, 'right', 3, tol)!;
    expect(h.rounded).toBe(false);
    expect(first(h).x).toBeGreaterThan(2.8);
    expect(last(h).x).toBeCloseTo(20, 2);
    checkAll(hook, h, 3);
    withinEnds(hook, h);
  });

  it('offsets a nearly closed arc on both sides, and the inside of a loop', () => {
    const C: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 20, startAngle: 0.1, sweep: 2 * Math.PI - 0.2 }] };
    for (const side of ['left', 'right'] as const) {
      const r = offsetOpenPath(C, side, 3, tol)!;
      expect(r).not.toBeNull();
      expect(r.rounded).toBe(false);
      expect(r.paths).toHaveLength(1);
      expect(total(r)).toBeCloseTo((side === 'left' ? 17 : 23) * (2 * Math.PI - 0.2), 0);
      checkAll(C, r, 3);
    }
    // a lollipop: the 4 mm stem is too narrow, the 40 mm loop is not
    const lolli = P([[0, 0], [20, 0], [20, -20], [60, -20], [60, 20], [20, 20], [20, 4], [0, 4]]);
    const r = offsetOpenPath(lolli, 'left', 3, tol)!;
    expect(r.rounded).toBe(true);
    expect(Math.max(...r.paths.map(pathLength))).toBeGreaterThan(100);
    checkAll(lolli, r, 3);
  });

  it('follows a spiral whose turns leave room, and says so when they do not', () => {
    const pts: number[][] = [];
    for (let i = 0; i <= 400; i++) {
      const a = i * 0.05, r = 2 + 0.6 * a;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const spiral = P(pts);
    // turns 3.77 mm apart: 1 mm to the outside fits all the way round
    const loose = offsetOpenPath(spiral, 'right', 1, tol)!;
    expect(loose.rounded).toBe(false);
    expect(loose.paths).toHaveLength(1);
    checkAll(spiral, loose, 1);
    // 3 mm does not fit between the turns: only the outermost turn's outside is left
    const tight = offsetOpenPath(spiral, 'right', 3, tol)!;
    expect(tight.rounded).toBe(true);
    expect(total(tight)).toBeGreaterThan(2 * Math.PI * 14.5); // ~ the last turn, radius 14 + 3
    checkAll(spiral, tight, 3);
  });

  it('handles a long polyline quickly', () => {
    const pts: number[][] = [];
    for (let i = 0; i <= 5000; i++) pts.push([i * 0.1, 5 * Math.sin(i * 0.02)]);
    const sine = P(pts);
    const t0 = performance.now();
    const r = offsetOpenPath(sine, 'left', 1, tol)!;
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.rounded).toBe(false);
    expect(r.paths).toHaveLength(1);
  });
});
