import { describe, expect, it } from 'vitest';
import { offsetPolys, pathFromPoints, type Path2D, type Toolpath } from '../src';
import { tool6 } from './fixtures/camSetup';
import { cutsAt, drawingSlotJob, plunges, slotOutline, sweptAt, uncovered } from './fixtures/slotSetup';

const straight = pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }], false);
const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 30, startAngle: 0, sweep: Math.PI / 2 }] };
const freeform = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 50, y: 15 }, { x: 80, y: 15 }], false);
const ring: Path2D = { closed: true, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 25, startAngle: 0, sweep: 2 * Math.PI }] };
const bottom = { heights: { bottom: { from: 'stockTop', offset: -3 } }, stepdown: 1 };
const errors = (d: { severity: string }[]) => d.filter((x) => x.severity === 'error');

/** The slot is cut to its full outline at the bottom and never beyond it (review focus 1). */
function expectExactSlot(r: ReturnType<typeof drawingSlotJob>, w: number) {
  expect(errors(r.diagnostics)).toEqual([]);
  const target = slotOutline(r.program(0), w);
  const swept = sweptAt(r.tp!, -3, 3);
  expect(uncovered(target, swept)).toBeLessThan(1e-3);
  expect(uncovered(swept, offsetPolys(target, 0.02, 0.005))).toBeLessThan(1e-3);
  expect(plunges(r.tp!, 0)).toEqual([]);
}

describe('tool-width slots', () => {
  for (const [name, path] of [['straight', straight], ['arc', arc], ['freeform', freeform], ['ring', ring]] as const) {
    it(`cuts a ${name} centreline exactly at tool width, ramping in`, () => expectExactSlot(drawingSlotJob([path], { width: 6, ...bottom }), 6));
  }

  it('alternates direction per layer without retracting', () => {
    const { tp } = drawingSlotJob([straight], { width: 6, ...bottom });
    const full = (z: number) => cutsAt(tp!, z).find((c) => Math.abs(c.points[1].x - c.points[0].x) > 39)!;
    const dirs = [-1, -2, -3].map((z) => Math.sign(full(z).points[1].x - full(z).points[0].x));
    expect(dirs[0]).toBe(-dirs[1]);
    expect(dirs[1]).toBe(-dirs[2]);
    const firstFeed = tp!.moves.findIndex((m) => m.kind !== 'rapid');
    const lastFeed = tp!.moves.length - 1 - [...tp!.moves].reverse().findIndex((m) => m.kind !== 'rapid');
    expect(tp!.moves.slice(firstFeed, lastFeed).filter((m) => m.kind === 'rapid')).toEqual([]);
  });

  it('ramps into a very short slot instead of plunging (review focus 4)', () => {
    const { diagnostics, tp } = drawingSlotJob([pathFromPoints([{ x: 0, y: 0 }, { x: 1, y: 0 }], false)], { width: 6, ...bottom });
    expect(errors(diagnostics)).toEqual([]);
    expect(plunges(tp!, 0)).toEqual([]);
    expect(tp!.moves.length).toBeLessThan(2000);
  });
});

describe('wider slots', () => {
  for (const [name, path] of [['straight', straight], ['arc', arc], ['freeform', freeform], ['ring', ring]] as const) {
    it(`clears a ${name} slot 10 mm wide with a 6 mm tool`, () => expectExactSlot(drawingSlotJob([path], { width: 10, ...bottom }), 10));
  }

  it('runs racetrack loops counter-clockwise for climb and clockwise for conventional', () => {
    const ccw = (tp: Toolpath) => tp.moves.filter((m) => m.kind === 'arc' && Math.abs(m.to.z + 3) < 1e-6).map((m) => (m as { ccw: boolean }).ccw);
    expect(new Set(ccw(drawingSlotJob([straight], { width: 10, ...bottom }).tp!))).toEqual(new Set([true]));
    expect(new Set(ccw(drawingSlotJob([straight], { width: 10, direction: 'conventional', ...bottom }).tp!))).toEqual(new Set([false]));
  });

  it('leaves radial stock, and the finish pass takes it to the wall', () => {
    const rough = drawingSlotJob([straight], { width: 10, stockRadial: 0.5, ...bottom });
    expect(uncovered(slotOutline(rough.program(0), 9), sweptAt(rough.tp!, -3, 3))).toBeLessThan(1e-3);
    expect(uncovered(sweptAt(rough.tp!, -3, 3), offsetPolys(slotOutline(rough.program(0), 9), 0.02, 0.005))).toBeLessThan(1e-3);
    expectExactSlot(drawingSlotJob([straight], { width: 10, stockRadial: 0.5, finishWalls: true, ...bottom }), 10);
  });

  it('enters with a helix when the slot is wide enough', () => {
    const { tp } = drawingSlotJob([straight], { width: 16, ...bottom });
    expect(tp!.moves.some((m) => m.kind === 'arc' && m.to.z < 0 && m.to.z > -1 + 1e-6)).toBe(true);
  });
});

describe('trochoidal slots', () => {
  const troch = { width: 10, strategy: 'trochoidal', trochoidal: { stepPct: 10 }, ...bottom };
  const circles = (tp: Toolpath) => tp.moves.flatMap((m, i) => {
    const prev = tp.moves[i - 1];
    const p = prev && prev.kind !== 'cycle' ? prev.to : undefined;
    return m.kind === 'arc' && p && Math.hypot(m.to.x - p.x, m.to.y - p.y) < 1e-9 && Math.abs(m.to.z - p.z) < 1e-9 ? [{ c: m.center, r: Math.hypot(p.x - m.center.x, p.y - m.center.y), z: m.to.z }] : [];
  });

  for (const [name, path] of [['straight', straight], ['arc', arc], ['freeform', freeform], ['ring', ring]] as const) {
    it(`clears a ${name} slot with loops no more than one step apart`, () => {
      const r = drawingSlotJob([path], troch);
      expectExactSlot(r, 10);
      const cs = circles(r.tp!).filter((c) => Math.abs(c.z + 3) < 1e-6);
      expect(cs.length).toBeGreaterThan(5);
      for (const c of cs) expect(Math.abs(c.r - 2)).toBeLessThan(0.02); // R = width/2 - r, less the fitting margin
      for (let i = 1; i < cs.length; i++) expect(Math.hypot(cs[i].c.x - cs[i - 1].c.x, cs[i].c.y - cs[i - 1].c.y)).toBeLessThanOrEqual(0.6 + 1e-6);
    }, 60_000);
  }

  it('cuts in layers no deeper than the flutes, with no rapid inside a layer', () => {
    const { tp, diagnostics } = drawingSlotJob([straight], { ...troch, heights: { bottom: { from: 'stockTop', offset: -30 } } });
    expect(diagnostics.map((d) => d.code)).not.toContain('stepdown-exceeds-flute');
    expect(new Set(circles(tp!).map((c) => c.z.toFixed(3)))).toEqual(new Set(['-15.000', '-30.000']));
    const loopsAt = (z: number) => tp!.moves.map((m, i) => ({ m, i })).filter(({ m }) => m.kind === 'arc' && Math.abs(m.to.z - z) < 1e-6).map(({ i }) => i);
    for (const z of [-15, -30]) {
      const idx = loopsAt(z);
      expect(tp!.moves.slice(idx[0], idx[idx.length - 1]).filter((m) => m.kind === 'rapid')).toEqual([]);
    }
  });

  it('refuses a slot no wider than the tool', () => {
    expect(drawingSlotJob([straight], { ...troch, width: 6 }).diagnostics.map((d) => d.message)).toContain('Trochoidal needs a slot wider than the tool');
  });
});

describe('multi-ring wider slots', () => {
  for (const [name, path] of [['straight', straight], ['arc', arc]] as const) {
    it(`cuts a ${name} slot 20 mm wide exactly`, () => expectExactSlot(drawingSlotJob([path], { width: 20, ...bottom }), 20));
  }
});

describe('slot errors', () => {
  const messages = (patch: Record<string, unknown>, tool = tool6) => drawingSlotJob([straight], { ...bottom, ...patch }, tool).diagnostics.map((d) => d.message);
  it('refuses a slot narrower than the tool', () => expect(messages({ width: 5 })).toContain('The tool is wider than this slot (5.00 mm)'));
  it('refuses tool-width when the slot is wider', () => expect(messages({ width: 10, strategy: 'toolWidth' })).toContain('Tool-width slots need a tool as wide as the slot (10.00 mm); use Wider'));
  it('refuses tools that are not flat or bull-nose', () => {
    expect(messages({ width: 6 }, { ...tool6, id: 'b6', number: 6, type: 'ball', cornerRadius: 3 })).toContain('Slots need a flat or bull-nose end mill');
  });
  it('warns on a plunge entry', () => expect(messages({ width: 6, entry: { mode: 'plunge' } })).toContain('Slots are entered with a plunge'));
});
