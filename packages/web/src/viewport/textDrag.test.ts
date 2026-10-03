import { describe, expect, it } from 'vitest';
import { distanceToLoops, dragPosition, planeHit } from './textDrag';

describe('planeHit', () => {
  it('hits the plane under a ray pointing straight down', () => {
    expect(planeHit({ origin: { x: 5, y: 6, z: 50 }, direction: { x: 0, y: 0, z: -1 } }, -3)).toEqual({ x: 5, y: 6, z: -3 });
  });
  it('misses with a parallel ray or a plane behind the ray', () => {
    expect(planeHit({ origin: { x: 0, y: 0, z: 5 }, direction: { x: 1, y: 0, z: 0 } }, -3)).toBeNull();
    expect(planeHit({ origin: { x: 0, y: 0, z: 5 }, direction: { x: 0, y: 0, z: 1 } }, -3)).toBeNull();
  });
});

describe('dragPosition', () => {
  const start = { x: 10, y: 20 };
  it('is null below the minimum move', () => {
    expect(dragPosition(start, { x: 1, y: 1 }, { x: 1.3, y: 1.3 }, 0.5)).toBeNull();
  });
  it('moves by the pointer delta above it', () => {
    expect(dragPosition(start, { x: 1, y: 1 }, { x: 4, y: -1 }, 0.5)).toEqual({ x: 13, y: 18 });
  });
});

describe('distanceToLoops', () => {
  const square = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
  it('measures to the nearest segment, including the closing one', () => {
    expect(distanceToLoops([square], { x: 5, y: 2 })).toBeCloseTo(2);
    expect(distanceToLoops([square], { x: -3, y: 5 })).toBeCloseTo(3);
  });
  it('treats an open loop as not closed', () => {
    expect(distanceToLoops([{ ...square, closed: false }], { x: -3, y: 5 })).toBeCloseTo(Math.hypot(3, 5));
  });
  it('is Infinity with no loops', () => {
    expect(distanceToLoops([], { x: 0, y: 0 })).toBe(Infinity);
  });
});
