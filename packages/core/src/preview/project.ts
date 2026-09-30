import type { Vec3 } from '../geometry/vec3';

export type PreviewView = 'top' | 'front' | 'iso';
export const PREVIEW_VIEWS: readonly PreviewView[] = ['top', 'front', 'iso'];

const R2 = Math.SQRT1_2;
const EL = Math.PI / 6; // iso: 30° above the horizon

/** Screen right, screen up and towards-the-viewer unit vectors (orthographic). */
const AXES: Readonly<Record<PreviewView, { right: Vec3; up: Vec3; toward: Vec3 }>> = {
  top: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, toward: { x: 0, y: 0, z: 1 } },
  front: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, toward: { x: 0, y: -1, z: 0 } },
  // seen from the front right (+X, −Y) at 45° azimuth
  iso: {
    right: { x: R2, y: R2, z: 0 },
    up: { x: -R2 * Math.sin(EL), y: R2 * Math.sin(EL), z: Math.cos(EL) },
    toward: { x: R2 * Math.cos(EL), y: -R2 * Math.cos(EL), z: Math.sin(EL) },
  },
};

/** A point on the drawing plane in mm (y up) and its depth (larger is nearer the viewer). */
export interface Projected { x: number; y: number; depth: number }

export function projector(view: PreviewView): (p: Vec3) => Projected {
  const { right: r, up: u, toward: t } = AXES[view];
  return (p) => ({
    x: p.x * r.x + p.y * r.y + p.z * r.z,
    y: p.x * u.x + p.y * u.y + p.z * u.z,
    depth: p.x * t.x + p.y * t.y + p.z * t.z,
  });
}
