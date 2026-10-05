import { describe, expect, it } from 'vitest';
import {
  applyCommand, camContext, contourTabs, newOperation, pathLength, type ProfileOp, profileToolpath, type ResolvedContour, tabIntervals, type TabSettings, type Tool,
} from '../src';
import { camPartSetup, cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';

const { job, geometry } = camPartSetup(); // stock top 0, bottom -6
const toolOf = (diameter: number): Tool => ({ ...tool6, id: `t${diameter}`, diameter });
const ctxOf = (tool: Tool) => camContext(applyCommand(job, { type: 'addTool', tool }), geometry);
const noLeads = { mode: 'none' as const, length: 0, startPoint: 'auto' as const };
const tabs = (patch: Partial<TabSettings> = {}): TabSettings =>
  ({ enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, manual: [], ...patch });
const profile = (tool: Tool, patch: Partial<ProfileOp> = {}): ProfileOp =>
  ({ ...(newOperation('profile', { id: 'p', name: 'Profile', tool, modelKind: 'drawing' }) as ProfileOp), leads: noLeads, ...patch });
const c0: ResolvedContour = { path: rectPath(5, 5, 45, 25), z: 0, ref: 0 };
const c1: ResolvedContour = { path: rectPath(55, 5, 95, 25), z: 0, ref: 1 };
const run = (patch: Partial<ProfileOp>, contours: ResolvedContour[], tool = tool6) =>
  profileToolpath(profile(tool, patch), tool, ctxOf(tool), geoOf({ contours }));

describe('contour tabs', () => {
  it('uses the manual entry for its contour and automatic placement elsewhere', () => {
    const out = run({ tabs: tabs({ manual: [{ refIndex: 1, t: [0.5] }] }) }, [c0, c1]);
    expect(out.diagnostics).toEqual([]);
    expect(out.overlays.tabs.filter((t) => t.refIndex === 0)).toHaveLength(4);
    expect(out.overlays.tabs.filter((t) => t.refIndex === 0).every((t) => !t.manual)).toBe(true);
    expect(out.overlays.tabs.filter((t) => t.refIndex === 1)).toMatchObject([{ index: 0, manual: true }]);
    expect(out.overlays.tabPaths.map((p) => [p.refIndex, p.closed])).toEqual([[0, true], [1, true]]);
  });

  it('ignores manual entries for contours that no longer exist', () => {
    const out = run({ tabs: tabs({ manual: [{ refIndex: 5, t: [0.5] }] }) }, [c0]);
    expect(out.diagnostics).toEqual([]);
    expect(out.overlays.tabs).toHaveLength(4);
    expect(out.overlays.tabs.every((t) => !t.manual)).toBe(true);
  });

  it('gives a contour with an empty manual list no tabs and no warning, but still a tab path', () => {
    const out = run({ tabs: tabs({ manual: [{ refIndex: 0, t: [] }] }) }, [c0, c1]);
    expect(out.diagnostics).toEqual([]);
    expect(out.overlays.tabs.filter((t) => t.refIndex === 0)).toHaveLength(0);
    expect(out.overlays.tabs.filter((t) => t.refIndex === 1)).toHaveLength(4);
    expect(out.overlays.tabPaths.map((p) => p.refIndex)).toEqual([0, 1]);
  });

  it('uses the first entry when two share a contour', () => {
    const r = contourTabs(c0.path, tabs({ manual: [{ refIndex: 0, t: [0.25] }, { refIndex: 0, t: [0.5, 0.75] }] }), 3, 0);
    expect(r.manual).toBe(true);
    expect(r.intervals).toHaveLength(1);
  });

  it('keeps manual fractions when the tool changes', () => {
    const at = (d: number) => {
      const out = run({ tabs: tabs({ manual: [{ refIndex: 0, t: [0.5] }] }) }, [c0], toolOf(d));
      expect(out.diagnostics).toEqual([]);
      return out.overlays.tabs[0].t;
    };
    expect(Math.abs(at(3) - at(10))).toBeLessThan(0.01);
    expect(at(3)).toBeCloseTo(0.5, 2);
  });

  it('clamps a manual tab that no longer fits at its place inside the lap, not dropping it', () => {
    const half = 2 + 3;
    const { intervals, skipped } = tabIntervals(c0.path, tabs(), 3, [0, 1]);
    const total = pathLength(c0.path);
    expect(skipped).toBe(0);
    expect(intervals.map((i) => i.center)).toEqual([half, total - half]);
  });

  it('skips a tab that does not fit on a tiny contour', () => {
    // on the line, a 2 x 2 mm square has a lap of 8 mm, shorter than the tab (4 mm wide + 6 mm tool)
    const tiny: ResolvedContour = { path: rectPath(20, 20, 22, 22), z: 0, ref: 0 };
    const out = run({ side: 'on', tabs: tabs({ manual: [{ refIndex: 0, t: [0.5] }] }) }, [tiny]);
    expect(out.diagnostics).toMatchObject([{ severity: 'warning', code: 'tab-skipped' }]);
    expect(out.overlays.tabs).toEqual([]);
    for (const m of out.toolpath!.moves) if ('to' in m) expect([m.to.x, m.to.y, m.to.z].every(Number.isFinite)).toBe(true);
    const r = tabIntervals(tiny.path, tabs(), 3, [0.5]);
    expect(r).toEqual({ intervals: [], skipped: 1 });
  });

  it('skips manual positions that are not numbers', () => {
    expect(tabIntervals(c0.path, tabs(), 3, [Number.NaN, 0.5])).toMatchObject({ skipped: 1, intervals: [{ center: pathLength(c0.path) / 2 }] });
  });

  it('cuts the level at the tab top normally and lifts over tabs below it', () => {
    const base = profile(tool6);
    const out = run({
      heights: { ...base.heights, bottom: { from: 'stockBottom', offset: 0 } }, stepdown: 2, entry: { ...base.entry, mode: 'plunge' },
      tabs: tabs({ manual: [{ refIndex: 0, t: [0.5] }] }),
    }, [c0]);
    expect(out.diagnostics).toEqual([]);
    const cuts = cutMoves(out.toolpath!.moves);
    // levels -2, -4 (the tab top) and -6: nothing rises above the first level
    expect([...new Set(cuts.map((m) => +m.to.z.toFixed(4)))].sort((a, b) => a - b)).toEqual([-6, -4, -2]);
    // the level at -4 is a plain lap, exactly as long as the level at -2
    const first = (z: number) => cuts.findIndex((m) => Math.abs(m.to.z - z) < 1e-6);
    const level2 = cuts.slice(0, first(-4)).length, level4 = cuts.slice(first(-4), first(-6)).length;
    expect(level4).toBe(level2);
    // the bottom level lifts to -4 and back down around the tab
    expect(cuts.length - first(-6)).toBeGreaterThanOrEqual(level2 + 2);
  });

  it('gives every piece of a split contour no tabs when its manual list is empty', () => {
    // two 30 mm squares joined by a 4 mm neck: cut inside with a 6 mm tool the lap splits in two
    const pts = [[0, 0], [30, 0], [30, 13], [40, 13], [40, 0], [70, 0], [70, 30], [40, 30], [40, 17], [30, 17], [30, 30], [0, 30]]
      .map(([x, y]) => ({ x: x + 10, y: y + 10 }));
    const dumbbell: ResolvedContour = {
      path: { closed: true, segments: pts.map((from, i) => ({ kind: 'line' as const, from, to: pts[(i + 1) % pts.length] })) }, z: 0, ref: 0,
    };
    const base = profile(tool6);
    const patch = { side: 'inside' as const, entry: { ...base.entry, mode: 'plunge' as const } };
    const automatic = run({ ...patch, tabs: tabs({ count: 2 }) }, [dumbbell]);
    const top = (o: typeof automatic) => cutMoves(o.toolpath!.moves).filter((m) => Math.abs(m.to.z + 4.2) < 1e-6).length;
    expect(top(automatic)).toBeGreaterThan(0); // control: the contour does get tabs, on its pieces
    const none = run({ ...patch, tabs: tabs({ count: 2, manual: [{ refIndex: 0, t: [] }] }) }, [dumbbell]);
    expect(none.diagnostics).toEqual([]);
    expect(none.overlays.tabs).toEqual([]);
    expect(top(none)).toBe(0);
  });
});
