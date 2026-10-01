import { AFFINE_IDENTITY, type Affine2D, affineMultiply, affineScale, affineTranslate } from '../dxf/affine2d';
import type { Vec2 } from '../../geometry/path2d';
import type { XmlElement } from './xml';

/** CSS px per unit; CSS fixes 96 px per inch. */
const PX_PER: Record<string, number> = { '': 1, px: 1, mm: 96 / 25.4, cm: 960 / 25.4, in: 96, pt: 96 / 72, pc: 16 };
const ABSOLUTE = new Set(['mm', 'cm', 'in', 'pt', 'pc']);

/** A length in CSS px; null for missing, percentage or unknown units. */
export function parseLength(v: string | undefined): { px: number; absolute: boolean } | null {
  const m = v === undefined ? null : /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$/.exec(v);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const per = PX_PER[unit];
  return per === undefined ? null : { px: Number(m[1]) * per, absolute: ABSOLUTE.has(unit) };
}

export interface SvgViewport {
  /** Root user units → CSS px (viewBox and preserveAspectRatio applied). */
  userToPx: Affine2D;
  /** Viewport size in px, when the file gives one. */
  size: Vec2 | null;
  /** True when the root width or height is in mm, cm, in, pt or pc. */
  absolute: boolean;
}

export function svgViewport(root: XmlElement): SvgViewport {
  const w = parseLength(root.attrs.width), h = parseLength(root.attrs.height);
  const absolute = Boolean(w?.absolute || h?.absolute);
  const vbNums = root.attrs.viewBox?.trim().split(/[\s,]+/).map(Number);
  const vb = vbNums && vbNums.length === 4 && vbNums.every(Number.isFinite) && vbNums[2] > 0 && vbNums[3] > 0
    ? { x: vbNums[0], y: vbNums[1], w: vbNums[2], h: vbNums[3] } : null;
  if (!vb) return { userToPx: AFFINE_IDENTITY, size: w && h ? { x: w.px, y: h.px } : null, absolute };
  const width = w?.px ?? (h ? (h.px * vb.w) / vb.h : vb.w);
  const height = h?.px ?? (w ? (w.px * vb.h) / vb.w : vb.h);
  let sx = width / vb.w, sy = height / vb.h;
  let tx = 0, ty = 0;
  const par = (root.attrs.preserveAspectRatio ?? 'xMidYMid meet').trim().split(/\s+/);
  if (par[0] !== 'none') {
    const s = par[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    const align = (key: 'x' | 'y', free: number) => {
      const a = par[0];
      const part = key === 'x' ? a.slice(1, 4) : a.slice(5, 8);
      return part === 'Min' ? 0 : part === 'Max' ? free : free / 2;
    };
    tx = align('x', width - vb.w * s);
    ty = align('y', height - vb.h * s);
    sx = sy = s;
  }
  const userToPx = affineMultiply(affineTranslate(tx, ty), affineMultiply(affineScale(sx, sy), affineTranslate(-vb.x, -vb.y)));
  return { userToPx, size: { x: width, y: height }, absolute };
}
