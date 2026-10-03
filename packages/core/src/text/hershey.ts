import type { Vec2 } from '../geometry/path2d';
import type { GlyphData, LoadedFont } from './fonts';

export interface HersheyTable {
  glyphs: Record<string, { left: number; right: number; strokes: [number, number][][] }>;
}

const R = 'R'.charCodeAt(0);
const RECORD_START = /^[ \d]{5}[ \d]{3}/;

/** Parses a Hershey `.jhf` file: record k (0-based) is the ASCII character 32 + k; at most the 95 printable characters are read. */
export function parseJhf(text: string): HersheyTable {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const glyphs: HersheyTable['glyphs'] = {};
  let k = 0;
  for (let i = 0; i < lines.length && k < 95; i++) {
    const head = lines[i];
    if (!RECORD_START.test(head) || head.slice(0, 8).trim() === '') continue;
    const count = parseInt(head.slice(5, 8), 10);
    let data = head.slice(8);
    while (data.length < 2 * count && i + 1 < lines.length && !RECORD_START.test(lines[i + 1])) data += lines[++i];
    const v = (idx: number) => data.charCodeAt(idx) - R;
    const left = v(0);
    const right = v(1);
    const strokes: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (let p = 1; p < count; p++) {
      const a = data[2 * p];
      const b = data[2 * p + 1];
      if (a === ' ' && b === 'R') {
        if (cur.length) strokes.push(cur);
        cur = [];
      } else cur.push([v(2 * p), v(2 * p + 1)]);
    }
    if (cur.length) strokes.push(cur);
    glyphs[String.fromCharCode(32 + k)] = { left, right, strokes };
    k++;
  }
  return { glyphs };
}

const UNITS_PER_EM = 32;
const BASELINE = 9;

/** Wraps a Hershey table as a single-line font: y up, baseline at 0, x shifted by -left. */
export function hersheyFont(name: string, table: HersheyTable): LoadedFont {
  const toStrokes = (ch: string): Vec2[][] | null => {
    const g = table.glyphs[ch];
    if (!g) return null;
    const mapped = g.strokes.map((s) => {
      const pts = s.map(([x, y]) => ({ x: x - g.left, y: BASELINE - y }));
      return pts.length === 1 ? [pts[0], { ...pts[0] }] : pts;
    });
    const degenerate = (s: Vec2[]) => s.every((p) => p.x === s[0].x && p.y === s[0].y);
    const kept = mapped.filter((s) => !degenerate(s));
    return kept.length > 0 || mapped.length === 0 ? kept : mapped;
  };
  const h = toStrokes('H');
  const capHeight = h ? Math.max(0, ...h.flat().map((p) => p.y)) : 0.7 * UNITS_PER_EM;
  return {
    kind: 'singleLine',
    name,
    unitsPerEm: UNITS_PER_EM,
    capHeight,
    glyph(ch: string): GlyphData | null {
      const strokes = toStrokes(ch);
      if (!strokes) return null;
      const g = table.glyphs[ch];
      return { advance: g.right - g.left, loops: [], strokes };
    },
    kerning: () => 0,
  };
}
