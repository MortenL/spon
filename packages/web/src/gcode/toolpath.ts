import { arcGeometry, arcPointInto, arcStepCount, type MotionTable, MoveKind, type Plane, rowStart } from '@sponcam/core';

/** RGB 0–1: rapids orange, feeds blue, plunges magenta (exact binary fractions). */
export const TOOLPATH_COLORS = {
  rapid: [1, 0.625, 0.125],
  feed: [0.25, 0.5, 1],
  plunge: [0.875, 0.25, 0.875],
} as const;

export interface ToolpathBuffers {
  /** Line-segment vertex pairs, program coordinates. */
  positions: Float32Array;
  colors: Float32Array;
  /** Cumulative vertex count after each row (for draw-range splitting). */
  rowVertexEnd: Uint32Array;
}

const isArc = (kind: number) => kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW;

/**
 * Stable identity for the geometry buildToolpathBuffers reads from a MotionTable (everything
 * except `t`, timing): a memo keyed on these stays put across reanalyzeAll's `{...table, t}`
 * re-timing pass, which shares these arrays but replaces the table wrapper itself, unlike a memo
 * keyed on `table` directly, which would rebuild and re-upload every toolpath buffer on every
 * re-analysis.
 */
export function toolpathGeometryKey(table: MotionTable): readonly unknown[] {
  return [table.kind, table.end, table.arc, table.plane, table.start, table.count];
}

export function buildToolpathBuffers(table: MotionTable, opts: { showRapids: boolean; chordTol?: number }): ToolpathBuffers {
  const tol = opts.chordTol ?? 0.01;
  const s = [0, 0, 0];
  const e = [0, 0, 0];
  const c = [0, 0, 0];
  const steps = new Uint32Array(table.count); // segments per row
  const rowVertexEnd = new Uint32Array(table.count);
  let vertices = 0;
  for (let i = 0; i < table.count; i++) {
    const kind = table.kind[i];
    let n = 0;
    if (kind === MoveKind.Rapid) n = opts.showRapids ? 1 : 0;
    else if (kind === MoveKind.Feed) n = 1;
    else if (isArc(kind)) {
      rowStart(table, i, s);
      for (let k = 0; k < 3; k++) {
        e[k] = table.end[i * 3 + k];
        c[k] = table.arc[i * 3 + k];
      }
      const g = arcGeometry(s, e, c, table.plane[i] as Plane, kind === MoveKind.ArcCW);
      n = arcStepCount(g.r, Math.abs(g.sweep), tol);
    }
    steps[i] = n;
    vertices += n * 2;
    rowVertexEnd[i] = vertices;
  }

  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  let v = 0;
  const put = (p: number[], rgb: readonly number[]) => {
    positions[v * 3] = p[0];
    positions[v * 3 + 1] = p[1];
    positions[v * 3 + 2] = p[2];
    colors[v * 3] = rgb[0];
    colors[v * 3 + 1] = rgb[1];
    colors[v * 3 + 2] = rgb[2];
    v++;
  };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (let i = 0; i < table.count; i++) {
    const n = steps[i];
    if (n === 0) continue;
    const kind = table.kind[i];
    rowStart(table, i, s);
    for (let k = 0; k < 3; k++) {
      e[k] = table.end[i * 3 + k];
      c[k] = table.arc[i * 3 + k];
    }
    if (!isArc(kind)) {
      const plungeMove = kind === MoveKind.Feed && e[2] < s[2] && Math.hypot(e[0] - s[0], e[1] - s[1]) < 1e-6;
      const rgb = kind === MoveKind.Rapid ? TOOLPATH_COLORS.rapid : plungeMove ? TOOLPATH_COLORS.plunge : TOOLPATH_COLORS.feed;
      put(s, rgb);
      put(e, rgb);
      continue;
    }
    const g = arcGeometry(s, e, c, table.plane[i] as Plane, kind === MoveKind.ArcCW);
    arcPointInto(g, s, 0, a);
    for (let k = 1; k <= n; k++) {
      arcPointInto(g, s, k / n, b);
      put(a, TOOLPATH_COLORS.feed);
      put(b, TOOLPATH_COLORS.feed);
      a[0] = b[0];
      a[1] = b[1];
      a[2] = b[2];
    }
  }
  return { positions, colors, rowVertexEnd };
}
