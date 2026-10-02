import { describe, expect, it } from 'vitest';
import { scaleChoices, widthScale } from './svgScale';

describe('SVG scale choices', () => {
  it('offers 96 and 72 dpi with the resulting size', () => {
    const [a, b] = scaleChoices({ x: 96, y: 48 });
    expect(a).toMatchObject({ id: '96', scale: { dpi: 96 }, label: '96 dpi (CSS, Inkscape, Affinity)' });
    expect(a.size.x).toBeCloseTo(25.4, 9);
    expect(b).toMatchObject({ id: '72', scale: { dpi: 72 } });
    expect(b.size.y).toBeCloseTo(48 * 25.4 / 72, 9);
  });

  it('accepts a positive target width', () => {
    expect(widthScale(120)).toEqual({ width: 120 });
    expect(widthScale(0)).toBeNull();
    expect(widthScale(Number.NaN)).toBeNull();
  });
});
