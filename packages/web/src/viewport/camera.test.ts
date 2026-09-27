import { vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { fitDistance, sceneBounds } from './camera';

describe('camera helpers', () => {
  it('unions boxes and falls back to a 100 mm cube', () => {
    expect(sceneBounds([{ min: vec3(0, 0, 0), max: vec3(1, 1, 1) }, null, { min: vec3(-2, 0, 0), max: vec3(0, 3, 1) }]))
      .toEqual({ min: vec3(-2, 0, 0), max: vec3(1, 3, 1) });
    expect(sceneBounds([null])).toEqual({ min: vec3(-50, -50, 0), max: vec3(50, 50, 50) });
  });

  it('fits a sphere inside the narrower field of view', () => {
    expect(fitDistance(10, 90, 1)).toBeCloseTo((10 / Math.sin(Math.PI / 4)) * 1.1, 9);
    expect(fitDistance(10, 90, 0.5)).toBeGreaterThan(fitDistance(10, 90, 1));
  });
});
