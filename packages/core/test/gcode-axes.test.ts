import { describe, expect, it } from 'vitest';
import {
  arcGeometry, arcPointInto, axisMap, interpretProgram, mapTableToSpon, type MotionTable, type Plane,
  applyCommand, type Job, type JobCommand, MoveKind, parseProgram, programContext, runPipeline, type WcsAxes, vec3, machinePreset,
} from '../src';
import { camPartSetup, tool6 } from './fixtures/camSetup';

const layouts: WcsAxes[] = [];
for (const reverseX of [false, true]) for (const reverseY of [false, true]) for (const swapXY of [false, true]) layouts.push({ reverseX, reverseY, swapXY });
const enc = (s: string) => new TextEncoder().encode(s);

function camJob() {
  const { job, geometry, layer } = camPartSetup();
  const ref = (l: string, path: number) => ({ kind: 'dxfPath' as const, blobId: 'd1', layer: layer(l), path });
  const j = ([
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'pocket' },
    { type: 'updateOperation', id: 'pocket', patch: { geometry: [0, 1, 2, 3, 4].map((i) => ref('POCKET', i)) } },
    { type: 'addOperation', opType: 'drill', toolId: 't6', id: 'drill' },
    { type: 'updateOperation', id: 'drill', patch: { geometry: [0, 1, 2, 3].map((i) => ref('HOLES', i)), cycle: 'peck', peck: 2 } },
  ] as JobCommand[]).reduce(applyCommand, job);
  return { job: j, geometry };
}
const withAxes = (job: Job, axes: WcsAxes): Job => ({ ...job, wcs: { ...job.wcs, axes } });
const run = (job: Job, geometry: ReturnType<typeof camJob>['geometry']) => runPipeline(job, geometry, programContext(job, geometry as never)).run.files[0].parsed.table;

describe('G-code input follows the WCS axes', () => {
  const { job, geometry } = camJob();
  const base = run(job, geometry);
  it('has moves to compare', () => {
    expect(base.count).toBeGreaterThan(50);
    expect([...base.kind].some((k) => k === MoveKind.ArcCW || k === MoveKind.ArcCCW)).toBe(true);
  });
  it.each(layouts)('round trip gives the unflipped table (%j)', (axes) => {
    const t = run(withAxes(job, axes), geometry);
    expect(t.count).toBe(base.count);
    expect(t.start.x).toBeCloseTo(base.start.x, 3);
    expect(t.start.y).toBeCloseTo(base.start.y, 3);
    for (let i = 0; i < base.count; i++) {
      expect(t.kind[i]).toBe(base.kind[i]);
      for (let k = 0; k < 3; k++) expect(t.end[i * 3 + k]).toBeCloseTo(base.end[i * 3 + k], 3);
      if (base.kind[i] === MoveKind.ArcCW || base.kind[i] === MoveKind.ArcCCW) for (let k = 0; k < 3; k++) expect(t.arc[i * 3 + k]).toBeCloseTo(base.arc[i * 3 + k], 3);
    }
  });
});

const ctx = (axes?: WcsAxes, stock: { min: ReturnType<typeof vec3>; max: ReturnType<typeof vec3> } | null = null) =>
  ({ profile: machinePreset('Hobby GRBL router'), stock, jobWorkOffset: 'G54' as const, axes });

describe('imported programs', () => {
  it('maps a hand-written program with reverseY', () => {
    const p = parseProgram(enc('G0 X10 Y-5\nG1 X20 Y-5 F600\nG2 X30 Y-15 I0 J-10\n'), ctx({ reverseX: false, reverseY: true, swapXY: false }));
    const t = p.table;
    const end = (i: number) => [t.end[i * 3], t.end[i * 3 + 1]];
    expect(end(0)).toEqual([10, 5]);
    expect(end(1)).toEqual([20, 5]);
    expect(end(2)).toEqual([30, 15]);
    expect(t.kind[2]).toBe(MoveKind.ArcCCW);
    expect([t.arc[6], t.arc[7]]).toEqual([20, 15]);
  });

  it('G18 and G19 arcs follow the linear map (swapXY exchanges the planes; direction by handedness)', () => {
    // Machine G18 CW arc X10 Z0 -> X0 Z10 about (0,0): in Spon with swapXY it lies in the YZ plane (G19).
    const src = 'G18\nG0 X0 Y0 Z10\nG2 X10 Y0 Z0 I10 K-10\n';
    const sw = parseProgram(enc(src), ctx({ reverseX: false, reverseY: false, swapXY: true })).table;
    expect(sw.plane[1]).toBe(19);
    expect(sw.kind[1]).toBe(MoveKind.ArcCCW); // swap mirrors
    const same = parseProgram(enc(src), ctx({ reverseX: true, reverseY: false, swapXY: false })).table;
    expect(same.plane[1]).toBe(18);
    expect(same.kind[1]).toBe(MoveKind.ArcCCW);
    const both = parseProgram(enc(src), ctx({ reverseX: true, reverseY: false, swapXY: true })).table;
    // reverseX + swap is a rotation (no mirror) that sends the G18 normal +Y to Spon -X: a turn about -X is the opposite sense about +X
    expect(both.plane[1]).toBe(19);
    expect(both.kind[1]).toBe(MoveKind.ArcCCW);
  });

  it('times a Y move with the machine axis the program sees', () => {
    const profile = { ...machinePreset('Hobby GRBL router'), rapid: { x: 10000, y: 2000, z: 1500 }, accel: { x: 5000, y: 5000, z: 200 }, maxFeed: 20000 };
    const prog = enc('G90 G0 X0 Y0\nG0 Y500\n');
    const off = parseProgram(prog, { ...ctx(), profile }).analysis.summary.totalSeconds;
    const on = parseProgram(enc('G90 G0 X0 Y0\nG0 X500\n'), { ...ctx({ reverseX: false, reverseY: false, swapXY: true }), profile }).analysis.summary.totalSeconds;
    // off: Spon Y is machine Y (2000 mm/min); on: the program's X move runs at the machine X rate (10000 mm/min)
    expect(off).toBeGreaterThan((500 / (2000 / 60)) * 0.8);
    expect(off).toBeLessThan((500 / (2000 / 60)) * 1.2);
    expect(on).toBeGreaterThan((500 / (10000 / 60)) * 0.8);
    expect(on).toBeLessThan((500 / (10000 / 60)) * 1.2);
  });

  it('still flags the stock in Spon\'s frame when flipped', () => {
    const stock = { min: vec3(0, 0, -6), max: vec3(30, 20, 0) };
    const body = (start: string) => `G21 G90 G17 G54
G0 ${start} Z5
G1 Z-1 F300
`;
    // machine (5, 25) with swapXY is Spon (25, 5), inside the 30 x 20 stock; machine Y-10 with reverseY is Spon Y10
    const flagged = (text: string, axes: WcsAxes | undefined) => parseProgram(enc(text), ctx(axes, stock)).analysis.diagnostics.map((d) => d.code);
    expect(flagged(body('X5 Y25') + 'G0 Y26\n', undefined)).toEqual([]);
    expect(flagged(body('X5 Y25') + 'G0 Y26\n', { reverseX: false, reverseY: false, swapXY: true })).toContain('rapid-into-stock');
    expect(flagged(body('X5 Y-10') + 'G0 Y-11\n', { reverseX: false, reverseY: true, swapXY: false })).toContain('rapid-into-stock');
  });
});

describe('mapTableToSpon tessellation', () => {
  const programs = [
    'G18\nG0 X3 Y7 Z10\nG2 X13 Y9 Z0 I0 K-10\nG3 X3 Y2 Z-10 I-10 K0\nG2 X3 Y2 Z-10 I-5 K3\n',
    'G19\nG0 X3 Y7 Z10\nG2 X3 Y17 Z0 J0 K-10\nG3 X5 Y7 Z-10 J-10 K0\nG3 X5 Y7 Z-10 J4 K3\n',
    'G17\nG0 X3 Y7 Z0\nG2 X13 Y17 Z-2 I10 J0\nG3 X-7 Y-3 Z-3 I-10 J-10\nG2 X-7 Y-3 Z-3 I4 J3\n',
  ];
  const ARC_STEPS = 8;

  /** Move end points, with each arc tessellated into ARC_STEPS + 1 points. */
  function points(t: MotionTable): number[][] {
    const out: number[][] = [];
    let from = [t.start.x, t.start.y, t.start.z];
    for (let i = 0; i < t.count; i++) {
      const to = [t.end[i * 3], t.end[i * 3 + 1], t.end[i * 3 + 2]];
      const kind = t.kind[i];
      if (kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW) {
        const centre = [t.arc[i * 3], t.arc[i * 3 + 1], t.arc[i * 3 + 2]];
        const geometry = arcGeometry(from, to, centre, t.plane[i] as Plane, kind === MoveKind.ArcCW);
        for (let f = 0; f <= ARC_STEPS; f++) {
          const p = [0, 0, 0];
          arcPointInto(geometry, from, f / ARC_STEPS, p);
          out.push(p);
        }
      } else out.push(to);
      from = to;
    }
    return out;
  }

  it.each(layouts.flatMap((axes) => programs.map((text) => [axes, text.slice(0, 3), text] as const)))(
    'tessellates like the unmapped table sent through toSpon (%j, %s)',
    (axes, _plane, text) => {
      const map = axisMap(axes);
      const unmapped = interpretProgram(text, { jobWorkOffset: 'G54' } as never).table;
      const mapped = interpretProgram(text, { jobWorkOffset: 'G54' } as never).table;
      const expected = points(unmapped).map(([x, y, z]) => {
        const s = map.toSpon({ x, y });
        return [s.x, s.y, z];
      });
      mapTableToSpon(mapped, map);
      const actual = points(mapped);
      expect(actual.length).toBe(expected.length);
      expected.forEach((p, i) => p.forEach((v, k) => expect(Math.abs(v - actual[i][k])).toBeLessThan(1e-3)));
    },
  );
});
