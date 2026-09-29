import { describe, expect, it } from 'vitest';
import { applyCommand, createJob, defaultPostSettings, fmtNum, type Job, postProcess, type Tool, type Toolpath } from '../src';

const t1: Tool = { id: 'a', name: '6 mm flat', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2, presets: [] };
const t2: Tool = { id: 'b', name: '5 mm drill', type: 'drill', number: 2, diameter: 5, cornerRadius: 0, tipAngleDeg: 118, fluteLength: 30, stickout: 40, flutes: 2, presets: [] };
const A: Toolpath = {
  operationId: 'A', operationName: 'Profile A', toolId: 'a', rpm: 18000, coolant: 'flood', clearance: 15,
  moves: [
    { kind: 'rapid', to: { x: 10, y: 10, z: 15 } },
    { kind: 'rapid', to: { x: 10, y: 10, z: 2 } },
    { kind: 'line', to: { x: 10, y: 10, z: -1 }, feed: 300 },
    { kind: 'line', to: { x: 20, y: 10, z: -1 }, feed: 1000 },
    { kind: 'arc', to: { x: 30, y: 10, z: -1 }, center: { x: 25, y: 10 }, ccw: false, feed: 1000 },
    { kind: 'arc', to: { x: 30, y: 10, z: -1 }, center: { x: 25, y: 10 }, ccw: true, feed: 1000 },
    { kind: 'rapid', to: { x: 30, y: 10, z: 15 } },
  ],
};
const cycle = (x: number) => ({ kind: 'cycle' as const, cycle: 'peck' as const, at: { x, y: 40 }, top: 0, bottom: -6, r: 2, retract: 5, peck: 2, dwell: 0, feed: 200 });
const B: Toolpath = {
  operationId: 'B', operationName: 'Drill B', toolId: 'b', rpm: 3000, coolant: 'off', clearance: 15,
  moves: [{ kind: 'rapid', to: { x: 40, y: 40, z: 15 } }, { kind: 'rapid', to: { x: 40, y: 40, z: 5 } }, cycle(40), cycle(50), { kind: 'rapid', to: { x: 50, y: 40, z: 15 } }],
};
function bracket(dialect: 'grbl' | 'linuxcnc' | 'fanuc', patch = {}): Job {
  const job = [t1, t2].reduce((j, tool) => applyCommand(j, { type: 'addTool', tool }), createJob('Bracket'));
  return { ...job, post: { ...defaultPostSettings(dialect), ...patch } };
}
const lines = (text: string) => text.trimEnd().split('\n');

describe('fmtNum', () => {
  it('rounds, strips zeros and never writes −0', () => {
    expect([fmtNum(1.5, 3), fmtNum(2, 3), fmtNum(-0.0001, 3), fmtNum(0.12345, 3), fmtNum(-3.1, 3)]).toEqual(['1.5', '2', '0', '0.123', '-3.1']);
    expect([fmtNum(2, 3, true), fmtNum(0, 3, true), fmtNum(1.25, 3, true)]).toEqual(['2.', '0.', '1.25']);
  });
});

describe('postProcess', () => {
  it('writes LinuxCNC: one file, M6 + G43, canned cycles, modal suppression', () => {
    const [file, ...rest] = postProcess(bracket('linuxcnc'), [A, B], { date: '2026-09-28' });
    expect(rest).toEqual([]);
    expect(file.name).toBe('Bracket.nc');
    expect(file.operationIds).toEqual(['A', 'B']);
    expect(file.tools).toEqual([1, 2]);
    expect(file.sections).toEqual([{ operationId: 'A', firstLine: 6, lastLine: 18 }, { operationId: 'B', firstLine: 19, lastLine: 30 }]);
    expect(lines(file.text)).toEqual([
      '(Bracket)', '(Spon 2026-09-28)', '(T1 D=6 flat - 6 mm flat)', '(T2 D=5 drill - 5 mm drill)',
      'G21 G90 G17 G94', 'G54',
      '(Profile A)', 'T1 M6', 'G43 H1', 'S18000 M3', 'M8',
      'G0 Z15', 'X10 Y10', 'Z2', 'G1 Z-1 F300', 'X20 F1000', 'G2 X30 Y10 I5 J0', 'G3 X30 Y10 I-5 J0', 'G0 Z15',
      '(Drill B)', 'M9', 'T2 M6', 'G43 H2', 'S3000 M3',
      'G0 Z15', 'X40 Y40', 'Z5', 'G98 G83 X40 Y40 Z-6 R2 Q2 F200', 'X50 Y40', 'G80', 'G0 Z15',
      'M9', 'M5', 'G53 G0 Z0', 'M2',
    ]);
  });

  it('changes tools between different tools that share a T number', () => {
    const twin = { ...t2, number: 1 };
    const job = { ...bracket('linuxcnc'), tools: [t1, twin] }; // an old job: applyCommand no longer allows this
    const text = lines(postProcess(job, [A, B], { date: '2026-09-28' })[0].text);
    expect(text.filter((l) => l === 'T1 M6')).toHaveLength(2);
    const grbl = { ...bracket('grbl', { splitByTool: false }), tools: [t1, twin] };
    expect(lines(postProcess(grbl, [A, B], { date: '2026-09-28' })[0].text)).toContain('M0');
  });

  it('writes GRBL split by tool with expanded peck cycles', () => {
    const files = postProcess(bracket('grbl'), [A, B], { date: '2026-09-28' });
    expect(files.map((f) => f.name)).toEqual(['Bracket-01-T1.nc', 'Bracket-02-T2.nc']);
    expect(lines(files[0].text)).toEqual([
      '(Bracket)', '(Spon 2026-09-28)', '(T1 D=6 flat - 6 mm flat)', 'G21 G90 G17 G94', 'G54',
      '(Profile A)', 'S18000 M3', 'M8', 'G0 Z15', 'X10 Y10', 'Z2', 'G1 Z-1 F300', 'X20 F1000', 'G2 X30 Y10 I5 J0', 'G3 X30 Y10 I-5 J0', 'G0 Z15',
      'M9', 'M5', 'M30',
    ]);
    const peck = ['Z2', 'G1 Z-2', 'G0 Z2', 'Z-1.5', 'G1 Z-4', 'G0 Z2', 'Z-3.5', 'G1 Z-6', 'G0 Z5'];
    expect(lines(files[1].text)).toEqual([
      '(Bracket)', '(Spon 2026-09-28)', '(T2 D=5 drill - 5 mm drill)', 'G21 G90 G17 G94', 'G54',
      '(Drill B)', 'S3000 M3', 'G0 Z15', 'X40 Y40', 'Z5',
      'Z2', 'G1 Z-2 F200', ...peck.slice(2), 'X50 Y40', ...peck, 'Z15',
      'M9', 'M5', 'M30',
    ]);
  });

  it('pauses for a manual tool change when GRBL is not split', () => {
    const [file] = postProcess(bracket('grbl', { splitByTool: false }), [A, B], { date: 'x' });
    const l = lines(file.text);
    expect(l.slice(l.indexOf('(Drill B)'), l.indexOf('(Drill B)') + 5)).toEqual(['(Drill B)', 'M9', 'M5', 'M0', '(Change to T2: 5 mm drill)']);
  });

  it('writes Fanuc in upper case with O-number, % lines, trailing decimal points and G28', () => {
    const [file] = postProcess(bracket('fanuc'), [A, B], { date: '2026-09-28' });
    const l = lines(file.text);
    expect(l.slice(0, 4)).toEqual(['%', 'O1000 (BRACKET)', '(BRACKET)', '(SPON 2026-09-28)']);
    expect(l).toContain('G40 G49 G80');
    expect(l).toContain('G2 X30. Y10. I5. J0.');
    expect(l).toContain('G98 G83 X40. Y40. Z-6. R2. Q2. F200.');
    expect(l.slice(-4)).toEqual(['G91 G28 Z0', 'G90', 'M30', '%']);
  });

  it('supports line numbers, R-format arcs, inch output, spindle dwell and dwell cycles', () => {
    const numbered = lines(postProcess(bracket('linuxcnc', { lineNumbers: true }), [A], { date: 'd' })[0].text);
    expect(numbered.slice(0, 2)).toEqual(['N10 (Bracket)', 'N20 (Spon d)']);
    const r = postProcess(bracket('linuxcnc', { arcFormat: 'r' }), [A], { date: 'd' })[0].text;
    expect(r).toContain('G2 X30 Y10 R5\n');
    expect(r).toContain('G3 X30 Y10 I-5 J0\n'); // full circles always use I/J
    const inch = { ...bracket('linuxcnc'), displayUnits: 'in' as const };
    const t = postProcess(inch, [A], { date: 'd' })[0].text;
    expect(t).toContain('G20 G90 G17 G94');
    expect(t).toContain('X0.3937 Y0.3937');
    expect(postProcess(bracket('linuxcnc', { spindleDwell: 2 }), [A], { date: 'd' })[0].text).toContain('S18000 M3\nG4 P2\n');
    const dwellB: Toolpath = { ...B, moves: B.moves.map((m) => (m.kind === 'cycle' ? { ...m, cycle: 'dwell' as const, dwell: 0.5 } : m)) };
    expect(postProcess(bracket('linuxcnc'), [dwellB], { date: 'd' })[0].text).toContain('G98 G82 X40 Y40 Z-6 R2 P0.5 F200');
    expect(postProcess(bracket('fanuc'), [dwellB], { date: 'd' })[0].text).toContain('G98 G82 X40. Y40. Z-6. R2. P500 F200.');
    expect(postProcess(bracket('linuxcnc'), [], {})).toEqual([]);
  });

  it('formats feed words with the configured post decimals, like coordinates', () => {
    const feedy: Toolpath = { ...A, moves: [{ kind: 'rapid', to: { x: 0, y: 0, z: 15 } }, { kind: 'line', to: { x: 1, y: 0, z: 0 }, feed: 1234.5678 }] };
    const mm = postProcess(bracket('linuxcnc'), [feedy], { date: 'd' })[0].text;
    expect(mm).toContain('F1234.568'); // 1234.5678 at 3 decimals (mm)
    const inch = { ...bracket('linuxcnc'), displayUnits: 'in' as const };
    const t = postProcess(inch, [feedy], { date: 'd' })[0].text;
    expect(t).toContain('F48.605'); // 1234.5678 / 25.4 at 4 decimals (inch), trailing zero stripped by fmtNum
  });
});
