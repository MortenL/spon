import opentype from 'opentype.js';
import type { Vec2 } from '../geometry/path2d';
import type { Job } from '../job/types';
import { hersheyFont } from './hershey';
import type { BundledFontId, FontRef } from './types';

export interface GlyphData {
  readonly advance: number; // font units
  readonly loops: readonly (readonly Vec2[])[]; // closed outlines, flattened, font units, y up (outline fonts)
  readonly strokes: readonly (readonly Vec2[])[]; // open polylines, font units, y up (single-line fonts)
}
export interface LoadedFont {
  kind: 'outline' | 'singleLine';
  name: string; // display name: family (bundled) or file name (uploaded)
  unitsPerEm: number;
  capHeight: number; // font units
  /** null when the font has no glyph for `ch` (a single UTF-16 code point string). `tol` is the flattening tolerance in font units. */
  glyph(ch: string, tol: number): GlyphData | null;
  kerning(a: string, b: string): number; // font units
}

export const BUNDLED_FONTS: readonly { id: BundledFontId; family: string; kind: 'outline' | 'singleLine' }[] = [
  { id: 'sans', family: 'Inter', kind: 'outline' },
  { id: 'sansBold', family: 'Inter Bold', kind: 'outline' },
  { id: 'serif', family: 'Roboto Slab', kind: 'outline' },
  { id: 'hersheySans', family: 'Hershey Simplex', kind: 'singleLine' },
  { id: 'hersheyDuplex', family: 'Hershey Duplex', kind: 'singleLine' },
  { id: 'hersheyScript', family: 'Hershey Script Simplex', kind: 'singleLine' },
];

export class FontFileError extends Error {}

/** Deep-freezes cached glyph data so callers cannot corrupt the cache. */
export function freezeGlyph(g: GlyphData): GlyphData {
  const lines = (ls: readonly (readonly Vec2[])[]) => Object.freeze(ls.map((l) => Object.freeze(l.map((p) => Object.freeze({ x: p.x, y: p.y })))));
  return Object.freeze({ advance: g.advance, loops: lines(g.loops), strokes: lines(g.strokes) });
}

const MAX_CURVE_STEPS = 256;

/** Appends the points of a quadratic (3 points) or cubic (4 points) Bezier after its first point, flattened so no chord deviates more than `tol`. */
function flattenCurve(pts: Vec2[], tol: number, out: Vec2[]): void {
  const second = (a: Vec2, b: Vec2, c: Vec2) => Math.hypot(a.x - 2 * b.x + c.x, a.y - 2 * b.y + c.y);
  const m = pts.length === 3 ? second(pts[0], pts[1], pts[2]) : Math.max(second(pts[0], pts[1], pts[2]), second(pts[1], pts[2], pts[3]));
  const k = pts.length === 3 ? 0.25 : 0.75;
  const n = Math.max(1, Math.min(MAX_CURVE_STEPS, Math.ceil(Math.sqrt((k * m) / Math.max(tol, 1e-9)))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    if (pts.length === 3) {
      out.push({ x: u * u * pts[0].x + 2 * u * t * pts[1].x + t * t * pts[2].x, y: u * u * pts[0].y + 2 * u * t * pts[1].y + t * t * pts[2].y });
    } else {
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push({ x: a * pts[0].x + b * pts[1].x + c * pts[2].x + d * pts[3].x, y: a * pts[0].y + b * pts[1].y + c * pts[2].y + d * pts[3].y });
    }
  }
}

function flattenPath(path: opentype.Path, tol: number): Vec2[][] {
  const loops: Vec2[][] = [];
  let cur: Vec2[] = [];
  const close = () => {
    if (cur.length > 1 && cur[0].x === cur[cur.length - 1].x && cur[0].y === cur[cur.length - 1].y) cur.pop();
    if (cur.length >= 3) loops.push(cur);
    cur = [];
  };
  for (const c of path.commands) {
    const last = cur[cur.length - 1];
    if (c.type === 'M') {
      close();
      cur.push({ x: c.x, y: c.y });
    } else if (c.type === 'L') cur.push({ x: c.x, y: c.y });
    else if (c.type === 'Q' && last) flattenCurve([last, { x: c.x1, y: c.y1 }, { x: c.x, y: c.y }], tol, cur);
    else if (c.type === 'C' && last) flattenCurve([last, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }], tol, cur);
    else if (c.type === 'Z') close();
  }
  close();
  return loops;
}

function outlineFont(font: opentype.Font, name: string): LoadedFont {
  const upm = font.unitsPerEm;
  let cap = (font.tables.os2 as { sCapHeight?: number } | undefined)?.sCapHeight ?? 0;
  if (!(cap > 0)) cap = font.charToGlyph('H').getBoundingBox().y2;
  if (!(cap > 0)) cap = 0.7 * upm;
  const cache = new Map<string, GlyphData | null>();
  return {
    kind: 'outline',
    name,
    unitsPerEm: upm,
    capHeight: cap,
    glyph(ch, tol) {
      const key = `${ch}|${tol}`;
      if (cache.has(key)) return cache.get(key)!;
      const g = font.charToGlyph(ch);
      const data: GlyphData | null = !g || g.index === 0 ? null : freezeGlyph({ advance: g.advanceWidth ?? 0, loops: flattenPath(g.path, tol), strokes: [] });
      cache.set(key, data);
      return data;
    },
    kerning(a, b) {
      const ga = font.charToGlyph(a);
      const gb = font.charToGlyph(b);
      if (!ga || !gb || ga.index === 0 || gb.index === 0) return 0;
      return font.getKerningValue(ga, gb) || 0;
    },
  };
}

/** Parses an uploaded font; throws FontFileError for WOFF2 and for anything that cannot be read. */
export function parseFontFile(bytes: Uint8Array, fileName: string): LoadedFont {
  if ((bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) || /\.woff2$/i.test(fileName)) {
    throw new FontFileError('WOFF2 fonts are not supported; use TTF, OTF or WOFF');
  }
  try {
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    if (!(font.unitsPerEm > 0) || font.glyphs.length === 0) throw new Error('empty font');
    return outlineFont(font, fileName);
  } catch {
    throw new FontFileError("This font file can't be read");
  }
}

const decodeBase64 = (b64: string): ArrayBuffer => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

const bundled = new Map<BundledFontId, Promise<LoadedFont>>();

async function loadBundled(id: BundledFontId): Promise<LoadedFont> {
  const family = BUNDLED_FONTS.find((f) => f.id === id)!.family;
  const outline = (b64: string) => outlineFont(opentype.parse(decodeBase64(b64)), family);
  switch (id) {
    case 'sans': return outline((await import('./bundled/sans')).default);
    case 'sansBold': return outline((await import('./bundled/sansBold')).default);
    case 'serif': return outline((await import('./bundled/serif')).default);
    case 'hersheySans': return hersheyFont(family, (await import('./bundled/hersheySans')).default);
    case 'hersheyDuplex': return hersheyFont(family, (await import('./bundled/hersheyDuplex')).default);
    case 'hersheyScript': return hersheyFont(family, (await import('./bundled/hersheyScript')).default);
  }
}

export function loadBundledFont(id: BundledFontId): Promise<LoadedFont> {
  let p = bundled.get(id);
  if (!p) {
    p = loadBundled(id);
    p.catch(() => bundled.delete(id));
    bundled.set(id, p);
  }
  return p;
}

export type FontStatus = 'ok' | 'missing' | 'unreadable';
export interface FontSet {
  get(ref: FontRef): LoadedFont | null;
  status(ref: FontRef): FontStatus; // 'missing' until loaded or when the blob is absent
}
export const EMPTY_FONTS: FontSet = { get: () => null, status: () => 'missing' };

export const fontKey = (ref: FontRef): string => (ref.kind === 'bundled' ? `bundled:${ref.id}` : `file:${ref.blobId}`);

export class FontStore implements FontSet {
  private loaded = new Map<string, LoadedFont | 'unreadable'>();

  /** `loadBundled` is a seam for tests: how a bundled font is loaded. */
  constructor(private readonly loadBundled: (id: BundledFontId) => Promise<LoadedFont> = loadBundledFont) {}

  /** Loads every font the job's texts reference (bundled modules and blobs from `blobs`); idempotent and cached by font key. */
  async ensure(job: Job, blobs: Readonly<Record<string, Uint8Array>>): Promise<void> {
    const pending: Promise<void>[] = [];
    const seen = new Set<string>();
    for (const { font: ref } of job.texts) {
      const key = fontKey(ref);
      if (this.loaded.has(key) || seen.has(key)) continue;
      seen.add(key);
      if (ref.kind === 'bundled') {
        // a chunk that fails to load must not fail the whole call: only texts in this font report it
        pending.push(this.loadBundled(ref.id).then((f) => void this.loaded.set(key, f), () => void this.loaded.set(key, 'unreadable')));
      } else {
        const bytes = blobs[ref.blobId];
        if (!bytes) continue;
        try {
          this.loaded.set(key, parseFontFile(bytes, ref.name));
        } catch {
          this.loaded.set(key, 'unreadable');
        }
      }
    }
    await Promise.all(pending);
  }

  get(ref: FontRef): LoadedFont | null {
    const f = this.loaded.get(fontKey(ref));
    return f && f !== 'unreadable' ? f : null;
  }

  status(ref: FontRef): FontStatus {
    const f = this.loaded.get(fontKey(ref));
    return !f ? 'missing' : f === 'unreadable' ? 'unreadable' : 'ok';
  }
}
