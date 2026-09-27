export interface Vec2 {
  x: number;
  y: number;
}

export interface LineSegment {
  kind: 'line';
  from: Vec2;
  to: Vec2;
}

/** Circular arc. Angles in radians; `sweep` is signed (positive = counter-clockwise) with |sweep| in (0, 2π]. */
export interface ArcSegment {
  kind: 'arc';
  center: Vec2;
  radius: number;
  startAngle: number;
  sweep: number;
}

export type Segment = LineSegment | ArcSegment;

export interface Path2D {
  segments: Segment[];
  closed: boolean;
}

export const arcPoint = (arc: ArcSegment, angle: number): Vec2 => ({
  x: arc.center.x + arc.radius * Math.cos(angle),
  y: arc.center.y + arc.radius * Math.sin(angle),
});

export const segmentStart = (s: Segment): Vec2 => (s.kind === 'line' ? s.from : arcPoint(s, s.startAngle));
export const segmentEnd = (s: Segment): Vec2 => (s.kind === 'line' ? s.to : arcPoint(s, s.startAngle + s.sweep));

/** Upper bound on chords per full circle, so absurd radii cannot produce millions of points (or Infinity). */
export const MAX_ARC_STEPS = 4096;

/**
 * Number of chords needed so that no chord deviates from the arc by more than `chordTol`,
 * capped at MAX_ARC_STEPS per full turn (scaled by the sweep) and never below 1.
 */
export function arcStepCount(radius: number, sweepAbs: number, chordTol: number): number {
  const turns = Number.isFinite(sweepAbs) ? Math.min(Math.abs(sweepAbs), 2 * Math.PI) / (2 * Math.PI) : 1;
  const cap = Math.max(1, Math.ceil(MAX_ARC_STEPS * turns));
  const step = chordTol >= radius ? Math.PI / 2 : 2 * Math.acos(1 - chordTol / radius);
  const n = Math.ceil(Math.abs(sweepAbs) / step);
  return Number.isFinite(n) ? Math.min(cap, Math.max(1, n)) : cap;
}

export function tessellateSegment(s: Segment, chordTol = 0.01): Vec2[] {
  if (s.kind === 'line') return [s.from, s.to];
  const n = arcStepCount(s.radius, Math.abs(s.sweep), chordTol);
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(arcPoint(s, s.startAngle + (s.sweep * i) / n));
  return pts;
}

/** Points along a path; the shared point between consecutive segments appears once. */
export function tessellatePath(path: Path2D, chordTol = 0.01): Vec2[] {
  const out: Vec2[] = [];
  for (const s of path.segments) {
    const pts = tessellateSegment(s, chordTol);
    out.push(...(out.length ? pts.slice(1) : pts));
  }
  return out;
}

/** All tessellated points of the paths as a flat xyz array (z = 0). */
export function pathsToPoints(paths: readonly Path2D[], chordTol = 0.01): Float32Array {
  const values: number[] = [];
  for (const path of paths) for (const p of tessellatePath(path, chordTol)) values.push(p.x, p.y, 0);
  return Float32Array.from(values);
}
