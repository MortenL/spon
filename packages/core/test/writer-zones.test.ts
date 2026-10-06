import { describe, expect, it } from 'vitest';
import { emitPathOverZones, type Move, MoveWriter, type Path2D, pathFromPoints, type TabZone, v2, vec3 } from '../src';

const FEED = 1000;
const rect = (x0: number, y0: number, x1: number, y1: number) => pathFromPoints([v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)], true);
const zone = (polygon: Path2D, shape: 'rect' | 'triangle' = 'rect', top = -4): TabZone => ({ polygon, top, shape });
const straight = pathFromPoints([v2(0, 0), v2(100, 0)], false);

function run(path: Path2D, z: number, zones: TabZone[], r = 3): Move[] {
  const w = new MoveWriter();
  const s = path.segments[0];
  const start = s.kind === 'line' ? s.from : { x: s.center.x + s.radius * Math.cos(s.startAngle), y: s.center.y + s.radius * Math.sin(s.startAngle) };
  w.rapid(vec3(start.x, start.y, z));
  emitPathOverZones(w, path, z, FEED, zones, r);
  return w.moves.slice(1);
}
const pts = (moves: Move[]) => moves.map((m) => (m.kind === 'cycle' ? null : { x: m.to.x, y: m.to.y, z: m.to.z, kind: m.kind }));

describe('emitPathOverZones', () => {
  it('lifts a straight pass vertically over a rectangular zone grown by the tool radius', () => {
    const moves = pts(run(straight, -6, [zone(rect(45, -20, 55, 20))]));
    expect(moves.map((m) => [+m!.x.toFixed(4), +m!.z.toFixed(4)])).toEqual([
      [42, -6], [42, -4], [58, -4], [58, -6], [100, -6],
    ]);
    expect(moves.every((m) => m!.kind === 'line')).toBe(true);
  });

  it('ramps a triangular zone up to its top at the middle and back down at the edges', () => {
    const moves = pts(run(straight, -6, [zone(rect(45, -20, 55, 20), 'triangle')]));
    expect(moves.map((m) => [+m!.x.toFixed(4), +m!.z.toFixed(4)])).toEqual([[42, -6], [50, -4], [58, -6], [100, -6]]);
  });

  it('splits an arc pass where it enters and leaves a zone', () => {
    const arc: Path2D = { segments: [{ kind: 'arc', center: v2(0, 0), radius: 50, startAngle: 0, sweep: Math.PI }], closed: false };
    const moves = pts(run(arc, -6, [zone(rect(-5, 0, 5, 100))]));
    // the tool (r 3) touches x ∈ [-5, 5] for x ∈ [-8, 8] on the arc
    const lifts = moves.filter((m, i) => i > 0 && m!.kind === 'line');
    expect(lifts).toHaveLength(2);
    expect(lifts[0]!.x).toBeCloseTo(8, 2);
    expect(Math.abs(lifts[0]!.x - 8)).toBeLessThan(0.01);
    expect(Math.abs(lifts[1]!.x + 8)).toBeLessThan(0.01);
    expect(lifts[0]!.z).toBe(-4);
    expect(lifts[1]!.z).toBe(-6);
    for (const m of moves) expect(Math.hypot(m!.x, m!.y)).toBeCloseTo(50, 6);
    expect(moves.filter((m) => m!.kind === 'arc').map((m) => m!.z)).toEqual([-6, -4, -6]);
  });

  it('leaves a pass at or above the zone top unchanged', () => {
    for (const z of [-4, -3]) expect(pts(run(straight, z, [zone(rect(45, -20, 55, 20))]))).toEqual([{ x: 100, y: 0, z, kind: 'line' }]);
  });

  it('merges two overlapping zones into one lift', () => {
    const moves = pts(run(straight, -6, [zone(rect(45, -20, 55, 20)), zone(rect(52, -20, 62, 20))]));
    expect(moves.filter((m, i) => i > 0 && m!.z !== moves[i - 1]!.z && m!.x === moves[i - 1]!.x)).toHaveLength(2);
    expect(moves.map((m) => [+m!.x.toFixed(4), +m!.z.toFixed(4)])).toEqual([[42, -6], [42, -4], [65, -4], [65, -6], [100, -6]]);
  });

  it('keeps each of two overlapping triangular zones whole: never below either triangle', () => {
    const moves = pts(run(straight, -6, [zone(rect(45, -20, 55, 20), 'triangle'), zone(rect(52, -20, 62, 20), 'triangle')]));
    // the first triangle peaks at x 50 (over x 42–58), the second at x 57 (over x 49–65); between the peaks the pass
    // stays at the top, above where the two triangles cross
    expect(moves.map((m) => [+m!.x.toFixed(4), +m!.z.toFixed(4)])).toEqual([
      [42, -6], [49, -4.25], [50, -4], [57, -4], [58, -4.25], [65, -6], [100, -6],
    ]);
    const tri = (x: number, peak: number) => Math.max(-6, -4 - (2 * Math.abs(x - peak)) / 8);
    for (let i = 1; i < moves.length; i++) {
      const a = moves[i - 1]!, b = moves[i]!;
      for (let k = 0; k <= 20; k++) {
        const x = a.x + ((b.x - a.x) * k) / 20, z = a.z + ((b.z - a.z) * k) / 20;
        expect(z).toBeGreaterThanOrEqual(Math.max(tri(x, 50), tri(x, 57)) - 1e-6);
      }
    }
  });

  it('runs at the highest top where zones of different heights overlap', () => {
    const all = pts(run(straight, -6, [zone(rect(45, -20, 55, 20), 'rect', -4), zone(rect(52, -20, 62, 20), 'rect', -2)]));
    // a level stretch may be split where the lower zone ends under the higher one; drop those mid-points
    const moves = all.filter((m, i) => !(i > 0 && i + 1 < all.length && all[i - 1]!.z === m!.z && all[i + 1]!.z === m!.z && all[i + 1]!.x !== m!.x));
    expect(moves.map((m) => [+m!.x.toFixed(4), +m!.z.toFixed(4)])).toEqual([
      [42, -6], [42, -4], [49, -4], [49, -2], [65, -2], [65, -6], [100, -6],
    ]);
  });

  it('ignores zones the tool never reaches', () => {
    expect(pts(run(straight, -6, [zone(rect(45, 10, 55, 20))]))).toEqual([{ x: 100, y: 0, z: -6, kind: 'line' }]);
  });

  it('never ramps down at the seam of a closed pass that starts inside a triangular zone', () => {
    const ring = pathFromPoints([v2(0, 0), v2(100, 0), v2(100, 40), v2(0, 40)], true);
    const moves = pts(run(ring, -6, [zone(rect(-5, -20, 5, 20), 'triangle')]));
    // the tool touches the zone over x ∈ [0, 8] at the start and y ∈ [0, 20 + 3] on the way back down the left side
    expect(moves[0]).toMatchObject({ x: 0, y: 0, z: -4 });
    expect(moves.at(-1)).toMatchObject({ x: 0, y: 0 });
    expect(moves.at(-1)!.z).toBeCloseTo(-4, 9);
    expect(moves.slice(0, 3).map((m) => [+m!.x.toFixed(4), +m!.y.toFixed(4), +m!.z.toFixed(4)])).toEqual([[0, 0, -4], [8, 0, -4], [8, 0, -6]]);
    expect(moves.slice(-3).map((m) => [+m!.x.toFixed(4), +m!.y.toFixed(4), +m!.z.toFixed(4)])).toEqual([[0, 23, -6], [0, 23, -4], [0, 0, -4]]);
  });
});
