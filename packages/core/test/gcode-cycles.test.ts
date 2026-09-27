import { describe, expect, it } from 'vitest';
import { type CycleParams, expandCycle } from '../src/gcode/cycles';

function run(c: Partial<CycleParams> & Pick<CycleParams, 'code'>) {
  const params: CycleParams = { x: 10, y: 20, z: -3, r: 1, q: 0, p: 0, retract: 98, initialZ: 5, ...c };
  const out: string[] = [];
  expandCycle({ x: 0, y: 0, z: 5 }, params, (kind, x, y, z, internal, seconds) =>
    out.push(`${kind}${internal ? '*' : ''} ${x},${y},${Math.round(z * 1000) / 1000}${seconds ? ` ${seconds}s` : ''}`));
  return out;
}

describe('expandCycle', () => {
  it('G81: approach, drill, retract to the initial level', () => {
    expect(run({ code: 81 })).toEqual(['rapid 10,20,5', 'rapid 10,20,1', 'feed 10,20,-3', 'rapid* 10,20,5']);
  });

  it('G99 retracts to R', () => {
    expect(run({ code: 81, retract: 99 }).at(-1)).toBe('rapid* 10,20,1');
  });

  it('G82 dwells at the bottom', () => {
    expect(run({ code: 82, p: 0.5 })).toEqual(['rapid 10,20,5', 'rapid 10,20,1', 'feed 10,20,-3', 'dwell 10,20,-3 0.5s', 'rapid* 10,20,5']);
  });

  it('G83 pecks with full retract and a clearance re-approach', () => {
    expect(run({ code: 83, q: 2 })).toEqual([
      'rapid 10,20,5', 'rapid 10,20,1',
      'feed 10,20,-1', 'rapid* 10,20,1', 'rapid* 10,20,-0.8',
      'feed 10,20,-3',
      'rapid* 10,20,5',
    ]);
  });

  it('G73 pecks with a small chip-breaking retract', () => {
    expect(run({ code: 73, q: 2 })).toEqual([
      'rapid 10,20,5', 'rapid 10,20,1',
      'feed 10,20,-1', 'rapid* 10,20,-0.8',
      'feed 10,20,-3',
      'rapid* 10,20,5',
    ]);
  });

  it('drills a peck cycle in one pass when Q is missing', () => {
    expect(run({ code: 83, q: 0 })).toEqual(['rapid 10,20,5', 'rapid 10,20,1', 'feed 10,20,-3', 'rapid* 10,20,5']);
  });
});
