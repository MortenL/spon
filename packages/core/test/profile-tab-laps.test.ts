import { describe, expect, it } from 'vitest';
import {
  applyCommand, autoStart, contourLaps, lapRunsCW, MIGRATIONS, orientPath, pathLength, pointAt, rotateStart, camContext, type Move, newOperation, type OpOverlays, pathFromPoints, type ProfileOp, profileToolpath, type ResolvedContour, reversePath, startOffTabs,
  type TabSettings, type Vec2,
} from '../src';
import { camPartSetup, geoOf, rectPath, tool6 } from './fixtures/camSetup';

const { job, geometry } = camPartSetup(); // stock top 0, bottom -6
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: tool6 }), geometry);
const R = tool6.diameter / 2;
const WIDTH = 4;
const noLeads = { mode: 'none' as const, length: 0, startPoint: 'auto' as const };
const tabs = (patch: Partial<TabSettings> = {}): TabSettings =>
  ({ enabled: true, shape: 'rect', width: WIDTH, height: 2, placement: 'count', count: 4, spacing: 50, manual: [], ...patch });
const profile = (patch: Partial<ProfileOp> = {}): ProfileOp =>
  ({ ...(newOperation('profile', { id: 'p', name: 'Profile', tool: tool6, modelKind: 'drawing' }) as ProfileOp), leads: noLeads, ...patch });
const run = (patch: Partial<ProfileOp>, contours: ResolvedContour[]) => profileToolpath(profile(patch), tool6, ctx, geoOf({ contours }));

/** Points along every move (lines every 0.1 mm, arcs every 2°), with Z. */
function samples(moves: readonly Move[]): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of moves) {
    if (m.kind === 'cycle') continue;
    const to = m.to;
    if (prev && m.kind === 'arc') {
      const a0 = Math.atan2(prev.y - m.center.y, prev.x - m.center.x);
      let a1 = Math.atan2(to.y - m.center.y, to.x - m.center.x);
      const rad = Math.hypot(prev.x - m.center.x, prev.y - m.center.y);
      if (m.ccw) { while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI; } else { while (a1 >= a0 - 1e-12) a1 -= 2 * Math.PI; }
      const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 90)));
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push({ x: m.center.x + rad * Math.cos(a), y: m.center.y + rad * Math.sin(a), z: prev.z + ((to.z - prev.z) * i) / n });
      }
    } else if (prev) {
      const len = Math.hypot(to.x - prev.x, to.y - prev.y, to.z - prev.z);
      const n = Math.max(1, Math.ceil(len / 0.1));
      for (let i = 0; i <= n; i++) out.push({ x: prev.x + ((to.x - prev.x) * i) / n, y: prev.y + ((to.y - prev.y) * i) / n, z: prev.z + ((to.z - prev.z) * i) / n });
    } else out.push(to);
    prev = to;
  }
  return out;
}

/**
 * The material each tab leaves: `width` along the tab path (the first roughing lap) and the roughing kerf across it
 * (a tool radius either side of the lap), as a centre, the lap's direction there and its normal.
 */
function tabMaterial(overlays: OpOverlays): { c: Vec2; t: Vec2; n: Vec2 }[] {
  return overlays.tabs.map((tab) => {
    const lap = overlays.tabPaths.find((p) => p.refIndex === tab.refIndex)!;
    const pts = lap.points;
    const edges = lap.closed ? pts.length : pts.length - 1;
    let best = Infinity, t = { x: 1, y: 0 };
    for (let i = 0; i < edges; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
      if (!(l > 0)) continue;
      const u = Math.max(0, Math.min(1, ((tab.point.x - a.x) * dx + (tab.point.y - a.y) * dy) / (l * l)));
      const d = Math.hypot(tab.point.x - a.x - dx * u, tab.point.y - a.y - dy * u);
      if (d < best) { best = d; t = { x: dx / l, y: dy / l }; }
    }
    return { c: tab.point, t, n: { x: -t.y, y: t.x } };
  });
}

/** Points where the tool (radius R) cuts into a tab's material below the tab top. */
function intoTabs(moves: readonly Move[], overlays: OpOverlays): { x: number; y: number; z: number }[] {
  const top = overlays.tabPaths[0].z;
  const mats = tabMaterial(overlays);
  return samples(moves).filter((p) => p.z < top - 1e-6 && mats.some((m) => {
    const dx = p.x - m.c.x, dy = p.y - m.c.y;
    const u = Math.max(0, Math.abs(dx * m.t.x + dy * m.t.y) - WIDTH / 2);
    const v = Math.max(0, Math.abs(dx * m.n.x + dy * m.n.y) - R);
    return Math.hypot(u, v) < R - 1e-3;
  }));
}

const rect: ResolvedContour = { path: rectPath(10, 10, 110, 70), z: 0, ref: 0 };
const ell: ResolvedContour = {
  path: pathFromPoints([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 80 }, { x: 10, y: 80 }], true), z: 0, ref: 0,
};
const line: ResolvedContour = { path: pathFromPoints([{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }], false), z: 0, ref: 0 };

describe('profile tabs on later laps', () => {
  for (const [name, contour, patch] of [
    ['a rectangle', rect, {}],
    ['a rectangle, conventional', rect, { direction: 'conventional' }],
    ['an L-shape', ell, {}],
    ['an open line', line, { openSide: 'left' }],
  ] as const) {
    for (const stockRadial of [0.2, 0.5, 1]) {
      it(`keeps the finish pass out of the automatic tabs on ${name} (stock ${stockRadial} mm)`, () => {
        const out = run({ ...patch, finishPass: true, stockRadial, tabs: tabs({ count: contour.path.closed ? 4 : 2 }) }, [contour]);
        expect(out.diagnostics.filter((d) => d.severity !== 'info' && d.code !== 'entry-plunge')).toEqual([]);
        expect(out.overlays.tabs.length).toBeGreaterThan(0);
        expect(intoTabs(out.toolpath!.moves, out.overlays)).toEqual([]);
      });
    }
  }

  it('keeps the finish pass out of manual tabs', () => {
    // (away from inner corners: a manual tab beside one is nicked by the other leg's pass, as before)
    for (const [contour, t] of [[rect, [0.1, 0.3, 0.55, 0.8]], [ell, [0.05, 0.35, 0.7, 0.8]], [line, [0.3, 0.85]]] as const) {
      const out = run({ openSide: 'left', finishPass: true, stockRadial: 0.5, tabs: tabs({ manual: [{ refIndex: 0, t: [...t] }] }) }, [contour]);
      expect(out.overlays.tabs).toHaveLength(t.length);
      expect(intoTabs(out.toolpath!.moves, out.overlays)).toEqual([]);
    }
  });

  it('enters every lap off the tabs, with a plunge or a lead', () => {
    for (const contour of [rect, ell]) {
      for (const extra of [{ entry: { ...profile().entry, mode: 'plunge' as const } }, { leads: { mode: 'arc' as const, length: 3, startPoint: 'auto' as const } }]) {
        // tabs on every side: the automatic start of some lap falls on one
        const out = run({ ...extra, finishPass: true, stockRadial: 0.5, tabs: tabs({ count: 8 }) }, [contour]);
        expect(out.overlays.tabs.length).toBeGreaterThan(4);
        expect(intoTabs(out.toolpath!.moves, out.overlays)).toEqual([]);
      }
    }
  });
});

describe('startOffTabs', () => {
  it('keeps a free start and moves one on a tab to the nearer end of it', () => {
    expect(startOffTabs(50, [10, 90], 5, 100)).toBe(50);
    expect(startOffTabs(12, [10, 90], 5, 100)).toBe(15);
    expect(startOffTabs(8, [10, 90], 5, 100)).toBe(5);
    expect(startOffTabs(98, [10, 2], 5, 100)).toBe(97); // across the seam
  });

  it('steps past touching tabs and gives up when the tabs cover the lap', () => {
    expect(startOffTabs(11, [10, 18], 5, 100)).toBe(5);
    expect(startOffTabs(16, [10, 18], 5, 100)).toBe(23);
    expect(startOffTabs(3, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 6, 100)).toBe(3);
  });
});

/** Whether the tool passes over `p` at the tab top `z` (it rose over the tab there). */
const liftsAt = (moves: readonly Move[], p: Vec2, z: number) => samples(moves).some((q) => Math.abs(q.z - z) < 1e-6 && Math.hypot(q.x - p.x, q.y - p.y) < 0.06);

describe('profile tab positions', () => {
  const at = (patch: Partial<ProfileOp>, contour: ResolvedContour) => {
    const out = run(patch, [contour]);
    const top = out.overlays.tabPaths[0].z;
    expect(intoTabs(out.toolpath!.moves, out.overlays)).toEqual([]);
    for (const tab of out.overlays.tabs) expect(liftsAt(out.toolpath!.moves, tab.point, top)).toBe(true);
    return out.overlays.tabs.map((tab) => ({ t: tab.t, x: tab.point.x, y: tab.point.y }));
  };
  const same = (a: { t: number; x: number; y: number }[], b: { t: number; x: number; y: number }[]) => {
    expect(b).toHaveLength(a.length);
    a.forEach((p, i) => {
      expect(b[i].t).toBeCloseTo(p.t, 6);
      // laps offset to either side of a line agree within the tolerance
      expect(b[i].x).toBeCloseTo(p.x, 3);
      expect(b[i].y).toBeCloseTo(p.y, 3);
    });
  };
  const start = (t: number) => ({ mode: 'none' as const, length: 0, startPoint: { refIndex: 0, t } });

  it('keeps manual tabs on a closed contour in place when the direction or the lead start point changes', () => {
    for (const contour of [rect, ell]) {
      const manual = tabs({ manual: [{ refIndex: 0, t: [0.1, 0.45, 0.8] }] });
      const base = at({ tabs: manual }, contour);
      same(base, at({ tabs: manual, direction: 'conventional' }, contour));
      same(base, at({ tabs: manual, leads: start(0.3) }, contour));
      same(base, at({ tabs: manual, leads: start(0.77), direction: 'conventional' }, contour));
      same(base, at({ tabs: manual, leads: start(0.1) }, contour)); // a start on a tab moves off it
    }
  });

  it('places automatic tabs on a closed contour the same whichever way it is cut', () => {
    for (const contour of [rect, ell]) {
      const base = at({ tabs: tabs({ count: 3 }) }, contour);
      same(base, at({ tabs: tabs({ count: 3 }), direction: 'conventional' }, contour));
      same(base, at({ tabs: tabs({ count: 3 }), leads: start(0.4) }, contour));
    }
  });

  it('measures the tabs of a closed contour counter-clockwise', () => {
    const [a, b] = at({ tabs: tabs({ manual: [{ refIndex: 0, t: [0.1, 0.2] }] }) }, rect);
    // counter-clockwise around the centre (60, 40): the angle grows from the first tab to the second
    const ang = (p: { x: number; y: number }) => Math.atan2(p.y - 40, p.x - 60);
    const d = ang(b) - ang(a);
    expect(Math.sin(d)).toBeGreaterThan(0);
  });

  it('keeps manual tabs on an open line in place when the direction or Reverse changes', () => {
    const manual = tabs({ manual: [{ refIndex: 0, t: [0.25, 0.85] }] });
    const reversed: ResolvedContour = { ...line, path: reversePath(line.path), reversed: true };
    for (const openSide of ['left', 'right', 'on'] as const) {
      const base = at({ tabs: manual, openSide }, line);
      same(base, at({ tabs: manual, openSide, direction: 'conventional' }, line));
      // measured from the line's drawn start: Reverse cuts the other side of the line, at the same places along it
      const flipped = { left: 'right', right: 'left', on: 'on' } as const;
      same(base, at({ tabs: manual, openSide: flipped[openSide] }, reversed));
      same(base, at({ tabs: manual, openSide: flipped[openSide], direction: 'conventional' }, reversed));
    }
  });
});

describe('schema 9 tab positions', () => {
  it('stay where they were after the migration', () => {
    // a rectangle's two long edges tie for the automatic start: a counter-clockwise schema 9 lap (conventional, outside)
    // started on the other one, which the migration cannot tell without the geometry
    for (const [contour, direction] of [[rect, 'climb'], [ell, 'climb'], [ell, 'conventional']] as const) {
      {
        // schema 9 measured a contour's tabs along its first lap as cut: oriented for the direction, from the automatic start
        const lap = contourLaps(contour.path, 'outside', 'on', direction, R, ctx.tolerance)!.laps[0];
        let old = orientPath(lap, !lapRunsCW('outside', direction));
        old = rotateStart(old, autoStart(old));
        const ts = [0.2, 0.45];
        const before = ts.map((t) => pointAt(old, t * pathLength(old)).point);
        const v9 = { operations: [{ type: 'profile', side: 'outside', direction, leads: noLeads, tabs: { ...tabs(), manual: undefined, positions: ts.map((t) => ({ refIndex: 0, t })) } }], tools: [] };
        const migrated = (MIGRATIONS[9](v9).operations as ProfileOp[])[0];
        const out = run({ direction, tabs: { ...tabs(), manual: migrated.tabs.manual } }, [contour]);
        const after = out.overlays.tabs.map((t) => t.point).sort((a, b) => a.x - b.x || a.y - b.y);
        before.sort((a, b) => a.x - b.x || a.y - b.y).forEach((p, i) => {
          expect(after[i].x).toBeCloseTo(p.x, 6);
          expect(after[i].y).toBeCloseTo(p.y, 6);
        });
      }
    }
  });
});
