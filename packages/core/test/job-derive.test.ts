import { describe, expect, it } from 'vitest';
import { v3near, vec3 } from '../src/geometry/vec3';
import { createJob } from '../src/job/defaults';
import { applyPlacement, computePlacement, fixedStockFromBox, stockBox, wcsPoint } from '../src/job/derive';
import type { AxisAnchor, Job, ZAnchor } from '../src/job/types';
import { rotateQuarter, setModel, setStock, setZSpin } from '../src/job/update';

const BOX_POINTS = [0, 0, 0, 20, 10, 5]; // enough points to define a 20 × 10 × 5 bbox
const RECT_POINTS = [0, 0, 0, 100, 60, 0];

function job(kind: 'mesh' | 'drawing', importUnits: 'mm' | 'in' = 'mm'): Job {
  return setModel(createJob(), { sourceName: 'x', blobId: 'b', kind, importUnits });
}

describe('computePlacement', () => {
  it('rests the part on Z = 0 and centres it in XY', () => {
    const p = computePlacement(job('mesh').model!, BOX_POINTS)!;
    expect(p.bbox).toEqual({ min: vec3(-10, -5, 0), max: vec3(10, 5, 5) });
    expect(v3near(applyPlacement(p, vec3(20, 10, 5)), vec3(10, 5, 5))).toBe(true);
  });

  it('scales inch models to mm', () => {
    const p = computePlacement(job('mesh', 'in').model!, [0, 0, 0, 1, 1, 1])!;
    expect(p.scale).toBe(25.4);
    expect(p.bbox.max.z).toBeCloseTo(25.4, 12);
  });

  it('applies the orientation before placing', () => {
    const p = computePlacement(rotateQuarter(job('mesh'), 'x', 1).model!, BOX_POINTS)!;
    expect(p.bbox.max.x - p.bbox.min.x).toBeCloseTo(20, 9);
    expect(p.bbox.max.y - p.bbox.min.y).toBeCloseTo(5, 9);
    expect(p.bbox.max.z).toBeCloseTo(10, 9);
    expect(p.bbox.min.z).toBeCloseTo(0, 9);
  });

  it('only spins drawings about Z', () => {
    const p = computePlacement(setZSpin(job('drawing'), 90).model!, RECT_POINTS)!;
    expect(p.bbox.max.x - p.bbox.min.x).toBeCloseTo(60, 9);
    expect(p.bbox.max.y - p.bbox.min.y).toBeCloseTo(100, 9);
    expect(p.bbox.max.z).toBeCloseTo(0, 9);
  });

  it('returns null without points', () => {
    expect(computePlacement(job('mesh').model!, [])).toBeNull();
  });
});

describe('stockBox', () => {
  it('grows auto stock around a mesh', () => {
    const j = job('mesh');
    const box = stockBox(j, computePlacement(j.model!, BOX_POINTS));
    expect(box).toEqual({ min: vec3(-15, -10, 0), max: vec3(15, 10, 6) });
  });

  it('puts drawings on the stock top face', () => {
    const j = setStock(job('drawing'), { mode: 'auto', margin: { xy: 5, zTop: 3, zBottom: 12 } });
    expect(stockBox(j, computePlacement(j.model!, RECT_POINTS))).toEqual({ min: vec3(-55, -35, -12), max: vec3(55, 35, 0) });
    const fixed = setStock(job('drawing'), { mode: 'fixed', size: vec3(120, 80, 10), modelOffset: vec3(10, 10, 99) });
    expect(stockBox(fixed, computePlacement(fixed.model!, RECT_POINTS))).toEqual({ min: vec3(-60, -40, -10), max: vec3(60, 40, 0) });
  });

  it('places fixed stock relative to the model', () => {
    const j = setStock(job('mesh'), { mode: 'fixed', size: vec3(30, 20, 8), modelOffset: vec3(2, 3, 1) });
    expect(stockBox(j, computePlacement(j.model!, BOX_POINTS))).toEqual({ min: vec3(-12, -8, -1), max: vec3(18, 12, 7) });
  });

  it('round-trips auto stock through fixedStockFromBox', () => {
    const j = job('mesh');
    const placement = computePlacement(j.model!, BOX_POINTS)!;
    const auto = stockBox(j, placement)!;
    const fixed = setStock(j, fixedStockFromBox(auto, placement.bbox));
    expect(stockBox(fixed, placement)).toEqual(auto);
  });

  it('is null without a model', () => {
    expect(stockBox(createJob(), null)).toBeNull();
  });
});

describe('wcsPoint', () => {
  const stock = { min: vec3(-15, -10, 0), max: vec3(15, 10, 6) };

  it('covers every anchor combination', () => {
    const xs: Record<AxisAnchor, number> = { min: -15, center: 0, max: 15 };
    const ys: Record<AxisAnchor, number> = { min: -10, center: 0, max: 10 };
    const zs: Record<ZAnchor, number> = { top: 6, bottom: 0 };
    for (const x of ['min', 'center', 'max'] as const) {
      for (const y of ['min', 'center', 'max'] as const) {
        for (const z of ['top', 'bottom'] as const) {
          const p = wcsPoint({ anchor: { x, y, z }, offset: vec3(0, 0, 0), workOffset: 'G54' }, stock);
          expect(p).toEqual(vec3(xs[x], ys[y], zs[z]));
        }
      }
    }
  });

  it('adds the offset', () => {
    const p = wcsPoint({ anchor: { x: 'min', y: 'min', z: 'top' }, offset: vec3(1, 2, -3), workOffset: 'G54' }, stock);
    expect(p).toEqual(vec3(-14, -8, 3));
  });
});
