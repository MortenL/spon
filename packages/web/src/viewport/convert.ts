import { type DrawingLayer, fromDisplay, type LengthUnit, type Mesh, type Quat, tessellateSegment, toDisplay } from '@sponcam/core';
import * as THREE from 'three';

export const DEFAULT_LINE_COLOR = '#d4d4d8';

export function meshToGeometry(mesh: Mesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Geometry for a subset of triangles that shares the base geometry's position buffer. */
export function subsetGeometry(base: THREE.BufferGeometry, tris: ArrayLike<number>, mesh: Mesh): THREE.BufferGeometry {
  const index = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    for (let k = 0; k < 3; k++) index[i * 3 + k] = mesh.indices[tris[i] * 3 + k];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** Start/end pairs for THREE.LineSegments, z = 0. */
export function layerLinePositions(layer: DrawingLayer, chordTol: number): Float32Array {
  const values: number[] = [];
  for (const path of layer.paths) {
    for (const segment of path.segments) {
      const pts = tessellateSegment(segment, chordTol);
      for (let i = 1; i < pts.length; i++) values.push(pts[i - 1].x, pts[i - 1].y, 0, pts[i].x, pts[i].y, 0);
    }
  }
  return Float32Array.from(values);
}

/** DXF colour as CSS; white/black (ACI 7) use a neutral colour that reads on the dark viewport. */
export function lineColor(color: number): string {
  return color === 0xffffff || color === 0 ? DEFAULT_LINE_COLOR : `#${color.toString(16).padStart(6, '0')}`;
}

export const toThreeQuaternion = (q: Quat) => new THREE.Quaternion(q.x, q.y, q.z, q.w);

/** Grid spacing in mm: roughly 1/15 of the view distance, rounded to 1-2-5 steps in the display unit. */
export function niceGridStep(viewDistanceMm: number, units: LengthUnit): number {
  const target = toDisplay(Math.max(viewDistanceMm, 1e-6) / 15, units);
  const base = 10 ** Math.floor(Math.log10(target));
  const f = target / base;
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return fromDisplay(nice * base, units);
}
