import { AFFINE_IDENTITY, type Affine2D, affineMultiply, affineRotate, affineScale, affineTranslate } from '../dxf/affine2d';

const deg = (v: number) => (v * Math.PI) / 180;
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** An SVG transform list as one matrix (identity when empty); null when it is malformed. */
export function parseTransform(text: string | undefined): Affine2D | null {
  if (!text || !text.trim()) return AFFINE_IDENTITY;
  let m: Affine2D = AFFINE_IDENTITY;
  const re = /\s*,?\s*([a-zA-Z]+)\s*\(([^)]*)\)/y;
  let consumed = 0;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    consumed = re.lastIndex;
    const n = (match[2].match(NUMBER) ?? []).map(Number);
    let t: Affine2D | null = null;
    switch (match[1]) {
      case 'matrix': t = n.length === 6 ? { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] } : null; break;
      case 'translate': t = n.length === 1 || n.length === 2 ? affineTranslate(n[0], n[1] ?? 0) : null; break;
      case 'scale': t = n.length === 1 || n.length === 2 ? affineScale(n[0], n[1] ?? n[0]) : null; break;
      case 'rotate':
        if (n.length === 1) t = affineRotate(deg(n[0]));
        else if (n.length === 3) t = affineMultiply(affineTranslate(n[1], n[2]), affineMultiply(affineRotate(deg(n[0])), affineTranslate(-n[1], -n[2])));
        break;
      case 'skewX': t = n.length === 1 ? { a: 1, b: 0, c: Math.tan(deg(n[0])), d: 1, e: 0, f: 0 } : null; break;
      case 'skewY': t = n.length === 1 ? { a: 1, b: Math.tan(deg(n[0])), c: 0, d: 1, e: 0, f: 0 } : null; break;
    }
    if (!t) return null;
    m = affineMultiply(m, t);
  }
  return text.slice(consumed).trim() === '' ? m : null;
}
