// A 1000-unit font: 'H' is a 600x700 box, 'O' a 600x700 box with a 200x300 counter, 'A' and 'V' are plain boxes.
// It has no kerning: opentype.js 2.0.0 cannot write a kern table.
import opentype from 'opentype.js';
const box = (p: opentype.Path, x0: number, y0: number, x1: number, y1: number, ccw: boolean) => {
  p.moveTo(x0, y0);
  if (ccw) { p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); } else { p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); }
  p.close();
};
export function testFontBytes(): Uint8Array {
  const glyph = (name: string, unicode: number | undefined, advance: number, draw: (p: opentype.Path) => void) => {
    const path = new opentype.Path();
    draw(path);
    return new opentype.Glyph({ name, unicode, advanceWidth: advance, path });
  };
  const glyphs = [
    glyph('.notdef', undefined, 500, () => {}),
    glyph('space', 32, 300, () => {}),
    glyph('H', 72, 700, (p) => box(p, 50, 0, 650, 700, false)),
    glyph('O', 79, 700, (p) => { box(p, 50, 0, 650, 700, false); box(p, 250, 200, 450, 500, true); }),
    glyph('A', 65, 700, (p) => box(p, 50, 0, 650, 700, false)),
    glyph('V', 86, 700, (p) => box(p, 50, 0, 650, 700, false)),
  ];
  const font = new opentype.Font({ familyName: 'TestSans', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  font.tables.os2 = { ...(font.tables.os2 ?? {}), sCapHeight: 700 };
  return new Uint8Array(font.toArrayBuffer());
}
