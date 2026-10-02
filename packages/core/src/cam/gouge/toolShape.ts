import type { Tool } from '../../tools/types';

/**
 * A tool as a surface of revolution under its tip.
 * - torus: flat (cornerRadius 0), ball (cornerRadius = radius) and bull-nose cutters;
 * - cone: V-bits, chamfer mills and drills, `halfAngle` in radians from the axis.
 */
export interface ToolShape {
  radius: number;
  kind: 'torus' | 'cone';
  cornerRadius: number;
  halfAngle: number;
}

const FLAT_TIP_DEG = 179.9;

export function toolShape(tool: Tool): ToolShape {
  const radius = tool.diameter / 2;
  switch (tool.type) {
    case 'ball':
      return { radius, kind: 'torus', cornerRadius: radius, halfAngle: 0 };
    case 'bull':
      return { radius, kind: 'torus', cornerRadius: Math.min(Math.max(tool.cornerRadius, 0), radius), halfAngle: 0 };
    case 'vbit':
    case 'chamfer':
    case 'drill':
      if (!(tool.tipAngleDeg > 0) || tool.tipAngleDeg >= FLAT_TIP_DEG) return { radius, kind: 'torus', cornerRadius: 0, halfAngle: 0 };
      return { radius, kind: 'cone', cornerRadius: 0, halfAngle: (tool.tipAngleDeg / 2) * (Math.PI / 180) };
    default:
      return { radius, kind: 'torus', cornerRadius: 0, halfAngle: 0 };
  }
}

/** Height of the tool surface above the tip at radial distance d from the axis (Infinity beyond the radius). */
export function profileHeight(shape: ToolShape, d: number): number {
  if (d > shape.radius) return Infinity;
  if (shape.kind === 'cone') return d / Math.tan(shape.halfAngle);
  const rc = shape.cornerRadius;
  const k = shape.radius - rc;
  if (d <= k) return 0;
  const e = d - k;
  return rc - Math.sqrt(Math.max(0, rc * rc - e * e));
}
