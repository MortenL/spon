import { arcPoint, type Path2D, type Segment, tessellateSegment, type Vec2 } from '../../geometry/path2d';
import { affineApply, affineDeterminant, affineMaxStretch, type Affine2D, isSimilarity } from './affine2d';

const TAU = 2 * Math.PI;

const xy = (p: Vec2): Vec2 => ({ x: p.x, y: p.y }); // drops z from DXF points

export function lineToPath(a: Vec2, b: Vec2): Path2D {
  return { segments: [{ kind: 'line', from: xy(a), to: xy(b) }], closed: false };
}

/** DXF ARC: counter-clockwise from startAngle to endAngle (radians). */
export function arcToPath(center: Vec2, radius: number, startAngle: number, endAngle: number): Path2D {
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += TAU;
  if (sweep > TAU + 1e-12) sweep -= TAU * Math.floor(sweep / TAU);
  return { segments: [{ kind: 'arc', center: xy(center), radius, startAngle, sweep }], closed: false };
}

export function circleToPath(center: Vec2, radius: number): Path2D {
  return { segments: [{ kind: 'arc', center: xy(center), radius, startAngle: 0, sweep: TAU }], closed: true };
}

/** Polyline segment from p1 to p2 where bulge = tan(sweep / 4); a positive bulge turns counter-clockwise. */
export function bulgeSegment(p1: Vec2, p2: Vec2, bulge: number): Segment {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (Math.abs(bulge) < 1e-12 || Math.hypot(dx, dy) < 1e-12) return { kind: 'line', from: xy(p1), to: xy(p2) };
  // The centre sits on the chord's perpendicular bisector, (1 - b²) / (4b) chord-lengths to the left.
  const offset = (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (p1.x + p2.x) / 2 - dy * offset, y: (p1.y + p2.y) / 2 + dx * offset };
  return {
    kind: 'arc',
    center,
    radius: Math.hypot(p1.x - center.x, p1.y - center.y),
    startAngle: Math.atan2(p1.y - center.y, p1.x - center.x),
    sweep: 4 * Math.atan(bulge),
  };
}

export function polylineToPath(vertices: readonly (Vec2 & { bulge?: number })[], closed: boolean): Path2D {
  const segments: Segment[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-12) continue;
    segments.push(bulgeSegment(a, b, a.bulge ?? 0));
  }
  return { segments, closed };
}

export function transformSegment(s: Segment, m: Affine2D, chordTol: number): Segment[] {
  if (s.kind === 'line') return [{ kind: 'line', from: affineApply(m, s.from), to: affineApply(m, s.to) }];
  if (isSimilarity(m)) {
    const det = affineDeterminant(m);
    const center = affineApply(m, s.center);
    const start = affineApply(m, arcPoint(s, s.startAngle));
    return [{
      kind: 'arc',
      center,
      radius: s.radius * Math.sqrt(Math.abs(det)),
      startAngle: Math.atan2(start.y - center.y, start.x - center.x),
      sweep: det < 0 ? -s.sweep : s.sweep,
    }];
  }
  // Non-uniform scale: the arc becomes part of an ellipse, so flatten it (tolerance measured after stretching).
  const stretch = affineMaxStretch(m);
  const pts = tessellateSegment(s, chordTol / stretch).map((p) => affineApply(m, p));
  const out: Segment[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ kind: 'line', from: pts[i - 1], to: pts[i] });
  return out;
}

export function transformPath(path: Path2D, m: Affine2D, chordTol: number): Path2D {
  return { segments: path.segments.flatMap((s) => transformSegment(s, m, chordTol)), closed: path.closed };
}
