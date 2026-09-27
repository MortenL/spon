import type { Vec2 } from '../../geometry/path2d';

/** x' = a·x + c·y + e ;  y' = b·x + d·y + f */
export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const AFFINE_IDENTITY: Readonly<Affine2D> = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** m · n: the result applies `n` first, then `m`. */
export function affineMultiply(m: Affine2D, n: Affine2D): Affine2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export const affineApply = (m: Affine2D, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export const affineTranslate = (tx: number, ty: number): Affine2D => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const affineScale = (sx: number, sy: number): Affine2D => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });

export function affineRotate(radians: number): Affine2D {
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export const affineDeterminant = (m: Affine2D): number => m.a * m.d - m.b * m.c;

/** True when the transform is rotation + uniform scale (optionally mirrored), so circles stay circles. */
export function isSimilarity(m: Affine2D, eps = 1e-9): boolean {
  const lenX = m.a * m.a + m.b * m.b;
  const lenY = m.c * m.c + m.d * m.d;
  const scale = Math.max(lenX, lenY, 1e-300);
  return Math.abs(m.a * m.c + m.b * m.d) <= eps * scale && Math.abs(lenX - lenY) <= eps * scale;
}
