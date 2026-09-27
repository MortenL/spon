import { describe, expect, it } from 'vitest';
import { bboxCenter, bboxOfPoints, bboxSize } from '../src/geometry/bbox';
import {
  QUAT_IDENTITY, quatConjugate, quatFromAxisAngle, quatFromUnitVectors, quatMultiply, quatRotate,
} from '../src/geometry/quat';
import { X_AXIS, Z_AXIS, v3cross, v3near, v3normalize, vec3 } from '../src/geometry/vec3';

const DOWN = vec3(0, 0, -1);

describe('vec3', () => {
  it('computes cross products and normalises safely', () => {
    expect(v3cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
    expect(v3normalize(vec3(0, 3, 4))).toEqual(vec3(0, 0.6, 0.8));
    expect(v3normalize(vec3(0, 0, 0))).toEqual(vec3(0, 0, 0));
  });
});

describe('quat', () => {
  it('rotates vectors about an axis by degrees', () => {
    expect(v3near(quatRotate(quatFromAxisAngle(Z_AXIS, 90), X_AXIS), vec3(0, 1, 0))).toBe(true);
    expect(v3near(quatRotate(quatFromAxisAngle(X_AXIS, 90), vec3(0, 0, 1)), vec3(0, -1, 0))).toBe(true);
  });

  it('multiplies so that the right-hand rotation applies first', () => {
    const rz = quatFromAxisAngle(Z_AXIS, 90);
    const rx = quatFromAxisAngle(X_AXIS, 90);
    // rx takes +Z to -Y, then rz takes -Y to +X
    expect(v3near(quatRotate(quatMultiply(rz, rx), vec3(0, 0, 1)), vec3(1, 0, 0))).toBe(true);
  });

  it('undoes a rotation with the conjugate', () => {
    const q = quatFromAxisAngle(v3normalize(vec3(1, 2, 3)), 37);
    const v = vec3(0.3, -2, 5);
    expect(v3near(quatRotate(quatConjugate(q), quatRotate(q, v)), v)).toBe(true);
  });

  it('maps unit vectors onto -Z, including the parallel and antiparallel cases', () => {
    const normals = [
      v3normalize(vec3(1, 2, 3)), vec3(0, -1, 0), vec3(1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1),
      v3normalize(vec3(-0.2, 0.1, -0.97)),
    ];
    for (const n of normals) {
      expect(v3near(quatRotate(quatFromUnitVectors(n, DOWN), n), DOWN, 1e-9)).toBe(true);
    }
    expect(quatFromUnitVectors(DOWN, DOWN)).toEqual(QUAT_IDENTITY);
  });
});

describe('bbox', () => {
  it('bounds a flat xyz array, optionally mapping points', () => {
    const points = [0, 0, 0, 20, 10, 5, 3, -1, 2];
    const box = bboxOfPoints(points)!;
    expect(box).toEqual({ min: vec3(0, -1, 0), max: vec3(20, 10, 5) });
    expect(bboxSize(box)).toEqual(vec3(20, 11, 5));
    expect(bboxCenter(box)).toEqual(vec3(10, 4.5, 2.5));
    const doubled = bboxOfPoints(points, (x, y, z) => vec3(2 * x, 2 * y, 2 * z))!;
    expect(doubled.max).toEqual(vec3(40, 20, 10));
  });

  it('returns null for no points', () => {
    expect(bboxOfPoints([])).toBeNull();
  });
});
