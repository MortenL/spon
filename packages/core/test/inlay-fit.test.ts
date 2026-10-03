import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../src';
import { tool6 } from './fixtures/camSetup';
import { flat3, fitSuite, v60 } from './fixtures/inlayFit';
import { heightField, sweep } from './fixtures/sweep';

const tpOf = (moves: Toolpath['moves']): Toolpath => ({ operationId: 'x', operationName: 'x', toolId: 't', rpm: 0, coolant: 'off', clearance: 5, moves });
const B = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

describe('sweep', () => {
  const at = (f: ReturnType<typeof heightField>, x: number, y: number) => f.z[Math.floor((y - f.y0) / f.step) * f.nx + Math.floor((x - f.x0) / f.step)];

  it('a V-bit plunge makes a cone of the right slope', () => {
    const f = heightField(B(-5, -5, 5, 5), 0.05, 0);
    const slope = Math.tan(Math.PI / 6);
    sweep(f, tpOf([{ kind: 'rapid', to: { x: 0, y: 0, z: 5 } }, { kind: 'line', to: { x: 0, y: 0, z: -2 }, feed: 100 }]), v60);
    expect(at(f, 0.025, 0.025)).toBeCloseTo(-2 + 0.035 / slope, 2);
    for (const d of [0.5, 1, 1.1]) expect(at(f, d, 0.025)).toBeCloseTo(-2 + d / slope, 1);
    expect(at(f, 1.3, 0)).toBe(0); // the cone reaches the surface at 2 tan(30) = 1.155
  });

  it('a flat-tool line makes a trench of its width', () => {
    const f = heightField(B(-8, -8, 8, 8), 0.05, 0);
    sweep(f, tpOf([{ kind: 'rapid', to: { x: -4, y: 0, z: 5 } }, { kind: 'line', to: { x: -4, y: 0, z: -1 }, feed: 1 }, { kind: 'line', to: { x: 3, y: 0, z: -1 }, feed: 1 }]), tool6);
    expect(at(f, 0, 2.9)).toBe(-1);
    expect(at(f, 0, -2.9)).toBe(-1);
    expect(at(f, 0, 3.1)).toBe(0);
    expect(at(f, 0, -3.1)).toBe(0);
    expect(at(f, 6.1, 0)).toBe(0); // beyond the end of the line plus the radius (3 + 3 = 6)
    expect(at(f, 5.9, 0)).toBe(-1);
    expect(at(f, -7.1, 0)).toBe(0);
  });
});


// the 3 mm starter flat clears both boards; inlay-fit-6mm.test.ts runs the same cases with a 6 mm flat
fitSuite(flat3);
