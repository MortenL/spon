import { describe, expect, it } from 'vitest';
import { distanceToLoops, dragBegin, dragPosition, dragStep, dragStillValid, loopsBox, nearBox, planeHit } from './textDrag';

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

describe('dragStep', () => {
  const begin = () => dragBegin('t', { x: 10, y: 20 }, { x: 1, y: 1 }, 0).state!;
  it('disables orbit while dragging, shows the offset and commits once on up', () => {
    expect(dragBegin('t', { x: 10, y: 20 }, { x: 1, y: 1 }, 0).orbitEnabled).toBe(false);
    const m = dragStep(begin(), { type: 'move', hit: { x: 4, y: 1 } }, 0.5);
    expect(m).toMatchObject({ commit: null, orbitEnabled: false, state: { offset: { x: 3, y: 0 } } });
    const u = dragStep(m.state, { type: 'up', hit: { x: 4, y: 1 } }, 0.5);
    expect(u).toEqual({ state: null, commit: { x: 13, y: 20 }, orbitEnabled: true });
  });
  it('cancel (Escape, pointercancel, blur) re-enables orbit and never commits', () => {
    const m = dragStep(begin(), { type: 'move', hit: { x: 4, y: 1 } }, 0.5);
    expect(dragStep(m.state, { type: 'cancel' }, 0.5)).toEqual({ state: null, commit: null, orbitEnabled: true });
  });
  it('a pointerup after a cancel commits nothing', () => {
    const c = dragStep(begin(), { type: 'cancel' }, 0.5);
    expect(dragStep(c.state, { type: 'up', hit: { x: 9, y: 9 } }, 0.5).commit).toBeNull();
  });
  it('a short drag is a click: no commit', () => {
    expect(dragStep(begin(), { type: 'up', hit: { x: 1.2, y: 1 } }, 0.5).commit).toBeNull();
  });
});

describe('dragStillValid / nearBox', () => {
  const s = dragBegin('t', { x: 0, y: 0 }, { x: 0, y: 0 }, 0).state!;
  it('requires the text to exist and stay selected', () => {
    expect(dragStillValid(s, ['t'], 't')).toBe(true);
    expect(dragStillValid(s, [], 't')).toBe(false);
    expect(dragStillValid(s, ['t'], 'other')).toBe(false);
  });
  it('tests the grown bounding box', () => {
    const loops = [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }];
    const box = loopsBox(loops);
    expect(nearBox(box, { x: 11, y: 5 }, 1.5)).toBe(true);
    expect(nearBox(box, { x: 12, y: 5 }, 1.5)).toBe(false);
  });
});
