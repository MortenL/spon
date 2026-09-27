import { type BBox, vec3 } from '@sponcam/core';
import type { ViewPreset } from '../state/store';

export type Direction = [number, number, number];

/** Direction from the target towards the camera. Z is up, Y points away from the viewer. */
export const VIEW_DIRECTIONS: Record<Exclude<ViewPreset, 'fit'>, Direction> = {
  top: [0, -1e-4, 1], // tiny tilt keeps OrbitControls away from the pole
  front: [0, -1, 0],
  right: [1, 0, 0],
  iso: [1, -1, 0.8],
};

export function sceneBounds(boxes: (BBox | null)[]): BBox {
  const present = boxes.filter((b): b is BBox => b !== null);
  if (present.length === 0) return { min: vec3(-50, -50, 0), max: vec3(50, 50, 50) };
  return {
    min: vec3(Math.min(...present.map((b) => b.min.x)), Math.min(...present.map((b) => b.min.y)), Math.min(...present.map((b) => b.min.z))),
    max: vec3(Math.max(...present.map((b) => b.max.x)), Math.max(...present.map((b) => b.max.y)), Math.max(...present.map((b) => b.max.z))),
  };
}

/** Camera distance at which a sphere of `radius` fits the view (10 % margin). */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1;
}
