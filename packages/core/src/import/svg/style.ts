import type { XmlElement } from './xml';

export interface CssRule { type: string | null; cls: string | null; id: string | null; specificity: number; order: number; decls: Record<string, string> }
/** `hidden`: display:none here or above (not overridable); `visible`: the inherited visibility property. */
export interface ComputedStyle { fill: string | null; stroke: string | null; hidden: boolean; visible: boolean }

/** SVG's initial values: shapes are filled black and not stroked. */
export const INITIAL_STYLE: ComputedStyle = { fill: '#000000', stroke: null, hidden: false, visible: true };

const PROPS = ['fill', 'stroke', 'display', 'visibility'] as const;
const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00',
  cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
  maroon: '#800000', navy: '#000080', olive: '#808000', teal: '#008080', purple: '#800080', orange: '#ffa500',
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** "#rrggbb", or null for none, transparent, gradients, currentColor and anything unrecognised. */
export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const rgb = /^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)/.exec(v);
  if (rgb) {
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));
    return `#${hex2(ch(rgb[1]))}${hex2(ch(rgb[2]))}${hex2(ch(rgb[3]))}`;
  }
  return NAMED[v] ?? null;
}

export function parseDeclarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).replace(/!important/i, '').trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Rules with simple selectors only: type, .class, #id and type.class; anything else (combinators, pseudo, @-rules) is skipped. */
export function parseCss(text: string): CssRule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[\w-]+[^{;]*;/g, '');
  const rules: CssRule[] = [];
  let order = 0;
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    if (prelude.startsWith('@')) {
      // skip the whole @-block, including nested braces
      let depth = 0;
      let k = open;
      for (; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}' && --depth === 0) break;
      }
      i = k + 1;
      continue;
    }
    const close = css.indexOf('}', open);
    if (close < 0) break;
    const decls = parseDeclarations(css.slice(open + 1, close));
    for (const sel of prelude.split(',').map((s) => s.trim())) {
      const m = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/.exec(sel);
      if (!sel || !m) continue;
      const [, type = null, cls = null, id = null] = m;
      rules.push({ type, cls, id, specificity: (id ? 100 : 0) + (cls ? 10 : 0) + (type ? 1 : 0), order: order++, decls });
    }
    i = close + 1;
  }
  return rules;
}

function matching(el: XmlElement, rules: readonly CssRule[]): CssRule[] {
  const type = el.name.slice(el.name.indexOf(':') + 1);
  const classes = (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
  return rules
    .filter((r) => (!r.type || r.type === type) && (!r.cls || classes.includes(r.cls)) && (!r.id || el.attrs.id === r.id))
    .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

/** Cascade, lowest first: inherited, presentation attributes, <style> rules (by specificity), inline style. */
export function computeStyle(el: XmlElement, parent: ComputedStyle, rules: readonly CssRule[]): ComputedStyle {
  const props: Record<string, string> = {};
  for (const k of PROPS) if (el.attrs[k] !== undefined) props[k] = el.attrs[k];
  const take = (decls: Record<string, string>) => {
    for (const k of PROPS) if (decls[k] !== undefined) props[k] = decls[k];
  };
  for (const r of matching(el, rules)) take(r.decls);
  if (el.attrs.style) take(parseDeclarations(el.attrs.style));
  const paint = (v: string | undefined, inherited: string | null) => (v === undefined || v.trim() === 'inherit' ? inherited : normalizeColor(v));
  const vis = props.visibility?.trim();
  return {
    fill: paint(props.fill, parent.fill),
    stroke: paint(props.stroke, parent.stroke),
    hidden: parent.hidden || props.display?.trim() === 'none',
    visible: vis === undefined || vis === 'inherit' ? parent.visible : vis === 'visible',
  };
}
