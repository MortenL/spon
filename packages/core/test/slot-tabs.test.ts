import { describe, expect, it } from 'vitest';
import {
  camContext, createJob, differencePolys, intersectPolys, type Move, nearestS, newOperation, type Path2D, pathFromPoints, pathLength, pointAt, type Poly, type ResolvedSlot,
  setStock, slotToolpath, type SlotOp,
  type TabSettings, type Toolpath,
} from '../src';
import { geoOf, tool6 } from './fixtures/camSetup';
import { sweptAt, uncovered } from './fixtures/slotSetup';

const ctx = camContext(setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 200, z: 20 }, modelOffset: { x: 0, y: 0, z: 0 } }), null);
const r = tool6.diameter / 2;
const tabs = (patch: Partial<TabSettings> = {}): TabSettings =>
  ({ enabled: true, shape: 'rect', width: 6, height: 1.5, placement: 'count', count: 2, spacing: 50, manual: [], ...patch });
const TOP = -3 + 1.5; // tab top: slot bottom -3 plus the tab height
const HALF = 3 + r; // half a tab interval: half the tab width plus the tool radius
const line100 = pathFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], false);

/** A 100 mm slot along X from the origin, top 0, bottom -3, cut in 1 mm layers (levels -1, -2, -3). */
function cut(patch: Partial<SlotOp>, width: number, ends: [ResolvedSlot['startEnd'], ResolvedSlot['endEnd']] = ['round', 'round']) {
  const base = newOperation('slot', { id: 's', name: 'Slot 1', tool: tool6, modelKind: 'mesh' }) as SlotOp;
  const op: SlotOp = { ...base, stepdown: 1, heights: { ...base.heights, top: { from: 'contour', offset: 0 } }, ...patch };
  const slot: ResolvedSlot = { centreline: line100, width, startEnd: ends[0], endEnd: ends[1], top: 0, bottom: -3, through: false, ref: 0 };
  return slotToolpath(op, tool6, ctx, geoOf({ slots: [slot] }));
}

/** Points every ≤ 0.05 mm along every move (rapids too), Z interpolated along the move. */
function samples(tp: Toolpath): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  let p: { x: number; y: number; z: number } | null = null;
  for (const m of tp.moves) {
    if (m.kind === 'cycle') { p = null; continue; }
    if (p) {
      if (m.kind === 'arc') {
        const rad = Math.hypot(p.x - m.center.x, p.y - m.center.y);
        const a0 = Math.atan2(p.y - m.center.y, p.x - m.center.x);
        const a1 = Math.atan2(m.to.y - m.center.y, m.to.x - m.center.x);
        let sweep = m.ccw ? a1 - a0 : a0 - a1;
        sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (sweep < 1e-9) sweep = 2 * Math.PI;
        const n = Math.max(8, Math.ceil((sweep * rad) / 0.05));
        for (let i = 1; i <= n; i++) {
          const a = a0 + ((m.ccw ? 1 : -1) * sweep * i) / n;
          out.push({ x: m.center.x + rad * Math.cos(a), y: m.center.y + rad * Math.sin(a), z: p.z + ((m.to.z - p.z) * i) / n });
        }
      } else {
        const n = Math.max(1, Math.ceil(Math.hypot(m.to.x - p.x, m.to.y - p.y) / 0.05));
        for (let i = 1; i <= n; i++) out.push({ x: p.x + ((m.to.x - p.x) * i) / n, y: p.y + ((m.to.y - p.y) * i) / n, z: p.z + ((m.to.z - p.z) * i) / n });
      }
    }
    p = m.to;
  }
  return out;
}

/** Tool-centre samples below the tab top whose tool would bite into a tab (the tab interval along X, open). */
const intoTabs = (tp: Toolpath, centres: number[]) =>
  samples(tp).filter((q) => q.z < TOP - 1e-6 && centres.some((c) => Math.abs(q.x - c) < HALF - 1e-6));
/** The tab material: the tab width across the whole slot. */
const tabMaterial = (centres: number[]): Poly[] => centres.map((c) => [{ x: c - 3, y: -20 }, { x: c + 3, y: -20 }, { x: c + 3, y: 20 }, { x: c - 3, y: 20 }]);
/** Where the tool centre keeps out of the tabs below the tab top (the tab interval), widened by `extra`, across the whole slot. */
const tabBand = (centres: number[], extra = 0): Poly[] => centres.map((c) => [{ x: c - HALF - extra, y: -20 }, { x: c + HALF + extra, y: -20 }, { x: c + HALF + extra, y: 20 }, { x: c - HALF - extra, y: 20 }]);
const area = (polys: Poly[]) => polys.reduce((a, p) => a + Math.abs(p.reduce((s, q, i) => { const n = p[(i + 1) % p.length]; return s + q.x * n.y - n.x * q.y; }, 0) / 2), 0);
const errors = (o: ReturnType<typeof cut>) => o.diagnostics.filter((d) => d.severity === 'error');
const centresOf = (o: ReturnType<typeof cut>) => o.overlays.tabs.map((t) => t.point.x);

/** Below the tab top, the cut matches the cut without tabs everywhere except the tabs, and never reaches into them. */
function expectSameOutsideTabs(on: Toolpath, off: Toolpath, centres: number[]) {
  for (const z of [-2, -3]) {
    const swOn = sweptAt(on, z, r), swOff = sweptAt(off, z, r);
    expect(uncovered(differencePolys(swOff, tabBand(centres)), swOn)).toBeLessThan(1e-3);
    expect(area(intersectPolys(swOn, tabMaterial(centres)))).toBeLessThan(0.02);
  }
}

describe('tabs along slots', () => {
  it('lifts over tabs on a tool-width slot', () => {
    const on = cut({ tabs: tabs() }, 6);
    const off = cut({}, 6);
    expect(errors(on)).toEqual([]);
    expect(on.overlays.tabs.map((t) => [t.refIndex, t.index, Number(t.t.toFixed(3)), t.manual])).toEqual([[0, 0, 0.25, false], [0, 1, 0.75, false]]);
    expect(on.overlays.tabPaths).toHaveLength(1);
    expect(on.overlays.tabPaths[0]).toMatchObject({ refIndex: 0, closed: false });
    expect(on.overlays.tabPaths[0].z).toBeCloseTo(TOP, 9);
    const centres = centresOf(on);
    expect(centres[0]).toBeCloseTo(25, 6);
    expect(intoTabs(on.toolpath!, centres)).toEqual([]);
    // the tool runs over each tab at the tab top
    for (const c of centres) expect(samples(on.toolpath!).some((q) => Math.abs(q.z - TOP) < 1e-6 && Math.abs(q.x - c) < 0.1)).toBe(true);
    expectSameOutsideTabs(on.toolpath!, off.toolpath!, centres);
    // at the level above the tab top (-1) nothing changes
    expect(uncovered(sweptAt(off.toolpath!, -1, r), sweptAt(on.toolpath!, -1, r))).toBeLessThan(1e-3);
  });

  it('lifts every offset pass of a wider slot at the same tab positions, and the finish pass too', () => {
    const patch = { stockRadial: 0.5, finishWalls: true };
    const on = cut({ ...patch, tabs: tabs() }, 16);
    const off = cut(patch, 16);
    expect(errors(on)).toEqual([]);
    const centres = centresOf(on);
    expect(centres).toHaveLength(2);
    expect(intoTabs(on.toolpath!, centres)).toEqual([]);
    expectSameOutsideTabs(on.toolpath!, off.toolpath!, centres);
    // every racetrack ring and the finish pass (at the wall offset, |y| ≈ 5) rise over both tabs, on both sides of the slot
    const over = samples(on.toolpath!).filter((q) => Math.abs(q.z - TOP) < 1e-6);
    for (const c of centres) {
      for (const y of [-4.5, -2.7, 2.7, 4.5, -5, 5]) { // rings at the 45 % stepover (2.7 mm) and the roughing wall offset (4.5); the finish pass at 5
        expect([c, y, over.some((q) => Math.abs(q.x - c) < 0.1 && Math.abs(q.y - y) < 0.1)]).toEqual([c, y, true]);
      }
    }
  });

  it('lifts with a triangular tab, ramping over it', () => {
    const on = cut({ tabs: tabs({ shape: 'triangle' }) }, 16);
    expect(errors(on)).toEqual([]);
    const centres = centresOf(on);
    expect(centres).toHaveLength(2);
    // a triangle reaches the tab top only at its centre; the tool keeps out of the triangle everywhere
    const bad = samples(on.toolpath!).filter((q) => centres.some((c) => {
      const d = Math.abs(q.x - c);
      return d < HALF - 1e-6 && q.z < TOP - ((TOP + 3) * d) / HALF - 1e-6;
    }));
    expect(bad).toEqual([]);
  });

  it('leaves out trochoid loops at tabs', () => {
    const troch = { strategy: 'trochoidal' as const, trochoidal: { stepPct: 10 } };
    const on = cut({ ...troch, tabs: tabs({ count: 1 }) }, 10);
    const off = cut(troch, 10);
    expect(errors(on)).toEqual([]);
    const [c] = centresOf(on);
    expect(c).toBeCloseTo(50, 6);
    const circles = (tp: Toolpath) => tp.moves.flatMap((m, i) => {
      const prev = tp.moves[i - 1];
      const p = prev && prev.kind !== 'cycle' ? prev.to : undefined;
      return m.kind === 'arc' && p && Math.hypot(m.to.x - p.x, m.to.y - p.y) < 1e-9 && Math.abs(m.to.z - p.z) < 1e-9
        ? [{ c: m.center, rad: Math.hypot(p.x - m.center.x, p.y - m.center.y), z: m.to.z }] : [];
    });
    const R = circles(off.toolpath!)[0].rad;
    // no loop below the tab top whose circle (widened by the tool radius) reaches the tab
    const below = circles(on.toolpath!).filter((k) => k.z < TOP - 1e-6);
    expect(below.length).toBeGreaterThan(20);
    expect(below.filter((k) => Math.abs(k.c.x - c) < R + HALF - 1e-6)).toEqual([]);
    const skipped = circles(off.toolpath!).filter((k) => Math.abs(k.z + 3) < 1e-6 && Math.abs(k.c.x - c) < R + HALF - 1e-6).length;
    expect(skipped).toBeGreaterThan(0);
    expect(on.diagnostics.filter((d) => d.code === 'tab-trochoid-skipped').map((d) => [d.severity, d.message]))
      .toEqual([['warning', `${skipped} trochoid loops were left out at tabs`]]);
    expect(intoTabs(on.toolpath!, [c])).toEqual([]);
    // everywhere but the tab, the slot is cleared at the bottom as without tabs
    const swOn = sweptAt(on.toolpath!, -3, r), swOff = sweptAt(off.toolpath!, -3, r);
    // a loop reaches the walls only beside its centre, so the walls are cut from the first kept loop on (loops are one step, 0.6 mm, apart)
    expect(uncovered(differencePolys(swOff, tabBand([c], R + 0.6)), swOn)).toBeLessThan(1e-3);
    // and over the tab, the slot is cleared down to the tab top
    const tabArea: Poly[] = [[{ x: c - 3, y: -5 }, { x: c + 3, y: -5 }, { x: c + 3, y: 5 }, { x: c - 3, y: 5 }]];
    expect(uncovered(tabArea, sweptAt(on.toolpath!, TOP, r))).toBeLessThan(1e-3);
  }, 120_000);

  it('gives no trochoid warning without tabs', () => {
    const o = cut({ strategy: 'trochoidal', trochoidal: { stepPct: 10 } }, 10);
    expect(o.diagnostics.map((d) => d.code)).not.toContain('tab-trochoid-skipped');
    expect(o.overlays.tabs).toEqual([]);
    expect(o.overlays.tabPaths).toEqual([]);
  });

  it('square ends to the wall only lift where a tab lies on them', () => {
    const ends: [ResolvedSlot['startEnd'], ResolvedSlot['endEnd']] = ['square', 'square'];
    const patch = { squareEnds: 'endWall' as const, strategy: 'wider' as const };
    const near = (m: Move) => m.kind !== 'cycle' && (m.to.x < 10 || m.to.x > 90);
    // tabs in the middle: the moves near the ends are those of a cut without tabs
    const mid = cut({ ...patch, tabs: tabs() }, 10, ends);
    const off = cut(patch, 10, ends);
    expect(errors(mid)).toEqual([]);
    expect(mid.toolpath!.moves.filter(near)).toEqual(off.toolpath!.moves.filter(near));
    // a tab placed by hand at the start end: the passes there rise over it, and none reaches into it
    const atEnd = cut({ ...patch, tabs: tabs({ manual: [{ refIndex: 0, t: [0] }] }) }, 10, ends);
    expect(errors(atEnd)).toEqual([]);
    const [c] = centresOf(atEnd);
    expect(c).toBeCloseTo(HALF, 6);
    expect(intoTabs(atEnd.toolpath!, [c])).toEqual([]);
    expect(samples(atEnd.toolpath!).some((q) => Math.abs(q.z - TOP) < 1e-6 && q.x < c)).toBe(true);
    // the far end is cut as without tabs
    const far = (m: Move) => m.kind !== 'cycle' && m.to.x > 90;
    expect(atEnd.toolpath!.moves.filter(far).length).toBeGreaterThan(0);
  });

  describe('keeps out of the tabs on curved and closed slots', () => {
    const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 40, startAngle: 0, sweep: Math.PI / 2 }] };
    const ring: Path2D = { closed: true, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 25, startAngle: 0, sweep: 2 * Math.PI }] };
    /** Samples below the tab top where the tool (any point of its disc) is inside a tab: within the slot and the tab's stretch of centreline. */
    const touching = (tp: Toolpath, centreline: Path2D, centres: number[], width: number) => {
      const pts = centres.map((s) => pointAt(centreline, s).point);
      const disc = Array.from({ length: 24 }, (_, k) => ({ x: (r - 1e-3) * Math.cos((k * Math.PI) / 12), y: (r - 1e-3) * Math.sin((k * Math.PI) / 12) }));
      return samples(tp).filter((q) => q.z < TOP - 1e-6 && pts.some((p) => Math.hypot(q.x - p.x, q.y - p.y) < width / 2 + 3 + r + 1)).filter((q) =>
        [{ x: 0, y: 0 }, ...disc].some((d) => {
          const n = nearestS(centreline, { x: q.x + d.x, y: q.y + d.y });
          return n.distance <= width / 2 && centres.some((c) => Math.abs(n.s - c) < 3 - 1e-3);
        }));
    };
    const cases = [
      ['tool-width', {}, 6], ['wider', { finishWalls: true, stockRadial: 0.3 }, 14], ['trochoidal', { strategy: 'trochoidal', trochoidal: { stepPct: 20 } }, 10],
    ] as const;
    for (const [pathName, centreline, count] of [['arc', arc, 2], ['ring', ring, 3]] as const) {
      for (const [name, patch, width] of cases) {
        for (const mode of ['auto', 'plunge'] as const) {
          it(`${name}, ${pathName}, ${mode} entry`, () => {
            const base = newOperation('slot', { id: 's', name: 'Slot 1', tool: tool6, modelKind: 'mesh' }) as SlotOp;
            const op: SlotOp = {
              ...base, stepdown: 1, heights: { ...base.heights, top: { from: 'contour', offset: 0 } }, entry: { ...base.entry, mode }, tabs: tabs({ count }), ...patch,
            } as SlotOp;
            const slot: ResolvedSlot = { centreline, width, startEnd: 'round', endEnd: 'round', top: 0, bottom: -3, through: false, ref: 0 };
            const o = slotToolpath(op, tool6, ctx, geoOf({ slots: [slot] }));
            expect(o.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
            expect(o.overlays.tabs).toHaveLength(count);
            const centres = o.overlays.tabs.map((t) => t.t * pathLength(centreline));
            expect(touching(o.toolpath!, centreline, centres, width)).toEqual([]);
          }, 120_000);
        }
      }
    }
  });

  it('reports one tab-skipped warning when a tab does not fit', () => {
    const o = cut({ tabs: tabs({ count: 20, width: 6 }) }, 6);
    expect(o.diagnostics.filter((d) => d.code === 'tab-skipped')).toHaveLength(1);
  });
});
