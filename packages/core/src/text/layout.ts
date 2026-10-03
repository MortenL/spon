import type { Shape } from '../cam/features/chain';
import type { Path2D, Vec2 } from '../geometry/path2d';
import { polysToRegions, type Poly } from '../geometry/offset/clipper';
import { orientPath, pathFromPoints } from '../geometry/offset/pathOps';
import type { LoadedFont } from './fonts';
import type { TextItem } from './types';

export type TextLayoutError = 'text-empty' | 'text-fit' | 'text-arc';
export interface TextLayout {
  /** Outline fonts: unioned regions; each region is one Shape (outer CCW, islands CW). Empty for single-line fonts. */
  shapes: Shape[];
  /** Single-line fonts: open polylines. Empty for outline fonts. */
  strokes: Path2D[];
  /** Characters the font lacks (each once, in order of first use). */
  missing: string[];
  /** Ink bounds, stock coordinates; null if nothing was drawn. */
  bounds: { min: Vec2; max: Vec2 } | null;
  error: TextLayoutError | null;
}

/** One drawn glyph: points relative to its advance-centre on the baseline (mm, before fit), plus its line placement. */
interface Placed {
  line: number;
  u: number; // advance-centre x on the line, before alignment shift (mm)
  loops: Vec2[][];
  strokes: Vec2[][];
}

const failure = (error: TextLayoutError, missing: string[] = []): TextLayout => ({ shapes: [], strokes: [], missing, bounds: null, error });

function compute(item: TextItem, font: LoadedFont, tol: number): TextLayout {
  if (item.text.trim() === '') return failure('text-empty');
  const k = item.size / font.capHeight;
  const flatTol = Math.max(tol, 0.001) / k;

  const missing: string[] = [];
  const placed: Placed[] = [];
  const widths: number[] = [];
  const lines = item.text.split('\n');
  lines.forEach((text, li) => {
    let x = 0;
    let prev: string | null = null;
    let drawn = false;
    for (const ch of [...text]) {
      const g = ch === '\t' ? null : font.glyph(ch, flatTol);
      if (!g) {
        if (ch === ' ') {
          x += 0.25 * font.unitsPerEm * k + item.letterSpacing;
          drawn = true;
          prev = null;
        } else if (!missing.includes(ch)) missing.push(ch);
        continue;
      }
      if (prev !== null) x += font.kerning(prev, ch) * k;
      const cx = (g.advance * k) / 2;
      const rel = (ps: readonly Vec2[]): Vec2[] => ps.map((p) => ({ x: p.x * k - cx, y: p.y * k }));
      placed.push({ line: li, u: x + cx, loops: g.loops.map(rel), strokes: g.strokes.map(rel) });
      x += g.advance * k + item.letterSpacing;
      prev = ch;
      drawn = true;
    }
    widths.push(drawn ? x - item.letterSpacing : 0);
  });

  const maxW = Math.max(...widths);
  const lineH = item.lineSpacing * item.size;
  const shift = (li: number) => (item.align === 'left' ? 0 : item.align === 'center' ? (maxW - widths[li]) / 2 : maxW - widths[li]);
  const straight = (p: Placed, q: Vec2): Vec2 => ({ x: p.u + shift(p.line) + q.x, y: -p.line * lineH + q.y });

  // Ink bounds of the straight block, for fit.
  const inkBounds = (pts: Iterable<Vec2>) => {
    let b: { min: Vec2; max: Vec2 } | null = null;
    for (const p of pts) {
      if (!b) b = { min: { x: p.x, y: p.y }, max: { x: p.x, y: p.y } };
      else {
        b.min.x = Math.min(b.min.x, p.x); b.min.y = Math.min(b.min.y, p.y);
        b.max.x = Math.max(b.max.x, p.x); b.max.y = Math.max(b.max.y, p.y);
      }
    }
    return b;
  };
  function* straightPoints(): Generator<Vec2> {
    for (const p of placed) for (const l of [...p.loops, ...p.strokes]) for (const q of l) yield straight(p, q);
  }
  const block = inkBounds(straightPoints());
  if (!block) return { shapes: [], strokes: [], missing, bounds: null, error: null };

  let s = 1;
  if (item.fit) {
    const W = block.max.x - block.min.x;
    const H = block.max.y - block.min.y;
    s = Math.min(1, W > 0 ? item.fit.width / W : 1, item.fit.height && H > 0 ? item.fit.height / H : 1);
    if (item.size * s < 1) return failure('text-fit', missing);
  }

  // Place every point (before anchor/mirror/rotate/position).
  let place: (p: Placed, q: Vec2) => Vec2;
  if (item.arc) {
    const { radius, side } = item.arc;
    const outside = side === 'outside';
    for (let i = 0; i < lines.length; i++) {
      if (radius + (outside ? -1 : 1) * i * lineH * s <= item.size * s) return failure('text-arc', missing);
    }
    place = (p, q) => {
      const R = radius + (outside ? -1 : 1) * p.line * lineH * s;
      const a = item.align === 'left' ? 0 : item.align === 'center' ? widths[p.line] / 2 : widths[p.line];
      const sigma = (p.u - a) * s;
      const theta = outside ? Math.PI / 2 - sigma / R : -Math.PI / 2 + sigma / R;
      const rot = outside ? theta - Math.PI / 2 : theta + Math.PI / 2;
      const gx = q.x * s, gy = q.y * s;
      const c = Math.cos(rot), sn = Math.sin(rot);
      return { x: R * Math.cos(theta) + gx * c - gy * sn, y: R * Math.sin(theta) + gx * sn + gy * c };
    };
  } else {
    const anchorPt = (() => {
      const bx = { min: block.min.x * s, max: block.max.x * s, mid: ((block.min.x + block.max.x) / 2) * s };
      const by = { min: block.min.y * s, max: block.max.y * s, mid: ((block.min.y + block.max.y) / 2) * s };
      const a = item.anchor;
      const x = /Left$|^left$/.test(a) ? bx.min : /Right$|^right$/.test(a) ? bx.max : bx.mid;
      const y = /^top/.test(a) ? by.max : /^bottom/.test(a) ? by.min : by.mid;
      return { x, y };
    })();
    place = (p, q) => {
      const v = straight(p, q);
      return { x: v.x * s - anchorPt.x, y: v.y * s - anchorPt.y };
    };
  }

  const rad = (item.angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const finish = (p: Placed, q: Vec2): Vec2 => {
    const v = place(p, q);
    const x = item.mirror ? -v.x : v.x;
    return { x: item.position.x + x * cos - v.y * sin, y: item.position.y + x * sin + v.y * cos };
  };

  const shapes: Shape[] = [];
  const strokes: Path2D[] = [];
  if (font.kind === 'outline') {
    const polys: Poly[] = [];
    for (const p of placed) for (const l of p.loops) polys.push(l.map((q) => finish(p, q)));
    for (const r of polysToRegions(polys)) {
      shapes.push({
        outer: orientPath(pathFromPoints(r.outer, true), true),
        islands: r.holes.map((h) => orientPath(pathFromPoints(h, true), false)),
      });
    }
  } else {
    for (const p of placed) for (const l of p.strokes) strokes.push(pathFromPoints(l.map((q) => finish(p, q)), false));
  }

  const outPts: Vec2[] = [];
  for (const sh of shapes) for (const seg of sh.outer.segments) if (seg.kind === 'line') outPts.push(seg.from);
  for (const st of strokes) for (const seg of st.segments) if (seg.kind === 'line') outPts.push(seg.from, seg.to);
  return { shapes, strokes, missing, bounds: inkBounds(outPts), error: null };
}

const CACHE_LIMIT = 200;
const caches = new WeakMap<LoadedFont, Map<string, TextLayout>>();

/** Lays out `item` in `font`; coordinates are stock coordinates (mm). `tol` is the job tolerance (mm). Cached per (item JSON, font identity, tol). */
export function layoutText(item: TextItem, font: LoadedFont, tol: number): TextLayout {
  let cache = caches.get(font);
  if (!cache) caches.set(font, (cache = new Map()));
  const key = `${JSON.stringify(item)}|${tol}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = compute(item, font, tol);
  cache.set(key, out);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return out;
}
