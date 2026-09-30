/**
 * Screen-space decimation of a polyline given as flat [x0, y0, x1, y1, …] pixels. It drops points closer than
 * `minStep` to the last kept point, and points within `maxDeviation` of the segment from the last kept point to the
 * next point. The first and last points are always kept.
 */
export function simplifyPolyline(points: readonly number[], minStep = 0.5, maxDeviation = 0.25): number[] {
  const n = points.length / 2;
  if (n <= 2) return [...points];
  const out = [points[0], points[1]];
  let kx = points[0];
  let ky = points[1];
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    if (Math.hypot(x - kx, y - ky) < minStep) continue;
    const dx = points[i * 2 + 2] - kx;
    const dy = points[i * 2 + 3] - ky;
    const len2 = dx * dx + dy * dy;
    const along = (x - kx) * dx + (y - ky) * dy;
    if (len2 > 0 && along > 0 && along < len2 && Math.abs((x - kx) * dy - (y - ky) * dx) / Math.sqrt(len2) < maxDeviation) continue;
    out.push(x, y);
    kx = x;
    ky = y;
  }
  out.push(points[n * 2 - 2], points[n * 2 - 1]);
  return out;
}
