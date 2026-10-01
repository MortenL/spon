import { type Affine2D, AFFINE_IDENTITY, affineMultiply, affineScale, affineTranslate } from '../dxf/affine2d';
import { DEFAULT_CHORD_TOLERANCE, type Drawing, type DrawingLayer, MAX_DXF_SEGMENTS } from '../dxf/dxf';
import { bboxOfPoints, bboxSize } from '../../geometry/bbox';
import { type Path2D, pathsToPoints, type Vec2 } from '../../geometry/path2d';
import { parsePathData } from './pathData';
import { shapeToPathData } from './shapes';
import { type ComputedStyle, computeStyle, type CssRule, hasClip, INITIAL_STYLE, parseCss } from './style';
import { parseTransform } from './transform';
import { svgViewport } from './units';
import { localName, parseXml, type XmlElement, XmlError } from './xml';

/** mm per CSS px, or how to choose it: a dpi, or the width (mm) the drawing's content should have. */
export type SvgScale = number | { dpi: number } | { width: number };
export interface SvgOptions { svgScale?: SvgScale; chordTol?: number }
export type SvgImport =
  | { kind: 'drawing'; drawing: Drawing; svgScale: number; warnings: string[] }
  /** A px-based file without a scale: `rawSize` is the content size in CSS px. */
  | { kind: 'needsScale'; rawSize: Vec2; warnings: string[] };

export class SvgParseError extends Error {
  override name = 'SvgParseError';
}

/** CSS absolute units are defined at 96 px per inch. */
const ABSOLUTE_SCALE = 25.4 / 96;
const MAX_USE_DEPTH = 16;
const SKIPPED = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'marker', 'style', 'title', 'desc', 'metadata', 'filter', 'script']);
const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

export function resolveSvgScale(scale: SvgScale, rawSize: Vec2): number {
  if (typeof scale === 'number') return scale;
  if ('dpi' in scale) return 25.4 / scale.dpi;
  return rawSize.x > 0 ? scale.width / rawSize.x : ABSOLUTE_SCALE;
}

interface Item { d: string; m: Affine2D; colour: string | null; layer: string | null; id: string | undefined }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Collects the drawable shapes with their full transform (user units → px) and grouping. */
function collect(root: XmlElement, rules: readonly CssRule[], userToPx: Affine2D) {
  const ids = new Map<string, XmlElement>();
  const index = (el: XmlElement) => {
    if (el.attrs.id) ids.set(el.attrs.id, el);
    el.children.forEach(index);
  };
  index(root);
  const items: Item[] = [];
  const counts = { text: 0, image: 0, clip: 0, transform: 0, foreign: 0, circular: 0 };
  const active = new Set<XmlElement>(); // elements being walked, so a <use> cannot reach its own ancestors
  let visits = 0;
  let inkscapeLayers = false;
  const isLayer = (el: XmlElement) => localName(el.name) === 'g' && el.attrs['inkscape:groupmode'] === 'layer';
  const scan = (el: XmlElement) => {
    if (isLayer(el)) inkscapeLayers = true;
    el.children.forEach(scan);
  };
  scan(root);

  const walk = (el: XmlElement, m: Affine2D, parent: ComputedStyle, layer: string | null, depth: number) => {
    const prefix = el.name.includes(':') ? el.name.slice(0, el.name.indexOf(':')) : '';
    if (prefix && prefix !== 'svg') return; // inkscape:, sodipodi: and other metadata
    const type = localName(el.name);
    if (SKIPPED.has(type) && el !== root) return;
    if (++visits > MAX_DXF_SEGMENTS) throw new SvgParseError(`SVG expands to more than ${MAX_DXF_SEGMENTS} segments`);
    const style = computeStyle(el, parent, rules);
    if (style.hidden) return;
    if (type === 'text') return void counts.text++;
    if (type === 'image') return void counts.image++;
    if (type === 'foreignObject') return void counts.foreign++;
    if (hasClip(el, rules)) counts.clip++;
    let t = parseTransform(el.attrs.transform);
    if (!t) {
      counts.transform++;
      t = AFFINE_IDENTITY;
    }
    let mm = affineMultiply(m, t);
    if (type === 'svg' && el !== root) mm = affineMultiply(mm, affineTranslate(Number(el.attrs.x) || 0, Number(el.attrs.y) || 0));
    let lay = layer;
    if (isLayer(el)) {
      const label = el.attrs['inkscape:label'] ?? el.attrs.id ?? 'Layer';
      lay = layer ? `${layer}/${label}` : label;
    }
    if (CONTAINERS.has(type)) {
      active.add(el);
      for (const c of el.children) walk(c, mm, style, lay, depth);
      active.delete(el);
      return;
    }
    if (type === 'use') {
      const href = el.attrs.href ?? el.attrs['xlink:href'] ?? '';
      const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
      if (!target || depth >= MAX_USE_DEPTH) return;
      if (active.has(target)) return void counts.circular++;
      const placed = affineMultiply(mm, affineTranslate(Number(el.attrs.x) || 0, Number(el.attrs.y) || 0));
      active.add(target);
      // a referenced symbol's own viewBox is not applied: its children are placed at the use position
      if (localName(target.name) === 'symbol') {
        const symStyle = computeStyle(target, style, rules);
        for (const c of target.children) walk(c, placed, symStyle, lay, depth + 1);
      } else walk(target, placed, style, lay, depth + 1);
      active.delete(target);
      return;
    }
    if (!SHAPES.has(type) || !style.visible) return;
    const d = type === 'path' ? el.attrs.d : shapeToPathData(el);
    if (!d) return;
    items.push({ d, m: affineMultiply(userToPx, mm), colour: style.stroke ?? style.fill, layer: lay, id: el.attrs.id });
  };
  walk(root, AFFINE_IDENTITY, INITIAL_STYLE, null, 0);
  return { items, counts, inkscapeLayers };
}

/** Builds the layers with `toOut` mapping px to output coordinates; `tol` is in output units. */
function build(items: readonly Item[], inkscapeLayers: boolean, toOut: Affine2D, tol: number) {
  const layers = new Map<string, { paths: Path2D[]; colours: Map<string, number> }>();
  const errors: string[] = [];
  let segments = 0;
  for (const it of items) {
    const r = parsePathData(it.d, affineMultiply(toOut, it.m), tol);
    if (r.error) errors.push(`Path ${it.id ? `"${it.id}"` : 'without id'}: ${r.error}; the rest of it was skipped`);
    if (!r.paths.length) continue;
    const name = inkscapeLayers ? (it.layer ?? '0') : (it.colour ?? '0');
    let layer = layers.get(name);
    if (!layer) {
      layer = { paths: [], colours: new Map() };
      layers.set(name, layer);
    }
    layer.paths.push(...r.paths);
    if (it.colour) layer.colours.set(it.colour, (layer.colours.get(it.colour) ?? 0) + 1);
    segments += r.paths.reduce((n, p) => n + p.segments.length, 0);
    if (segments > MAX_DXF_SEGMENTS) throw new SvgParseError(`SVG expands to more than ${MAX_DXF_SEGMENTS} segments`);
  }
  const out: DrawingLayer[] = [...layers].map(([name, l]) => {
    const top = [...l.colours].sort((a, b) => b[1] - a[1])[0]?.[0];
    const colour = !inkscapeLayers && name.startsWith('#') ? name : top;
    return { name, color: colour ? parseInt(colour.slice(1), 16) : 0xffffff, paths: l.paths };
  });
  return { layers: out, errors };
}

const contentSize = (layers: readonly DrawingLayer[]): Vec2 => {
  const box = bboxOfPoints(pathsToPoints(layers.flatMap((l) => l.paths)));
  return box ? { x: bboxSize(box).x, y: bboxSize(box).y } : { x: 0, y: 0 };
};

/**
 * Reads an SVG into a Drawing in mm (Y up). Inkscape layers become layers; otherwise shapes are grouped by stroke
 * (else fill) colour. A file sized in absolute units scales itself; a px or unitless one needs `svgScale`.
 */
export function parseSvg(text: string, options: SvgOptions = {}): SvgImport {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (err) {
    if (err instanceof XmlError) throw new SvgParseError(`Not a valid SVG file: ${err.message}`);
    throw err;
  }
  if (localName(root.name) !== 'svg') throw new SvgParseError('Not an SVG file');
  const styles: string[] = [];
  const findStyles = (el: XmlElement) => {
    if (localName(el.name) === 'style') styles.push(el.text);
    el.children.forEach(findStyles);
  };
  findStyles(root);
  const vp = svgViewport(root);
  const { items, counts, inkscapeLayers } = collect(root, parseCss(styles.join('\n')), vp.userToPx);

  const warnings: string[] = [];
  if (counts.text) warnings.push(`${plural(counts.text, 'text element was', 'text elements were')} skipped — convert text to paths before exporting`);
  if (counts.image) warnings.push(`${plural(counts.image, 'embedded image was', 'embedded images were')} skipped`);
  if (counts.foreign) warnings.push(`${plural(counts.foreign, 'foreign object was', 'foreign objects were')} skipped`);
  if (counts.circular) warnings.push(`${plural(counts.circular, 'circular reference was', 'circular references were')} ignored`);
  if (counts.clip) warnings.push('Clip paths and masks were ignored; the full shapes were imported');
  if (counts.transform) warnings.push(`${plural(counts.transform, 'element has', 'elements have')} an invalid transform, which was ignored`);

  const chordTol = options.chordTol ?? DEFAULT_CHORD_TOLERANCE;
  const needRaw = options.svgScale === undefined ? !vp.absolute : typeof options.svgScale === 'object' && 'width' in options.svgScale;
  let rawSize: Vec2 | null = null;
  if (needRaw) {
    const raw = build(items, inkscapeLayers, AFFINE_IDENTITY, 0.05);
    rawSize = contentSize(raw.layers);
    if (options.svgScale === undefined) {
      if (!raw.layers.length) throw new SvgParseError(['No shapes found in this SVG', ...warnings].join('. '));
      return { kind: 'needsScale', rawSize, warnings };
    }
  }
  const svgScale = options.svgScale === undefined ? ABSOLUTE_SCALE : resolveSvgScale(options.svgScale, rawSize ?? { x: 0, y: 0 });
  // px → mm, then Y up: flip about the viewport (or the x axis), so the drawing keeps its place
  const flip = (f: number) => affineMultiply({ a: 1, b: 0, c: 0, d: -1, e: 0, f }, affineScale(svgScale, svgScale));
  let toOut = flip((vp.size?.y ?? 0) * svgScale);
  if (!vp.size) {
    // no viewport to flip about: mirror about the content box so it keeps its place
    const first = build(items, inkscapeLayers, toOut, chordTol).layers;
    const box = bboxOfPoints(pathsToPoints(first.flatMap((l) => l.paths)));
    if (box) toOut = flip(-(box.min.y + box.max.y));
  }
  const { layers, errors } = build(items, inkscapeLayers, toOut, chordTol);
  warnings.push(...errors);
  if (!layers.length) throw new SvgParseError(['No shapes found in this SVG', ...warnings].join('. '));
  return { kind: 'drawing', drawing: { layers }, svgScale, warnings };
}
