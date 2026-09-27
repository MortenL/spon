import type { DrawingLayer, Mesh } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LINE_COLOR, layerLinePositions, lineColor, meshToGeometry, niceGridStep, subsetGeometry } from './convert';

const mesh: Mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
  indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1]),
};

describe('convert', () => {
  it('builds indexed buffer geometry and triangle subsets', () => {
    const geometry = meshToGeometry(mesh);
    expect(geometry.getAttribute('position').count).toBe(4);
    expect(Array.from(geometry.getIndex()!.array)).toEqual([0, 1, 2, 1, 3, 2]);
    const subset = subsetGeometry(mesh, [1]);
    expect(subset.getIndex()).toBeNull();
    expect(subset.getAttribute('position').count).toBe(3);
    expect(Array.from(subset.getAttribute('position').array)).toEqual([1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(subset.getAttribute('position')).not.toBe(geometry.getAttribute('position'));
  });

  it('turns drawing layers into line-segment pairs', () => {
    const layer: DrawingLayer = { name: 'A', color: 0xff0000, paths: [{ closed: false, segments: [{ kind: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }] }] };
    expect(Array.from(layerLinePositions(layer, 0.01))).toEqual([0, 0, 0, 10, 0, 0]);
  });

  it('maps DXF colours, using the default for white and black', () => {
    expect(lineColor(0xff0000)).toBe('#ff0000');
    expect(lineColor(0x0000ff)).toBe('#0000ff');
    expect(lineColor(0xffffff)).toBe(DEFAULT_LINE_COLOR);
    expect(lineColor(0)).toBe(DEFAULT_LINE_COLOR);
  });

  it('picks 1-2-5 grid steps in display units', () => {
    expect(niceGridStep(150, 'mm')).toBe(10);
    expect(niceGridStep(45, 'mm')).toBe(2);
    expect(niceGridStep(1500, 'mm')).toBe(100);
    expect(niceGridStep(254, 'in')).toBeCloseTo(12.7, 9); // 0.5 in
  });
});
