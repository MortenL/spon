import { type DrawingLayer, fromDisplay, type LengthUnit, type Mesh, type Quat, tessellateSegment, toDisplay } from '@sponcam/core';
import * as THREE from 'three';

export const DEFAULT_LINE_COLOR = '#d4d4d8';

/** A planar region (outer boundary with holes) as a three.js shape. */
export function regionShape(region: { outer: readonly { x: number; y: number }[]; holes: readonly (readonly { x: number; y: number }[])[] }): THREE.Shape {
  const shape = new THREE.Shape(region.outer.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const hole of region.holes) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
  return shape;
}

export function meshToGeometry(mesh: Mesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Standalone geometry for a subset of triangles (owns its buffers, safe to dispose). */
export function subsetGeometry(mesh: Mesh, tris: ArrayLike<number>): THREE.BufferGeometry {
  const positions = new Float32Array(tris.length * 9);
  for (let i = 0; i < tris.length; i++) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[tris[i] * 3 + k];
      positions[i * 9 + k * 3] = mesh.positions[v * 3];
      positions[i * 9 + k * 3 + 1] = mesh.positions[v * 3 + 1];
      positions[i * 9 + k * 3 + 2] = mesh.positions[v * 3 + 2];
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
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
