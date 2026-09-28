/**
 * Scaled virtualisation for very long lists (up to ~2M rows).
 *
 * Browsers cap scrollable element heights (Chromium ~33.5M px, Firefox ~17.9M px); a naive
 * `count * rowHeight` spacer becomes unreachable past that limit at row heights and counts in
 * this tool's range. `MAX_SPACER_PX` sets a comfortable margin under the smallest limit.
 *
 * Below the cap, scroll position maps to a line 1:1 (`scrollTop / rowHeight`). Above it, the
 * capped scroll range [0, MAX_SPACER_PX - viewport] is linearly rescaled across the full line
 * range [0, count - visibleRows], so every line stays reachable at the cost of scroll-speed
 * feeling nonlinear for huge files.
 */
export const MAX_SPACER_PX = 8_000_000;

/** Whether `count` rows of `rowHeight` px need the scaled mapping instead of a 1:1 spacer. */
export function isScaled(count: number, rowHeight: number): boolean {
  return count * rowHeight > MAX_SPACER_PX;
}

/** Height (px) of the scroll spacer: the real content height, capped at `MAX_SPACER_PX`. */
export function spacerHeight(count: number, rowHeight: number): number {
  return Math.min(count * rowHeight, MAX_SPACER_PX);
}

/**
 * Maps a scroll position (within the capped spacer) to the index of the first line to show.
 * Below the cap this is the exact `scrollTop / rowHeight`, floored; above it, scrollTop is
 * linearly rescaled across the full line range.
 */
export function scrollTopToFirstLine(scrollTop: number, viewport: number, count: number, rowHeight: number): number {
  if (count <= 0) return 0;
  if (!isScaled(count, rowHeight)) return Math.floor(scrollTop / rowHeight);
  const visibleRows = viewport / rowHeight;
  const maxFirst = Math.max(count - visibleRows, 0);
  const maxScroll = Math.max(MAX_SPACER_PX - viewport, 1);
  const clampedScroll = Math.min(Math.max(scrollTop, 0), maxScroll);
  const first = Math.floor((clampedScroll / maxScroll) * maxFirst);
  return Math.min(Math.max(first, 0), Math.max(count - 1, 0));
}

/** Inverse of `scrollTopToFirstLine`: the scroll position that makes `line` the first visible line. */
export function lineToScrollTop(line: number, viewport: number, count: number, rowHeight: number): number {
  if (count <= 0) return 0;
  const clampedLine = Math.min(Math.max(line, 0), count - 1);
  if (!isScaled(count, rowHeight)) return clampedLine * rowHeight;
  const visibleRows = viewport / rowHeight;
  const maxFirst = Math.max(count - visibleRows, 0);
  if (maxFirst <= 0) return 0;
  const maxScroll = Math.max(MAX_SPACER_PX - viewport, 1);
  return (clampedLine / maxFirst) * maxScroll;
}
