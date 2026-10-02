# Spon Milestone 4.1 — SVG import, LinuxCNC tool tables and open-line sides: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SVG files open as 2D drawings like DXF files do. A profile can cut left or right of an open line. LinuxCNC `tool.tbl` files import into the tool library. All three work in the web app and through the MCP server.

**Architecture:**
- **SVG reader:** a dependency-free reader in `core/src/import/svg/`, made of an XML tokenizer, CSS/style resolution, transforms, path data, shapes, viewport units, and `parseSvg`. It produces the same `Drawing` that `parseDxf` produces, so the catalog, handles and operations need no change.
- **SVG scale:** stored on the model as one number, `svgScale` (mm per CSS px). It is passed back to `importModel` through a new options object `{ body, svgScale }`.
- **Open sides:** a new `openSide` setting on profiles, plus a `reverse` flag on drawing references. Open lines are offset with the existing Clipper sweep: the tool path is the requested side of the disc-swept band around the line.
- **Tool tables:** a `tool.tbl` parser and a merge rule in which the table's T numbers win (`mergeToolTable`), behind one entry point (`importToolFile`). Both the web library and the MCP library file use it.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn (web), zustand, Comlink workers, `@modelcontextprotocol/sdk` + zod (MCP), Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-svg-tooltable-open-lines-design.md`. Read it together with this plan. It is the authority; this plan is its argument.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs (tsconfig lib `ES2022` + `WebWorker`). In particular, never use `DOMParser`.
- No new dependencies, and no GPL dependencies.
- Stored lengths are mm and angles are degrees. Job changes go through `core/src/job/commands.ts` and the store's `commit()`.
- Existing jobs, tests and posted G-code stay unchanged. The only schema change is v3 → v4, which adds `openSide: 'on'` to every profile operation.
- The MCP server never writes to stdout. Tool failures are `SessionError`/`CommandError` thrown inside `guarded`.
- TypeScript runs with `verbatimModuleSyntax`: use `import type` for type-only imports.
- Fixed messages (copy verbatim):
  - `Not an SVG file`
  - `No shapes found in this SVG`
  - `No tools found in this tool table`
  - `The tool is too large for a bend in this line; the bend was rounded`
  - `A LinuxCNC tool table has no units — call import_tool_library again with units: "mm" or "in"` (MCP)
- Tests never bind port 5197, and nothing touches the user's dev server on port 5173. Playwright uses 5199, and the live-bridge e2e uses 5196.
- Commit trailer: end every commit message with your own harness's `Co-Authored-By` line.
- Never push, never rewrite history, never use `git stash`, `reset`, `rebase`, `amend` or `checkout` of other refs. Only plain new commits, on the branch `milestone-4-1-inputs`.

## Clarifications to the spec (binding for this plan)

1. **`svgScale` means mm per CSS px.**
   - CSS defines every absolute unit at 96 px per inch, so a root sized in mm, cm, in, pt or pc always gives `svgScale = 25.4 / 96`. A px root at 96 dpi gives the same value, and 72 dpi gives `25.4 / 72`.
   - The choice travels as `SvgScale = number | { dpi: number } | { width: number }` (width in mm). `parseSvg` resolves it to a number and returns it, and that number is what gets stored.
2. **The scale choice is a new `ImportResult` kind, `needsScale`.** It is not a `LengthUnit`. An SVG's drawing is always produced in mm (`detectedUnits: 'mm'`), so SVGs never return `needsUnits`.
3. **Open chains always follow `openSide`.** The spec's §4.2 says `side: inside/outside` with only open contours keeps an error. Doing that would refuse every new profile on an open line, because the default `side` is `outside`, before the user ever reaches Open side. So `side` applies to closed contours only, `openSide` applies to open chains only, and neither combination is an error.
4. **Each level of a left or right cut runs in the same direction.** Between levels the tool travels back over the top. A cut on the line (`on`) keeps today's zig-zag between levels. Without this, every second level of a side cut would switch between climb and conventional.
5. **Open chains keep today's entry: a plunge, with no leads.** The spec's "leads at the two ends" is deferred, because open chains have no lead support today. The existing "Open contours are entered with a plunge" warning stays. Finish passes stay for closed contours only, as today.
6. **The seed of an open chain** is the reference, in `op.geometry` order, that a chain starts growing from (`chainPaths` keeps that piece's direction). `reverse` is read from the seed. The UI shows the Reverse toggle only on seed rows, and the chain's diagnostics point at the seed.
7. **`ImportOptions` replaces the `body` argument everywhere:**
   - `importModel(fileName, bytes, options, loadReader)`;
   - `importFile(fileName, bytes, options)`;
   - the worker's `import(fileName, bytes, options)` and `importInWorker(fileName, bytes, options)`;
   - the web `importModelBytes(fileName, bytes, options)` and `importModelOutcome(fileName, bytes, options)`.
8. **`ToolLibraryAccess.importFile(fileName, bytes, options?: { label?: string; units?: LengthUnit })`** replaces the `label` argument. The bridge's `tools.import` gains `units`.
9. **Layer colour for colour-grouped SVG layers** is that colour. For Inkscape layers it is the most common colour of the layer's shapes, or white when there are none. Inkscape stores no layer colour, so the spec's "label's group colour" does not apply.

## Review Focus

1. **Illustrator files put colours in `<style>` classes** (`class="cls-1"`), not in attributes. Their shapes must still group by those colours. → Task 1 tests class rules; Task 3's Illustrator fixture checks the colour layers.
2. **An SVG drawn with Y down must not come out mirrored.** Text-like artwork should read correctly from the top view. → Task 3 checks an asymmetric shape's orientation after import.
3. **Re-opening a job with an SVG model must give byte-identical geometry,** including after a px file was imported at 72 dpi. → Task 4: a `FileSession` round trip compares catalogs and posted G-code.
4. **A tight inside bend on an open line with a large tool must neither crash nor produce a toolpath that crosses the line.** → Task 5 tests a U-turn narrower than the tool and checks that every lap point keeps its distance from the line.
5. **Importing a `tool.tbl` whose T numbers collide with the starter library must not leave two tools with one T number.** → Task 7 tests that the clashing starter tool is renumbered and that all numbers are unique afterwards.

---

## File map

**Core: new**
- `core/src/import/svg/xml.ts`: `parseXml`, `XmlElement`, `XmlError`, `decodeEntities`, `localName`.
- `core/src/import/svg/style.ts`: `parseCss`, `parseDeclarations`, `computeStyle`, `normalizeColor`, `INITIAL_STYLE`, `CssRule`, `ComputedStyle`.
- `core/src/import/svg/transform.ts`: `parseTransform`.
- `core/src/import/svg/pathData.ts`: `parsePathData`, `PathDataResult`.
- `core/src/import/svg/shapes.ts`: `shapeToPathData`.
- `core/src/import/svg/units.ts`: `svgViewport`, `SvgViewport`, `parseLength`.
- `core/src/import/svg/svg.ts`: `parseSvg`, `SvgScale`, `SvgOptions`, `SvgImport`, `SvgParseError`, `resolveSvgScale`.
- `core/src/geometry/offset/openOffset.ts`: `offsetOpenPath`, `OpenOffset`.
- `core/src/tools/linuxcnc.ts`: `parseLinuxCncToolTable`, `ToolTableImport`, `mergeToolTable`, `importToolFile`, `ToolFileImport`, `suggestToolTableUnits`.
- Tests: `core/test/svg-xml.test.ts`, `svg-style.test.ts`, `svg-path.test.ts`, `svg-import.test.ts`, `svg-pipeline.test.ts`, `open-offset.test.ts`, `profile-open-sides.test.ts`, `linuxcnc.test.ts`.
- Fixtures: `core/test/fixtures/svg/{inkscape,illustrator,affinity,cad,artwork}.svg`, `core/test/fixtures/tool.tbl`.

**Core: changed**
- `import/importFile.ts`: `ModelFormat` gains `'svg'`; `ImportResult` gains `needsScale` and an optional `svgScale` on drawings; `importFile` gains options.
- `pipeline/readModel.ts`: `ImportOptions`; `importModel` takes options.
- `pipeline/model.ts`: the drawing `ModelGeometry` gains `svgScale?`.
- `pipeline/importFlow.ts`: `ImportStep` gains `needsScale`.
- `pipeline/importOutcome.ts`: `decideImport` handles `needsScale`; `newModelRef` handles SVG.
- `bridge/protocol.ts`: `ImportOutcome` gains `needsScale`; `importModel` params gain `svgScale`; `tools.import` params gain `units`.
- `job/types.ts`, `job/update.ts`: `ModelRef`/`NewModel` gain `format: 'svg'` and `svgScale`.
- `cam/types.ts`: `ProfileOp.openSide`; `DxfPathRef.reverse`; `CamCode` gains `'bend-rounded'`.
- `cam/defaults.ts`: `openSide: 'on'`.
- `job/commands.ts`: `openSide` is an allowed profile key.
- `io/migrations.ts`: v4.
- `cam/features/chain.ts`: `openSeeds`.
- `cam/features/resolve.ts`: open chains follow `openSide` and `reverse`.
- `cam/ops/profile.ts`: left and right laps, travel direction, same-direction levels.
- `index.ts`: exports.

**MCP:** `session.ts`, `fileSession.ts`, `library.ts`, `live/liveSession.ts`, `schemas.ts`, `handles.ts`, `instructions.ts`, `tools/session.ts`, `tools/edit.ts` (handles), `tools/library.ts`, `README.md`; tests `tools-session.test.ts`, `tools-edit.test.ts`, `tools-library.test.ts`, `handles.test.ts`, `fileSession.test.ts`, `test/fakeTab.ts`.

**Web:** `workers/import.worker.ts`, `workers/importClient.ts`, `state/store.ts` (`pendingScale`), `state/documents.ts`, `state/fileio.ts`, `layout/TopBar.tsx`, `layout/SvgScaleDialog.tsx` (new), `App.tsx`, `inspector/PassesTab.tsx`, `inspector/GeometryTab.tsx`, `inspector/openChains.ts` (new), `viewport/CamOverlays.tsx`, `tools/ToolLibraryDialog.tsx`, `state/toolLibrary.ts`, `bridge/handlers.ts`; tests next to them; `e2e/inputs.spec.ts` (new).

---

### Task 1: Core — XML tokenizer and SVG styles

**Files:**
- Create: `packages/core/src/import/svg/xml.ts`, `packages/core/src/import/svg/style.ts`
- Test: `packages/core/test/svg-xml.test.ts`, `packages/core/test/svg-style.test.ts`

**Interfaces:**
- Produces:
  - `interface XmlElement { name: string; attrs: Record<string, string>; children: XmlElement[]; text: string; line: number }`
  - `class XmlError extends Error { readonly line: number }`
  - `parseXml(text: string): XmlElement`, which returns the document element
  - `decodeEntities(s: string): string`
  - `localName(name: string): string`, e.g. `'svg:path'` → `'path'`
  - `interface CssRule { type: string | null; cls: string | null; id: string | null; specificity: number; order: number; decls: Record<string, string> }`
  - `parseCss(text: string): CssRule[]`
  - `parseDeclarations(text: string): Record<string, string>`
  - `interface ComputedStyle { fill: string | null; stroke: string | null; hidden: boolean; visible: boolean }`
  - `INITIAL_STYLE: ComputedStyle` (`fill '#000000'`, `stroke null`)
  - `computeStyle(el: XmlElement, parent: ComputedStyle, rules: readonly CssRule[]): ComputedStyle`
  - `normalizeColor(value: string): string | null`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/svg-xml.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeEntities, localName, parseXml, XmlError } from '../src/import/svg/xml';

describe('parseXml', () => {
  it('builds the element tree with attributes, namespaces and text', () => {
    const root = parseXml(`<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x" [ <!ENTITY a "b"> ]>
<!-- comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="i" width='10mm'>
  <g inkscape:label="Cut &amp; engrave" id="l1"><path d="M0 0"/></g>
  <style><![CDATA[ .a { fill: red } ]]></style>
</svg>`);
    expect(root.name).toBe('svg');
    expect(root.attrs.width).toBe('10mm');
    expect(root.children.map((c) => c.name)).toEqual(['g', 'style']);
    expect(root.children[0].attrs['inkscape:label']).toBe('Cut & engrave');
    expect(root.children[0].children[0]).toMatchObject({ name: 'path', attrs: { d: 'M0 0' }, line: 5 });
    expect(root.children[1].text.trim()).toBe('.a { fill: red }');
  });

  it('decodes entities and character references', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&unknown;')).toBe(`<>&"'AB&unknown;`);
  });

  it('reports malformed XML with a line number', () => {
    expect(() => parseXml('<svg>\n<g>\n</svg>')).toThrow(XmlError);
    expect(() => parseXml('<svg>\n<g>\n</svg>')).toThrow(/line 3/);
    expect(() => parseXml('<svg><!-- open')).toThrow(/Unclosed comment/);
    expect(() => parseXml('<svg a=b></svg>')).toThrow(/Malformed attributes/);
    expect(() => parseXml('just text')).toThrow(/No root element/);
  });

  it('strips namespace prefixes for element types', () => {
    expect(localName('svg:path')).toBe('path');
    expect(localName('rect')).toBe('rect');
  });
});
```

`packages/core/test/svg-style.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeStyle, INITIAL_STYLE, normalizeColor, parseCss, parseDeclarations } from '../src/import/svg/style';
import { parseXml } from '../src/import/svg/xml';

describe('SVG styles', () => {
  it('normalises colours', () => {
    expect(normalizeColor('#F00')).toBe('#ff0000');
    expect(normalizeColor(' #1A2b3C ')).toBe('#1a2b3c');
    expect(normalizeColor('rgb(255, 0, 128)')).toBe('#ff0080');
    expect(normalizeColor('rgb(100%,0%,50%)')).toBe('#ff0080');
    expect(normalizeColor('Blue')).toBe('#0000ff');
    expect(normalizeColor('none')).toBeNull();
    expect(normalizeColor('url(#grad)')).toBeNull();
  });

  it('parses declarations and simple CSS rules (Illustrator style, review focus 1)', () => {
    expect(parseDeclarations('fill:#f00; stroke : none ;')).toEqual({ fill: '#f00', stroke: 'none' });
    const rules = parseCss('/* c */ .cls-1, .cls-2 { fill: #ff0000 } #x{stroke:blue} path{fill:green} g > path{fill:red} @media print { .p{fill:red} }');
    expect(rules.map((r) => [r.type, r.cls, r.id])).toEqual([[null, 'cls-1', null], [null, 'cls-2', null], [null, null, 'x'], ['path', null, null]]);
  });

  it('resolves precedence and inheritance', () => {
    const doc = parseXml(`<svg><g fill="blue" visibility="hidden">
      <path id="x" class="a" fill="red" style="stroke:#00f"/>
      <path class="a" visibility="visible"/>
      <g style="display:none"><path/></g>
    </g></svg>`);
    const rules = parseCss('.a { fill: #00ff00 } #x { fill: #123456 }');
    const g = computeStyle(doc.children[0], INITIAL_STYLE, rules);
    expect(g).toEqual({ fill: '#0000ff', stroke: null, hidden: false, visible: false });
    // attribute < class rule < id rule; inline style wins for stroke
    expect(computeStyle(doc.children[0].children[0], g, rules)).toEqual({ fill: '#123456', stroke: '#0000ff', hidden: false, visible: false });
    expect(computeStyle(doc.children[0].children[1], g, rules)).toMatchObject({ fill: '#00ff00', visible: true });
    expect(computeStyle(doc.children[0].children[2], g, rules).hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test svg-xml svg-style`
Expected: FAIL. The modules do not exist yet.

- [ ] **Step 3: Write the implementation**

`packages/core/src/import/svg/xml.ts`:

```ts
/** A parsed XML element. `text` is the element's own character data (CDATA included), used for <style>. */
export interface XmlElement { name: string; attrs: Record<string, string>; children: XmlElement[]; text: string; line: number }

export class XmlError extends Error {
  override name = 'XmlError';
  constructor(message: string, readonly line: number) {
    super(`${message} at line ${line}`);
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e] ?? whole;
  });
}

/** The element type without a namespace prefix: "svg:path" → "path". */
export const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

const ATTR = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')|\s*(\/?>)/y;

/** A small, non-validating XML parser: elements, attributes, entities, CDATA, comments, PIs and the doctype. */
export function parseXml(text: string): XmlElement {
  const doc: XmlElement = { name: '#document', attrs: {}, children: [], text: '', line: 1 };
  const stack: XmlElement[] = [doc];
  let i = 0;
  let line = 1;
  const advance = (to: number) => {
    for (let k = i; k < to; k++) if (text.charCodeAt(k) === 10) line++;
    i = to;
  };
  const err = (message: string) => new XmlError(message, line);
  const top = () => stack[stack.length - 1];
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      top().text += decodeEntities(text.slice(i));
      advance(text.length);
      break;
    }
    if (lt > i) {
      top().text += decodeEntities(text.slice(i, lt));
      advance(lt);
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) throw err('Unclosed comment');
      advance(end + 3);
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end < 0) throw err('Unclosed CDATA section');
      top().text += text.slice(i + 9, end);
      advance(end + 3);
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0) throw err('Unclosed processing instruction');
      advance(end + 2);
    } else if (text.startsWith('<!', i)) {
      let k = i + 2;
      let depth = 0;
      for (; k < text.length; k++) {
        const c = text[k];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (k >= text.length) throw err('Unclosed declaration');
      advance(k + 1);
    } else if (text[i + 1] === '/') {
      const end = text.indexOf('>', i);
      if (end < 0) throw err('Unclosed end tag');
      const name = text.slice(i + 2, end).trim();
      const open = top();
      if (stack.length === 1 || open.name !== name) throw err(`Unexpected </${name}>`);
      stack.pop();
      advance(end + 1);
    } else {
      const startLine = line;
      const nameMatch = /^[^\s/>]+/.exec(text.slice(i + 1, i + 257));
      if (!nameMatch) throw err('Invalid tag');
      const el: XmlElement = { name: nameMatch[0], attrs: {}, children: [], text: '', line: startLine };
      let k = i + 1 + nameMatch[0].length;
      let selfClosing = false;
      for (;;) {
        ATTR.lastIndex = k;
        const m = ATTR.exec(text);
        if (!m) throw err(`Malformed attributes in <${el.name}>`);
        k = ATTR.lastIndex;
        if (m[4]) {
          selfClosing = m[4] === '/>';
          break;
        }
        el.attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      top().children.push(el);
      if (!selfClosing) stack.push(el);
      advance(k);
    }
  }
  if (stack.length > 1) throw err(`Unclosed <${top().name}>`);
  const root = doc.children[0];
  if (!root) throw err('No root element');
  return root;
}
```

`packages/core/src/import/svg/style.ts`:

```ts
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
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test svg-xml svg-style`
Expected: PASS (7 tests).
Run: `pnpm --filter @sponcam/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/svg/xml.ts packages/core/src/import/svg/style.ts packages/core/test/svg-xml.test.ts packages/core/test/svg-style.test.ts
git commit -m "feat(core): XML tokenizer and SVG style resolution for the SVG reader"
```

---

### Task 2: Core — transforms, path data and basic shapes

**Files:**
- Create: `packages/core/src/import/svg/transform.ts`, `packages/core/src/import/svg/pathData.ts`, `packages/core/src/import/svg/shapes.ts`
- Test: `packages/core/test/svg-path.test.ts`

**Interfaces:**
- Consumes:
  - `Affine2D`, `AFFINE_IDENTITY`, `affineMultiply`, `affineApply`, `affineTranslate`, `affineScale`, `affineRotate`, `affineDeterminant` and `isSimilarity` from `core/src/import/dxf/affine2d.ts`;
  - `flattenCurve` from `core/src/import/dxf/curves.ts`;
  - `fitArcs` from `core/src/geometry/offset/arcFit.ts`;
  - `Path2D`, `Segment`, `Vec2`, `segmentStart` and `segmentEnd` from `core/src/geometry/path2d.ts`;
  - `XmlElement` (Task 1).
- Produces:
  - `parseTransform(text: string | undefined): Affine2D | null` (identity for empty or undefined; null when invalid)
  - `interface PathDataResult { paths: Path2D[]; error: string | null }`
  - `parsePathData(d: string, m: Affine2D, tol: number): PathDataResult` (geometry in output coordinates)
  - `shapeToPathData(el: XmlElement): string | null` (rect, circle, ellipse, line, polyline, polygon; null otherwise or when degenerate)

- [ ] **Step 1: Write the failing test**

`packages/core/test/svg-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AFFINE_IDENTITY, affineScale, type Affine2D } from '../src/import/dxf/affine2d';
import { segmentEnd, segmentStart, type Path2D } from '../src/geometry/path2d';
import { parsePathData } from '../src/import/svg/pathData';
import { shapeToPathData } from '../src/import/svg/shapes';
import { parseTransform } from '../src/import/svg/transform';
import { parseXml } from '../src/import/svg/xml';

const ends = (p: Path2D) => [segmentStart(p.segments[0]), segmentEnd(p.segments[p.segments.length - 1])];
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};
const kinds = (p: Path2D) => p.segments.map((s) => s.kind);

describe('parseTransform', () => {
  it('composes in SVG order (rightmost applies first)', () => {
    const m = parseTransform('translate(10, 5) scale(2)') as Affine2D;
    expect(m).toMatchObject({ a: 2, d: 2, e: 10, f: 5 });
    const r = parseTransform('rotate(90 10 0)') as Affine2D;
    expect(r.a).toBeCloseTo(0);
    expect(r.e).toBeCloseTo(10);
    expect(r.f).toBeCloseTo(-10);
    expect(parseTransform('matrix(1 0 0 1 3 4)')).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 });
    expect(parseTransform('skewX(45)')!.c).toBeCloseTo(1);
    expect(parseTransform(undefined)).toEqual(AFFINE_IDENTITY);
    expect(parseTransform('scale(1 2 3)')).toBeNull();
    expect(parseTransform('wobble(3)')).toBeNull();
  });
});

describe('parsePathData', () => {
  it('reads absolute and relative lines, H/V and Z', () => {
    const { paths, error } = parsePathData('M10 10 h 20 v10 H10 z m 50 0 l 5 5 5-5', AFFINE_IDENTITY, 0.01);
    expect(error).toBeNull();
    expect(paths).toHaveLength(2);
    expect(paths[0].closed).toBe(true);
    expect(kinds(paths[0])).toEqual(['line', 'line', 'line', 'line']);
    expect(paths[1].closed).toBe(false);
    const [s, e] = ends(paths[1]);
    close(s, { x: 60, y: 10 });
    close(e, { x: 70, y: 10 });
  });

  it('reads compact numbers and arc flags without separators', () => {
    const { paths, error } = parsePathData('M0,0L.5.5 1e1-1e-1a5 5 0 016 6', AFFINE_IDENTITY, 0.01);
    expect(error).toBeNull();
    const segs = paths[0].segments;
    close(segmentEnd(segs[1]), { x: 10, y: -0.1 });
    close(segmentEnd(segs[segs.length - 1]), { x: 16, y: 5.9 });
  });

  it('keeps circular arcs as arcs under a similarity and flattens them otherwise', () => {
    const circle = 'M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z';
    const round = parsePathData(circle, affineScale(2, -2), 0.01).paths[0];
    expect(kinds(round)).toEqual(['arc', 'arc']);
    expect(round.segments[0].kind === 'arc' && round.segments[0].radius).toBeCloseTo(20);
    const squashed = parsePathData(circle, affineScale(2, 1), 0.01).paths[0];
    expect(squashed.segments.length).toBeGreaterThan(2);
    for (const s of squashed.segments) {
      const p = segmentStart(s);
      expect((p.x / 20) ** 2 + (p.y / 10) ** 2).toBeCloseTo(1, 2);
    }
  });

  it('flattens Béziers within tolerance and refits arcs', () => {
    // a quarter circle drawn as a cubic: refitted to arcs, ends exact
    const k = 0.5522847498;
    const { paths } = parsePathData(`M10 0 C10 ${10 * k} ${10 * k} 10 0 10`, AFFINE_IDENTITY, 0.01);
    const [s, e] = ends(paths[0]);
    close(s, { x: 10, y: 0 });
    close(e, { x: 0, y: 10 });
    expect(paths[0].segments.some((x) => x.kind === 'arc')).toBe(true);
    // S and T reflect the previous control point
    const st = parsePathData('M0 0 Q 5 10 10 0 T 20 0 M0 0 C0 5 5 5 5 0 S 10 -5 10 0', AFFINE_IDENTITY, 0.01).paths;
    close(ends(st[0])[1], { x: 20, y: 0 });
    close(ends(st[1])[1], { x: 10, y: 0 });
  });

  it('keeps what it read before a syntax error', () => {
    const r = parsePathData('M0 0 L10 0 L 10 ? 20', AFFINE_IDENTITY, 0.01);
    expect(r.paths).toHaveLength(1);
    expect(r.error).toMatch(/Unexpected/);
  });
});

describe('shapeToPathData', () => {
  const el = (xml: string) => parseXml(xml);
  it('converts basic shapes', () => {
    expect(shapeToPathData(el('<rect x="1" y="2" width="10" height="5"/>'))).toBe('M1 2 H11 V7 H1 Z');
    expect(shapeToPathData(el('<rect width="10" height="10" rx="2"/>'))).toContain('A2 2 0 0 1');
    expect(shapeToPathData(el('<circle cx="5" cy="5" r="2"/>'))).toBe('M7 5 A2 2 0 1 1 3 5 A2 2 0 1 1 7 5 Z');
    expect(shapeToPathData(el('<line x1="0" y1="0" x2="3" y2="4"/>'))).toBe('M0 0 L3 4');
    expect(shapeToPathData(el('<polygon points="0,0 10,0 10,10"/>'))).toBe('M0 0 L10 0 L10 10 Z');
    expect(shapeToPathData(el('<polyline points="0 0 10 0"/>'))).toBe('M0 0 L10 0');
    expect(shapeToPathData(el('<rect width="0" height="5"/>'))).toBeNull();
    expect(shapeToPathData(el('<text>hi</text>'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test svg-path`
Expected: FAIL. The modules do not exist yet.

- [ ] **Step 3: Write the implementation**

`packages/core/src/import/svg/transform.ts`:

```ts
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
```

`packages/core/src/import/svg/pathData.ts`:

```ts
import { type Affine2D, affineApply, affineDeterminant, isSimilarity } from '../dxf/affine2d';
import { flattenCurve } from '../dxf/curves';
import { fitArcs } from '../../geometry/offset/arcFit';
import { type Path2D, type Segment, segmentEnd, type Vec2 } from '../../geometry/path2d';

export interface PathDataResult { paths: Path2D[]; error: string | null }

const TAU = 2 * Math.PI;
/** A subpath whose end returns to its start within this distance (output units) is closed. */
const CLOSE_TOL = 1e-6;
const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

type Token = { cmd: string } | { num: number };

function tokenize(d: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  const re = /\s*,?\s*(?:([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))/y;
  let i = 0;
  while (i < d.length) {
    if (/^[\s,]*$/.test(d.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(d);
    if (!m) return { tokens, error: `Unexpected "${d.slice(i).trim()[0]}" in path data` };
    tokens.push(m[1] ? { cmd: m[1] } : { num: Number(m[2]) });
    i = re.lastIndex;
  }
  return { tokens, error: null };
}

/** Re-splits numbers like "011" that hold two arc flags and an argument. */
function splitArcFlags(d: string): string {
  return d.replace(/([Aa])([^MmLlHhVvCcSsQqTtZz]*)/g, (_, cmd: string, args: string) => {
    const nums = args.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
    const out: string[] = [];
    let slot = 0;
    for (let n of nums) {
      while (n.length) {
        if (slot % 7 === 3 || slot % 7 === 4) {
          out.push(n[0]);
          n = n.slice(1);
        } else {
          out.push(n);
          n = '';
        }
        slot++;
      }
    }
    return `${cmd} ${out.join(' ')} `;
  });
}

/** Points of an elliptical arc from the SVG endpoint parameterisation (spec F.6.5), or null for a straight line. */
function arcCenter(p0: Vec2, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Vec2) {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return null;
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cx1 = (coef * rx * y1) / ry, cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dTheta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dTheta > 0) dTheta -= TAU;
  else if (sweep && dTheta < 0) dTheta += TAU;
  return { cx, cy, rx, ry, cos, sin, theta1, dTheta };
}

/**
 * Parses an SVG path `d` and maps it through `m` into output coordinates. Lines stay lines; circular arcs stay arcs
 * when `m` is a similarity; Béziers and other arcs are flattened within `tol` and refitted to lines and arcs.
 * A syntax error keeps the subpaths read so far.
 */
export function parsePathData(d: string, m: Affine2D, tol: number): PathDataResult {
  const { tokens, error } = tokenize(splitArcFlags(d));
  const paths: Path2D[] = [];
  const similar = isSimilarity(m, 1e-9);
  const mirror = affineDeterminant(m) < 0;
  const scale = Math.sqrt(Math.abs(affineDeterminant(m)));
  const T = (p: Vec2) => affineApply(m, p);

  let segs: Segment[] = [];
  let start: Vec2 = { x: 0, y: 0 };
  let cur: Vec2 = { x: 0, y: 0 };
  let lastCtrl: Vec2 | null = null;
  let lastCmd = '';

  const finish = (closed: boolean) => {
    if (segs.length) {
      const first = T(start);
      const end = segmentEnd(segs[segs.length - 1]);
      const gap = Math.hypot(end.x - first.x, end.y - first.y);
      if (closed && gap > CLOSE_TOL) segs.push({ kind: 'line', from: end, to: first });
      paths.push({ segments: segs, closed: closed || gap <= CLOSE_TOL });
    }
    segs = [];
  };
  const line = (to: Vec2) => {
    const a = T(cur), b = T(to);
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-12) segs.push({ kind: 'line', from: a, to: b });
  };
  const curve = (evaluate: (t: number) => Vec2) => {
    const pts = flattenCurve((t) => T(evaluate(t)), 0, 1, tol / 4);
    segs.push(...fitArcs(pts, false, tol / 2).segments);
  };

  let k = 0;
  let cmd = '';
  while (k < tokens.length) {
    const tok = tokens[k];
    if ('cmd' in tok) {
      cmd = tok.cmd;
      k++;
      if (cmd === 'Z' || cmd === 'z') {
        finish(true);
        cur = start;
        lastCtrl = null;
        lastCmd = 'Z';
        continue;
      }
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      return { paths: (finish(false), paths), error: 'Path data must start with a command' };
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const n = ARG_COUNT[upper];
    const args: number[] = [];
    for (let j = 0; j < n; j++) {
      const t = tokens[k + j];
      if (!t || !('num' in t)) {
        finish(false);
        return { paths, error: error ?? `Missing numbers after "${cmd}" in path data` };
      }
      args.push(t.num);
    }
    k += n;
    const pt = (x: number, y: number): Vec2 => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    switch (upper) {
      case 'M': {
        finish(false);
        cur = start = pt(args[0], args[1]);
        cmd = rel ? 'l' : 'L'; // following pairs are implicit line-tos
        lastCtrl = null;
        break;
      }
      case 'L': { const p = pt(args[0], args[1]); line(p); cur = p; lastCtrl = null; break; }
      case 'H': { const p = { x: rel ? cur.x + args[0] : args[0], y: cur.y }; line(p); cur = p; lastCtrl = null; break; }
      case 'V': { const p = { x: cur.x, y: rel ? cur.y + args[0] : args[0] }; line(p); cur = p; lastCtrl = null; break; }
      case 'C': case 'S': {
        const p0 = cur;
        const c1 = upper === 'C' ? pt(args[0], args[1])
          : lastCtrl && /[CS]/i.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
        const c2 = upper === 'C' ? pt(args[2], args[3]) : pt(args[0], args[1]);
        const p3 = upper === 'C' ? pt(args[4], args[5]) : pt(args[2], args[3]);
        curve((t) => {
          const u = 1 - t;
          return {
            x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
          };
        });
        lastCtrl = c2;
        cur = p3;
        break;
      }
      case 'Q': case 'T': {
        const p0 = cur;
        const c = upper === 'Q' ? pt(args[0], args[1])
          : lastCtrl && /[QT]/i.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
        const p2 = upper === 'Q' ? pt(args[2], args[3]) : pt(args[0], args[1]);
        curve((t) => {
          const u = 1 - t;
          return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
        });
        lastCtrl = c;
        cur = p2;
        break;
      }
      case 'A': {
        const p1 = pt(args[5], args[6]);
        const a = arcCenter(cur, args[0], args[1], args[2], args[3] ? 1 : 0, args[4] ? 1 : 0, p1);
        if (!a) line(p1);
        else if (similar && Math.abs(a.rx - a.ry) <= 1e-9 * Math.max(a.rx, a.ry)) {
          const center = T({ x: a.cx, y: a.cy });
          const s = T(cur);
          segs.push({
            kind: 'arc', center, radius: a.rx * scale,
            startAngle: Math.atan2(s.y - center.y, s.x - center.x), sweep: mirror ? -a.dTheta : a.dTheta,
          });
        } else {
          curve((t) => {
            const th = a.theta1 + a.dTheta * t;
            const x = a.rx * Math.cos(th), y = a.ry * Math.sin(th);
            return { x: a.cos * x - a.sin * y + a.cx, y: a.sin * x + a.cos * y + a.cy };
          });
        }
        cur = p1;
        lastCtrl = null;
        break;
      }
    }
    lastCmd = upper;
  }
  finish(false);
  return { paths, error };
}
```

The flag-splitting is done once on the text (`splitArcFlags`), so the tokenizer never has to know about flags. A path like `a5 5 0 016 6` becomes `A 5 5 0 0 1 6 6`.

`packages/core/src/import/svg/shapes.ts`:

```ts
import type { XmlElement } from './xml';

const num = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};
const f = (n: number) => String(Math.round(n * 1e9) / 1e9);

/** Path data for an SVG basic shape; null for other elements and degenerate shapes. */
export function shapeToPathData(el: XmlElement): string | null {
  const a = el.attrs;
  switch (el.name.slice(el.name.indexOf(':') + 1)) {
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (!(w > 0 && h > 0)) return null;
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
      let ry = a.ry !== undefined ? num(a.ry) : rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx === 0 || ry === 0) return `M${f(x)} ${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
      const arc = (ex: number, ey: number) => `A${f(rx)} ${f(ry)} 0 0 1 ${f(ex)} ${f(ey)}`;
      return [
        `M${f(x + rx)} ${f(y)}`, `H${f(x + w - rx)}`, arc(x + w, y + ry), `V${f(y + h - ry)}`, arc(x + w - rx, y + h),
        `H${f(x + rx)}`, arc(x, y + h - ry), `V${f(y + ry)}`, arc(x + rx, y), 'Z',
      ].join(' ');
    }
    case 'circle': {
      const cx = num(a.cx), cy = num(a.cy), r = num(a.r);
      if (!(r > 0)) return null;
      return `M${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)} Z`;
    }
    case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry);
      if (!(rx > 0 && ry > 0)) return null;
      return `M${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 1 ${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 1 ${f(cx + rx)} ${f(cy)} Z`;
    }
    case 'line':
      return `M${f(num(a.x1))} ${f(num(a.y1))} L${f(num(a.x2))} ${f(num(a.y2))}`;
    case 'polyline':
    case 'polygon': {
      const n = (a.points ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
      if (n.length < 4) return null;
      const pts: string[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push(`${f(n[i])} ${f(n[i + 1])}`);
      return `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')}${el.name.endsWith('polygon') ? ' Z' : ''}`;
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sponcam/core test svg-path`
Expected: PASS (7 tests). If one end-point assertion is off by a small factor, check the arc-flag splitting first, then `arcCenter`'s sign rules against the spec text F.6.5. Fix the code, not the assertion.
Run: `pnpm --filter @sponcam/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/svg/transform.ts packages/core/src/import/svg/pathData.ts packages/core/src/import/svg/shapes.ts packages/core/test/svg-path.test.ts
git commit -m "feat(core): SVG transforms, path data and basic shapes"
```

---

### Task 3: Core — viewport units, `parseSvg` and the fixtures

**Files:**
- Create: `packages/core/src/import/svg/units.ts`, `packages/core/src/import/svg/svg.ts`
- Create fixtures: `packages/core/test/fixtures/svg/inkscape.svg`, `illustrator.svg`, `affinity.svg`, `cad.svg`, `artwork.svg`
- Modify: `packages/core/src/index.ts` (export `./import/svg/svg`)
- Test: `packages/core/test/svg-import.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `Drawing`, `DrawingLayer` and `MAX_DXF_SEGMENTS`/`DEFAULT_CHORD_TOLERANCE` from `core/src/import/dxf/dxf.ts`; `affineMultiply`, `affineScale`, `affineTranslate` and `AFFINE_IDENTITY`.
- Produces:
  - `parseLength(v: string | undefined): { px: number; absolute: boolean } | null`
  - `interface SvgViewport { userToPx: Affine2D; size: Vec2 | null; absolute: boolean }`
  - `svgViewport(root: XmlElement): SvgViewport`
  - `type SvgScale = number | { dpi: number } | { width: number }`
  - `interface SvgOptions { svgScale?: SvgScale; chordTol?: number }`
  - `type SvgImport = { kind: 'drawing'; drawing: Drawing; svgScale: number; warnings: string[] } | { kind: 'needsScale'; rawSize: Vec2; warnings: string[] }`
  - `class SvgParseError extends Error`
  - `parseSvg(text: string, options?: SvgOptions): SvgImport`
  - `resolveSvgScale(scale: SvgScale, rawSize: Vec2): number`

- [ ] **Step 1: Write the fixtures**

`packages/core/test/fixtures/svg/inkscape.svg` (mm root, nested layers, Béziers, a hidden layer, and an asymmetric "L" for orientation):

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="100mm" height="50mm" viewBox="0 0 100 50" version="1.1" xmlns="http://www.w3.org/2000/svg"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">
  <sodipodi:namedview id="nv" inkscape:document-units="mm"/>
  <g inkscape:groupmode="layer" inkscape:label="Cut" id="layer1">
    <rect x="5" y="5" width="90" height="40" rx="3" style="fill:none;stroke:#000000;stroke-width:0.26"/>
    <g inkscape:groupmode="layer" inkscape:label="Holes" id="layer2">
      <circle cx="15" cy="25" r="3" style="fill:none;stroke:#ff0000"/>
      <circle cx="85" cy="25" r="3" style="fill:none;stroke:#ff0000"/>
    </g>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Engrave" id="layer3">
    <path d="M 30,40 V 10 H 45" style="fill:none;stroke:#0000ff"/>
    <path d="M 55,30 C 60,10 70,10 75,30" style="fill:none;stroke:#0000ff"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Notes" id="layer4" style="display:none">
    <rect x="0" y="0" width="10" height="10"/>
  </g>
</svg>
```

`packages/core/test/fixtures/svg/illustrator.svg` (px root, `<style>` classes, layers as plain groups, text):

```xml
<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 144 72" style="enable-background:new 0 0 144 72;">
<style type="text/css">
	.st0{fill:none;stroke:#FF0000;stroke-miterlimit:10;}
	.st1{fill:none;stroke:#0000FF;stroke-miterlimit:10;}
</style>
<g id="Outline">
	<rect x="9" y="9" class="st0" width="126" height="54"/>
</g>
<g id="Pocket">
	<polygon class="st1" points="36,18 108,18 108,54 36,54"/>
	<circle class="st1" cx="72" cy="36" r="9"/>
</g>
<text transform="matrix(1 0 0 1 20 70)" class="st1">LABEL</text>
</svg>
```

`packages/core/test/fixtures/svg/affinity.svg` (px root with width and height, a group transform):

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 200 100" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;">
    <g transform="matrix(1,0,0,1,-10,-10)">
        <g id="Shapes">
            <path d="M30,30L190,30L190,90L30,90L30,30Z" style="fill:none;stroke:rgb(235,0,0);stroke-width:1px;"/>
            <ellipse cx="110" cy="60" rx="30" ry="15" style="fill:none;stroke:rgb(235,0,0);stroke-width:1px;"/>
        </g>
    </g>
</svg>
```

`packages/core/test/fixtures/svg/cad.svg` (mm root, lines and arcs only, no colours):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40">
  <path d="M0 0 L80 0 L80 40 L0 40 Z" fill="none" stroke="black"/>
  <path d="M20 20 A10 10 0 1 0 40 20 A10 10 0 1 0 20 20 Z" fill="none" stroke="black"/>
  <line x1="50" y1="10" x2="70" y2="30" stroke="black"/>
</svg>
```

`packages/core/test/fixtures/svg/artwork.svg` (no units, fills only, nested transforms, `use`/`symbol`, an image, text and a clip path):

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 96 96">
  <defs>
    <symbol id="star" viewBox="0 0 10 10"><polygon points="5,0 6,4 10,4 7,6 8,10 5,7 2,10 3,6 0,4 4,4"/></symbol>
    <clipPath id="clip"><rect width="96" height="96"/></clipPath>
  </defs>
  <g transform="translate(8 8)" clip-path="url(#clip)">
    <path fill="#333" d="M0 0h40v40H0z"/>
    <g transform="scale(2)"><use xlink:href="#star" x="25" y="2"/></g>
    <circle cx="20" cy="70" r="10" fill="#e44"/>
  </g>
  <image href="data:image/png;base64,AAAA" width="10" height="10"/>
  <text x="0" y="90">Hi</text>
</svg>
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/svg-import.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bboxOfPoints, bboxSize, type Drawing, pathsToPoints, segmentEnd, segmentStart } from '../src';
import { parseSvg, resolveSvgScale, SvgParseError } from '../src/import/svg/svg';
import { svgViewport } from '../src/import/svg/units';
import { parseXml } from '../src/import/svg/xml';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/svg/${name}`, import.meta.url), 'utf8');
const size = (d: Drawing) => bboxSize(bboxOfPoints(pathsToPoints(d.layers.flatMap((l) => l.paths)))!);
const names = (d: Drawing) => d.layers.map((l) => l.name);
const drawing = (r: ReturnType<typeof parseSvg>) => {
  if (r.kind !== 'drawing') throw new Error(`expected a drawing, got ${r.kind}`);
  return r;
};

describe('svgViewport', () => {
  it('maps the viewBox to px and knows absolute units', () => {
    const vp = svgViewport(parseXml('<svg width="100mm" height="50mm" viewBox="0 0 100 50"/>'));
    expect(vp.absolute).toBe(true);
    expect(vp.size!.x).toBeCloseTo(377.95, 2);
    expect(vp.userToPx.a).toBeCloseTo(96 / 25.4, 9);
    const px = svgViewport(parseXml('<svg viewBox="10 20 30 40"/>'));
    expect(px).toMatchObject({ absolute: false, size: { x: 30, y: 40 }, userToPx: { a: 1, e: -10, f: -20 } });
    const meet = svgViewport(parseXml('<svg width="200" height="100" viewBox="0 0 100 100"/>'));
    expect(meet.userToPx).toMatchObject({ a: 1, d: 1, e: 50, f: 0 }); // xMidYMid meet
    const none = svgViewport(parseXml('<svg width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"/>'));
    expect(none.userToPx).toMatchObject({ a: 2, d: 1 });
  });
});

describe('parseSvg', () => {
  it('reads an Inkscape file: mm size, nested layers, hidden layer skipped, no prompt', () => {
    const r = drawing(parseSvg(fixture('inkscape.svg')));
    expect(r.svgScale).toBeCloseTo(25.4 / 96, 12);
    expect(names(r.drawing)).toEqual(['Cut', 'Cut/Holes', 'Engrave']);
    const s = size(r.drawing);
    expect(s.x).toBeCloseTo(90, 3);
    expect(s.y).toBeCloseTo(40, 3);
    const cut = r.drawing.layers[0];
    expect(cut.paths).toHaveLength(1);
    expect(cut.paths[0].closed).toBe(true);
    expect(cut.paths[0].segments.filter((x) => x.kind === 'arc')).toHaveLength(4); // rounded corners stay arcs
    expect(r.drawing.layers[1].paths.every((p) => p.closed && p.segments.every((x) => x.kind === 'arc'))).toBe(true);
    expect(r.drawing.layers[2].paths.map((p) => p.closed)).toEqual([false, false]);
  });

  it('flips Y so the drawing reads as it looks on screen (review focus 2)', () => {
    const r = drawing(parseSvg(fixture('inkscape.svg')));
    // the "L" is drawn from (30,40) up to (30,10) then right to (45,10) in SVG (y down):
    // in the drawing its first point is low and the corner is high, and the foot points +X at the top
    const l = r.drawing.layers[2].paths[0];
    const a = segmentStart(l.segments[0]), corner = segmentEnd(l.segments[0]), b = segmentEnd(l.segments[1]);
    expect(corner.y).toBeGreaterThan(a.y);
    expect(b.x).toBeGreaterThan(corner.x);
    expect(b.y).toBeCloseTo(corner.y, 9);
  });

  it('groups Illustrator shapes by their <style> class colours and asks for a scale (review focus 1)', () => {
    const ask = parseSvg(fixture('illustrator.svg'));
    if (ask.kind !== 'needsScale') throw new Error('expected needsScale');
    expect(ask.rawSize.x).toBeCloseTo(126, 6);
    expect(ask.rawSize.y).toBeCloseTo(54, 6);
    const r = drawing(parseSvg(fixture('illustrator.svg'), { svgScale: { dpi: 72 } }));
    expect(r.svgScale).toBeCloseTo(25.4 / 72, 12);
    expect(names(r.drawing)).toEqual(['#ff0000', '#0000ff']);
    expect(r.drawing.layers.map((l) => l.color)).toEqual([0xff0000, 0x0000ff]);
    expect(size(r.drawing).x).toBeCloseTo((126 * 25.4) / 72, 6);
    expect(r.warnings).toContain('1 text element was skipped — convert text to paths before exporting');
  });

  it('resolves the scale choices', () => {
    expect(resolveSvgScale({ dpi: 96 }, { x: 10, y: 10 })).toBeCloseTo(25.4 / 96, 12);
    expect(resolveSvgScale({ width: 50 }, { x: 200, y: 10 })).toBeCloseTo(0.25, 12);
    expect(resolveSvgScale(0.5, { x: 1, y: 1 })).toBe(0.5);
    const r = drawing(parseSvg(fixture('illustrator.svg'), { svgScale: { width: 252 } }));
    expect(size(r.drawing).x).toBeCloseTo(252, 6);
  });

  it('reads Affinity-style files: percent sizes, group transforms, rgb() colours', () => {
    const r = drawing(parseSvg(fixture('affinity.svg'), { svgScale: { dpi: 96 } }));
    expect(names(r.drawing)).toEqual(['#eb0000']);
    expect(r.drawing.layers[0].paths).toHaveLength(2);
    expect(size(r.drawing).x).toBeCloseTo((160 * 25.4) / 96, 6);
  });

  it('reads a CAD export with true arcs and an open line', () => {
    const r = drawing(parseSvg(fixture('cad.svg')));
    expect(names(r.drawing)).toEqual(['#000000']);
    const paths = r.drawing.layers[0].paths;
    expect(paths.map((p) => p.closed)).toEqual([true, true, false]);
    expect(paths[1].segments.every((s) => s.kind === 'arc')).toBe(true);
  });

  it('reads web artwork: fills, nested transforms, use/symbol; skips image, text and clip with warnings', () => {
    const r = drawing(parseSvg(fixture('artwork.svg'), { svgScale: 1 }));
    expect(names(r.drawing)).toEqual(['#333333', '#000000', '#ee4444']);
    const star = r.drawing.layers[1].paths[0];
    expect(star.closed).toBe(true);
    expect(star.segments).toHaveLength(10);
    expect(r.warnings).toEqual(expect.arrayContaining([
      '1 text element was skipped — convert text to paths before exporting',
      '1 embedded image was skipped',
      'Clip paths and masks were ignored; the full shapes were imported',
    ]));
  });

  it('fails clearly on non-SVG and empty files', () => {
    expect(() => parseSvg('<html></html>')).toThrow(new SvgParseError('Not an SVG file'));
    expect(() => parseSvg('<svg><g>')).toThrow(/Not a valid SVG file: Unclosed <g> at line 1/);
    expect(() => parseSvg('<svg width="10mm" height="10mm"><text>x</text></svg>')).toThrow(/^No shapes found in this SVG/);
  });
});
```

The `artwork` star: `symbol` children are walked with the `use` element's `x`/`y` translation. The symbol's own `viewBox` is ignored (clarified in the reader's code comment). The test only checks the star's segment count and that it is closed.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test svg-import`
Expected: FAIL. `svg.ts` and `units.ts` do not exist yet.

- [ ] **Step 4: Write the implementation**

`packages/core/src/import/svg/units.ts`:

```ts
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
```

`packages/core/src/import/svg/svg.ts`:

```ts
import { type Affine2D, AFFINE_IDENTITY, affineMultiply, affineScale, affineTranslate } from '../dxf/affine2d';
import { DEFAULT_CHORD_TOLERANCE, type Drawing, type DrawingLayer, MAX_DXF_SEGMENTS } from '../dxf/dxf';
import { bboxOfPoints, bboxSize } from '../../geometry/bbox';
import { type Path2D, pathsToPoints, type Vec2 } from '../../geometry/path2d';
import { parsePathData } from './pathData';
import { shapeToPathData } from './shapes';
import { type ComputedStyle, computeStyle, type CssRule, INITIAL_STYLE, parseCss } from './style';
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
  const counts = { text: 0, image: 0, clip: 0, transform: 0 };
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
    if (type === 'text') return void counts.text++;
    if (type === 'image') return void counts.image++;
    if (type === 'foreignObject') return;
    const style = computeStyle(el, parent, rules);
    if (style.hidden) return;
    if (el.attrs['clip-path'] || el.attrs.mask) counts.clip++;
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
      for (const c of el.children) walk(c, mm, style, lay, depth);
      return;
    }
    if (type === 'use') {
      const href = el.attrs.href ?? el.attrs['xlink:href'] ?? '';
      const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
      if (!target || depth >= MAX_USE_DEPTH) return;
      const placed = affineMultiply(mm, affineTranslate(Number(el.attrs.x) || 0, Number(el.attrs.y) || 0));
      // a referenced symbol's own viewBox is not applied: its children are placed at the use position
      if (localName(target.name) === 'symbol') for (const c of target.children) walk(c, placed, style, lay, depth + 1);
      else walk(target, placed, style, lay, depth + 1);
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
  const height = (vp.size?.y ?? 0) * svgScale;
  const toOut = affineMultiply({ a: 1, b: 0, c: 0, d: -1, e: 0, f: height }, affineScale(svgScale, svgScale));
  const { layers, errors } = build(items, inkscapeLayers, toOut, chordTol);
  warnings.push(...errors);
  if (!layers.length) throw new SvgParseError(['No shapes found in this SVG', ...warnings].join('. '));
  return { kind: 'drawing', drawing: { layers }, svgScale, warnings };
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from './import/svg/svg';
```

Check that the `pathsToPoints` import path in `svg.ts` matches where it is exported. It lives in `core/src/geometry/path2d.ts` (see `pipeline/model.ts`). If it lives elsewhere, import it from there.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sponcam/core test svg-import`
Expected: PASS (9 tests).
Run: `pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/import/svg packages/core/src/index.ts packages/core/test/fixtures/svg packages/core/test/svg-import.test.ts
git commit -m "feat(core): parseSvg reads SVG files into drawings with layers, scale and warnings"
```

---

### Task 4: SVG through the import pipeline (core, MCP, web state)

**Files:**
- Modify (core): `import/importFile.ts`, `pipeline/readModel.ts`, `pipeline/model.ts`, `pipeline/importFlow.ts`, `pipeline/importOutcome.ts`, `bridge/protocol.ts`, `job/types.ts`, `job/update.ts`
- Modify (core tests): `test/pipeline-readModel.test.ts` (`body` → `{ body }`)
- Modify (MCP): `src/session.ts` (`ModelInput.svgScale`), `src/fileSession.ts`, `src/live/liveSession.ts`, `src/tools/session.ts` (`import_model`), `test/fakeTab.ts`
- Modify (web): `workers/import.worker.ts`, `workers/importClient.ts`, `state/store.ts` (`pendingScale`), `state/documents.ts`, `bridge/handlers.ts`
- Test: `packages/core/test/svg-pipeline.test.ts`; additions to `packages/mcp/test/tools-session.test.ts` and `packages/mcp/test/fileSession.test.ts`; `packages/web/src/state/documents-bridge.test.ts`

**Interfaces:**
- Consumes: `parseSvg`, `SvgScale` and `resolveSvgScale` (Task 3).
- Produces:
  - `ModelFormat` and `ModelRef.format` include `'svg'`; `ModelRef.svgScale?: number`; `NewModel.svgScale?: number` and `NewModel.format?: 'stl' | 'step' | 'iges' | 'svg'`.
  - `ImportResult` drawing variant: `svgScale?: number`. A new variant: `{ ok: true; kind: 'needsScale'; rawSize: Vec2; warnings: string[] }`.
  - `importFile(fileName: string, bytes: Uint8Array, options?: { svgScale?: SvgScale }): ImportResult`.
  - `interface ImportOptions { body?: number; svgScale?: SvgScale }`; `importModel(fileName, bytes, options: ImportOptions, loadReader): Promise<ImportResult>`.
  - The drawing `ModelGeometry` gains `svgScale?: number` (copied by `toModelGeometry`).
  - `ImportStep` gains `{ kind: 'needsScale'; rawSize: Vec2 }`.
  - `ImportOutcome` gains `{ status: 'needsScale'; rawSize: Vec2; suggestedDpi: number }`; `decideImport` returns it.
  - `newModelRef` sets `format: 'svg'` and `svgScale` for an SVG drawing.
  - `BridgeMethods.importModel.params` gains `svgScale?: SvgScale`.
  - MCP: `ModelInput.svgScale?: SvgScale`; `import_model` gains `svgDpi?: 96 | 72` and `svgWidth?: number`.
  - Web:
    - `importInWorker(fileName, bytes, options?: ImportOptions)` and the worker's `import(fileName, bytes, options)`;
    - `AppState.pendingScale: PendingScale | null` and `setPendingScale(p)`, where `interface PendingScale { fileName: string; bytes: Uint8Array; rawSize: Vec2 }`;
    - `importModelBytes(fileName, bytes, options?: ImportOptions)`;
    - `importModelOutcome(fileName, bytes, options?: { units?: LengthUnit; body?: number; svgScale?: SvgScale })`;
    - `importPendingScale(scale: SvgScale)` and `cancelPendingScale()`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/svg-pipeline.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createJob, decideImport, importFile, importModel, importStep, modelFilePath, modelSummary, newModelRef, setModel, toModelGeometry,
} from '../src';

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/svg/${name}`, import.meta.url)));
const noReader = async () => {
  throw new Error('the OCCT reader must not load for SVG');
};

describe('SVG in the import pipeline', () => {
  it('imports an absolute-unit SVG as a drawing in mm with its scale', async () => {
    const r = await importModel('part.svg', bytes('inkscape.svg'), {}, noReader);
    if (!r.ok || r.kind !== 'drawing') throw new Error('expected a drawing');
    expect(r.detectedUnits).toBe('mm');
    expect(r.svgScale).toBeCloseTo(25.4 / 96, 12);
    const step = importStep(r);
    const d = decideImport(step);
    if (d.status !== 'ready') throw new Error(`expected ready, got ${d.status}`);
    const model = newModelRef('part.svg', d.geometry, d.units, 'b1');
    expect(model).toMatchObject({ format: 'svg', importUnits: 'mm', kind: 'drawing' });
    expect(model.svgScale).toBeCloseTo(25.4 / 96, 12);
    const job = setModel(createJob(), model);
    expect(modelFilePath(job.model!)).toBe('models/b1.svg');
    expect(modelSummary(job.model)).toMatchObject({ format: 'svg' });
  });

  it('asks for a scale for px SVGs and re-reads with the choice', async () => {
    const ask = importFile('art.svg', bytes('illustrator.svg'));
    expect(ask).toMatchObject({ ok: true, kind: 'needsScale' });
    expect(decideImport(importStep(ask))).toMatchObject({ status: 'needsScale', suggestedDpi: 96 });
    const r = await importModel('art.svg', bytes('illustrator.svg'), { svgScale: { dpi: 72 } }, noReader);
    if (!r.ok || r.kind !== 'drawing') throw new Error('expected a drawing');
    expect(toModelGeometry(r)).toMatchObject({ kind: 'drawing', svgScale: 25.4 / 72 });
    // the stored number reproduces the same drawing (review focus 3)
    const again = importFile('art.svg', bytes('illustrator.svg'), { svgScale: r.svgScale });
    expect(again).toEqual(r);
  });
});
```

Add to `packages/mcp/test/tools-session.test.ts` (copy `illustrator.svg` and `inkscape.svg` into the temp dir with the `connect` helper's `files` list; extend `fixturePath` in `test/helpers.ts` to accept `svg/<name>` paths and copy them to their base name):

```ts
  it('asks for an SVG scale, then imports with svgDpi or svgWidth', async () => {
    const { call } = await connect({}, ['svg/illustrator.svg']);
    await call('new_job');
    const ask = await call('import_model', { path: 'illustrator.svg' });
    expect(data(ask).status).toBe('needsScale');
    expect(text(ask)).toContain('svgDpi');
    expect((await call('import_model', { path: 'illustrator.svg', svgDpi: 72, svgWidth: 10 })).isError).toBe(true);
    const done = await call('import_model', { path: 'illustrator.svg', svgWidth: 252 });
    expect(data(done)).toMatchObject({ status: 'imported', kind: 'drawing' });
    expect(data(done).size.x).toBeCloseTo(252, 3);
  });
```

Add to `packages/mcp/test/fileSession.test.ts`:

```ts
  it('reopens an SVG job at the same scale with an identical catalog and G-code (review focus 3)', async () => {
    const s = FileSession.create({ name: 'Svg' }, options());
    expect((await s.importModel({ fileName: 'art.svg', bytes: fixture('svg/illustrator.svg'), svgScale: { dpi: 72 } })).status).toBe('imported');
    const outline = (await s.catalog())!.contours[0].ref as GeometryRef;
    await s.apply([
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
      { type: 'updateOperation', id: 'p', patch: { geometry: [outline] } },
    ]);
    const path = await s.save(join(tempDir(), 'svg-job'));
    const reopened = await FileSession.open(path, options());
    expect((await reopened.job()).model).toMatchObject({ format: 'svg', svgScale: 25.4 / 72 });
    expect(await reopened.catalog()).toEqual(await s.catalog());
    expect((await reopened.run()).files.map((f) => f.text)).toEqual((await s.run()).files.map((f) => f.text));
  });
```

Add to `packages/web/src/state/documents-bridge.test.ts` (the `importInWorker` mock already forwards to `importFile`; make it pass the third argument through: `vi.fn(async (name, bytes, options) => importFile(name, bytes, options))`):

```ts
describe('bridge SVG import', () => {
  it('answers needsScale, then imports with a scale', async () => {
    const svg = new TextEncoder().encode('<svg viewBox="0 0 96 48"><rect width="96" height="48"/></svg>');
    expect(await importModelOutcome('a.svg', svg)).toMatchObject({ status: 'needsScale', rawSize: { x: 96, y: 48 }, suggestedDpi: 96 });
    const done = await importModelOutcome('a.svg', svg, { svgScale: { dpi: 96 } });
    expect(done).toMatchObject({ status: 'imported', kind: 'drawing' });
    expect(appStore.getState().job.model).toMatchObject({ format: 'svg', svgScale: 25.4 / 96 });
  });

  it('puts a px SVG dropped in the app into pendingScale', async () => {
    const { importModelBytes } = await import('./documents');
    await importModelBytes('a.svg', new TextEncoder().encode('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'));
    expect(appStore.getState().pendingScale).toMatchObject({ fileName: 'a.svg', rawSize: { x: 10, y: 10 } });
  });
});
```

Existing calls in `documents-bridge.test.ts` of the form `importModelOutcome('part.stl', STL, 'mm')` become `importModelOutcome('part.stl', STL, { units: 'mm' })`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test svg-pipeline`
Expected: FAIL. `importModel` still takes `body`, and `.svg` is not a model format.

- [ ] **Step 3: Write the implementation**

**Core.**

In `import/importFile.ts`:
- `ModelFormat` adds `'svg'`.
- `FORMATS` maps `['svg', 'svg']`.
- `fileKind` returns `'drawing'` for `dxf` and `svg`.
- The drawing variant of `ImportResult` gains `svgScale?: number`, and add the `needsScale` variant.
- `importFile` becomes:

```ts
export function importFile(fileName: string, bytes: Uint8Array, options: { svgScale?: SvgScale } = {}): ImportResult {
  const format = modelFormat(fileName);
  if (!format) return { ok: false, error: `Unsupported file type: ${fileName}` };
  if (format === 'step' || format === 'iges') return { ok: false, error: 'STEP and IGES files are read by the import worker' };
  try {
    if (format === 'stl') {
      const stl = importStl(bytes);
      return { ok: true, kind: 'mesh', ...stl, detectedUnits: null };
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    if (format === 'svg') {
      const svg = parseSvg(text, { svgScale: options.svgScale });
      if (svg.kind === 'needsScale') return { ok: true, kind: 'needsScale', rawSize: svg.rawSize, warnings: svg.warnings };
      return { ok: true, kind: 'drawing', drawing: svg.drawing, detectedUnits: 'mm', warnings: svg.warnings, svgScale: svg.svgScale };
    }
    const dxf = parseDxf(text);
    return { ok: true, kind: 'drawing', drawing: dxf.drawing, detectedUnits: dxf.detectedUnits, warnings: dxf.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

In `pipeline/readModel.ts`:

```ts
/** How to read a model: which STEP/IGES body, and an SVG's scale. */
export interface ImportOptions { body?: number; svgScale?: SvgScale }

export async function importModel(fileName: string, bytes: Uint8Array, options: ImportOptions, loadReader: OcctLoader): Promise<ImportResult> {
  const format = cadFormat(fileName);
  if (!format) return importFile(fileName, bytes, { svgScale: options.svgScale });
  // … unchanged, with cadImport(result, format, options.body)
}
```

In `pipeline/model.ts`: the drawing variant of `ModelGeometry` becomes `{ kind: 'drawing'; drawing: Drawing; rawPoints: Float32Array; svgScale?: number }`, and `toModelGeometry` adds `...(result.svgScale !== undefined ? { svgScale: result.svgScale } : {})` for drawings. `SuccessfulImport` keeps `kind: 'mesh' | 'drawing'`.

In `pipeline/importFlow.ts`: `ImportStep` adds `| { kind: 'needsScale'; rawSize: Vec2 }`, and `importStep` adds `if (result.kind === 'needsScale') return { kind: 'needsScale', rawSize: result.rawSize };` after the `bodies` case.

In `bridge/protocol.ts`:
- `ImportOutcome` adds `| { status: 'needsScale'; rawSize: Vec2; suggestedDpi: number }`.
- `importModel` params gain `svgScale?: SvgScale`.
- Import `Vec2` from `../geometry/path2d` and `SvgScale` from `../import/svg/svg`, both as types.

In `pipeline/importOutcome.ts`:
- `decideImport` adds, after the `chooseBody` case: `if (step.kind === 'needsScale') return { status: 'needsScale', rawSize: step.rawSize, suggestedDpi: 96 };`.
- `newModelRef` becomes:

```ts
export function newModelRef(fileName: string, geometry: ModelGeometry, units: LengthUnit, blobId: string): NewModel {
  const base = { sourceName: fileName, blobId, kind: geometry.kind, importUnits: units };
  if (geometry.kind === 'drawing') return geometry.svgScale !== undefined ? { ...base, format: 'svg', svgScale: geometry.svgScale } : base;
  return geometry.source ? { ...base, format: geometry.source.format, body: geometry.source.body } : base;
}
```

In `job/types.ts`, `ModelRef.format` becomes `'stl' | 'step' | 'iges' | 'svg'`, and it gains `/** SVG: mm per CSS px, as chosen or read at import. */ svgScale?: number;`. `NewModel` in `job/update.ts` gets the same two fields. `modelFilePath` and `modelSummary` need no change: the format already drives them.

`importResultTransferables` needs no change: it only transfers meshes.

**MCP.**

`src/session.ts`: `export interface ModelInput { fileName: string; bytes: Uint8Array; units?: LengthUnit; body?: number; svgScale?: SvgScale }`.

`src/fileSession.ts`:
- `importModel` calls `importModel(input.fileName, input.bytes, { body: input.body, svgScale: input.svgScale }, this.options.loadReader)`.
- `open` calls `importModel(modelFilePath(job.model), blobs[job.model.blobId], { body: job.model.body, svgScale: job.model.svgScale }, options.loadReader)`.
- A `needsScale` step while opening is an error: `"${path}: Could not load the job's model: the SVG's scale is missing"`. Add it next to the `chooseBody` check, in the same form.

`src/live/liveSession.ts` `importModel` adds `...(input.svgScale !== undefined ? { svgScale: input.svgScale } : {})` to the params. `test/fakeTab.ts`'s `importModel` handler passes `svgScale: p.svgScale` through.

`src/tools/session.ts`:
- `importModelShape` gains:

```ts
  svgDpi: z.union([z.literal(96), z.literal(72)]).optional().describe('SVG without real-world units: 96 (CSS, Inkscape, Affinity) or 72 (Illustrator) px per inch'),
  svgWidth: z.number().positive().optional().describe('SVG without real-world units: scale so the drawing is this wide (mm)'),
```

- The tool body builds the scale and refuses both:

```ts
    if (a.svgDpi !== undefined && a.svgWidth !== undefined) throw new SessionError('Give svgDpi or svgWidth, not both');
    const svgScale = a.svgDpi !== undefined ? { dpi: a.svgDpi } : a.svgWidth !== undefined ? { width: a.svgWidth } : undefined;
    const outcome = await session.importModel({ fileName: name, bytes: input.bytes, units: a.units, body: a.body, svgScale });
```

- `importText` gains:

```ts
    case 'needsScale': {
      const mm = (dpi: number) => `${((o.rawSize.x * 25.4) / dpi).toFixed(1)} × ${((o.rawSize.y * 25.4) / dpi).toFixed(1)} mm`;
      return `${name} does not say how large it is: its content measures ${o.rawSize.x.toFixed(1)} × ${o.rawSize.y.toFixed(1)} px. `
        + `That is ${mm(96)} at 96 dpi (CSS, Inkscape, Affinity) or ${mm(72)} at 72 dpi (Illustrator). `
        + 'Call import_model again with svgDpi: 96 or 72, or svgWidth: <mm>.';
    }
```

**Web.**

`workers/import.worker.ts`: `async import(fileName: string, bytes: Uint8Array, options: ImportOptions = {})` calls `importModel(fileName, bytes, options, loadOcct)`. `workers/importClient.ts`: `importInWorker(fileName, bytes, options: ImportOptions = {})` passes `options` through.

`state/store.ts`:
- Add `export interface PendingScale { fileName: string; bytes: Uint8Array; rawSize: Vec2 }`.
- In `AppState`, add `pendingScale: PendingScale | null` and `setPendingScale(p: PendingScale | null): void`.
- Initial value `null`. `loadDocument` resets it to `null`, the same as `pendingBodies`.

`state/documents.ts`:
- `geometryForModel` calls `importInWorker(modelFilePath(model), bytes, { body: model.body, svgScale: model.svgScale })`. A `needsScale` result there is an error: `'The SVG scale is missing from the job'`.
- `readModelFile(fileName, bytes, options: ImportOptions = {})`.
- `importModelBytes(fileName, bytes, options: ImportOptions = {})`. After the `chooseBody` case, add:

```ts
  if (step.kind === 'needsScale') {
    state().setPendingScale({ fileName, bytes, rawSize: step.rawSize });
    return;
  }
```

- `importPendingBody(body)` calls `importModelBytes(pending.fileName, pending.bytes, { body })`.
- Add:

```ts
/** Re-reads the pending SVG at the scale picked in the scale dialog. */
export async function importPendingScale(scale: SvgScale): Promise<void> {
  const pending = state().pendingScale;
  if (!pending) return;
  state().setPendingScale(null);
  await importModelBytes(pending.fileName, pending.bytes, { svgScale: scale });
}

export function cancelPendingScale(): void {
  state().setPendingScale(null);
}
```

- `importModelOutcome(fileName, bytes, options: { units?: LengthUnit; body?: number; svgScale?: SvgScale } = {})` reads with `{ body: options.body, svgScale: options.svgScale }`, and decides with `decideImport(step, options.units)`.

`bridge/handlers.ts`: `importModel: ({ fileName, bytes, units, body, svgScale }) => importModelOutcome(fileName, fromBase64(bytes), { units, body, svgScale })`.

`core/test/pipeline-readModel.test.ts`: every `importModel(name, bytes, body, loader)` becomes `importModel(name, bytes, { body }, loader)`, and `undefined` becomes `{}`. Grep the repo for other `importModel(` and `importInWorker(` callers (`packages/mcp/test/occt.test.ts`, the web `importClient.test.ts`) and update them the same way.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test svg-pipeline readModel`
Run: `pnpm --filter @sponcam/mcp test tools-session fileSession`
Run: `pnpm --filter @sponcam/web test documents-bridge importClient`
Expected: PASS.
Run: `pnpm typecheck && pnpm test`
Expected: PASS (all packages).

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/mcp packages/web
git commit -m "feat: SVG through the import pipeline — svgScale on the model, needsScale outcome, import options object"
```

---

### Task 5: Core — offsetting an open line to one side

**Files:**
- Create: `packages/core/src/geometry/offset/openOffset.ts`
- Modify: `packages/core/src/index.ts` (export it)
- Test: `packages/core/test/open-offset.test.ts`

**Interfaces:**
- Consumes: `sweepPolylines` from `geometry/offset/clipper.ts`; `flattenPath`, `pathLength`, `nearestS` and `pointAt` from `geometry/offset/pathOps.ts`; `fitArcs`; `Path2D` and `Vec2`.
- Produces:
  - `interface OpenOffset { path: Path2D; rounded: boolean }`
  - `offsetOpenPath(path: Path2D, side: 'left' | 'right', distance: number, tol: number): OpenOffset | null`
  - The returned path runs in the input's direction (from near its start to near its end). It is at least `distance` from the line everywhere and within `tol` of `distance` along straight stretches. `rounded` is true when a bend was trimmed. The result is null when nothing remains.

- [ ] **Step 1: Write the failing test**

`packages/core/test/open-offset.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flattenPath, nearestS, type Path2D, pathFromPoints, pathLength, segmentEnd, segmentStart } from '../src';
import { offsetOpenPath } from '../src/geometry/offset/openOffset';

const L: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }], false);
const tol = 0.01;

function check(line: Path2D, lap: Path2D, distance: number) {
  for (const p of flattenPath(lap, 0.001)) {
    const d = nearestS(line, p).distance;
    expect(d).toBeGreaterThanOrEqual(distance - 1e-6); // never closer than requested (the line is the part's edge)
    expect(d).toBeLessThanOrEqual(distance + tol + 1e-6);
  }
}

describe('offsetOpenPath', () => {
  it('offsets to the left and right of the drawn direction', () => {
    const left = offsetOpenPath(L, 'left', 3, tol)!;
    const right = offsetOpenPath(L, 'right', 3, tol)!;
    // going +X first: left is +Y, right is −Y
    expect(segmentStart(left.path.segments[0]).y).toBeCloseTo(3, 2);
    expect(segmentStart(right.path.segments[0]).y).toBeCloseTo(-3, 2);
    // both follow the line's direction: they start near x = 0 and end near y = 30
    expect(segmentStart(left.path.segments[0]).x).toBeCloseTo(0, 1);
    expect(segmentEnd(left.path.segments.at(-1)!).y).toBeCloseTo(30, 1);
    check(L, left.path, 3);
    check(L, right.path, 3);
    expect(left.rounded || right.rounded).toBe(false);
    // the inside of the corner is shorter, the outside longer (round join)
    expect(pathLength(left.path)).toBeLessThan(pathLength(L));
    expect(pathLength(right.path)).toBeGreaterThan(pathLength(L));
  });

  it('keeps an arc an arc', () => {
    const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 20, startAngle: 0, sweep: Math.PI / 2 }] };
    const out = offsetOpenPath(arc, 'right', 2, tol)!; // right of a CCW arc is outward
    expect(out.path.segments.some((s) => s.kind === 'arc')).toBe(true);
    check(arc, out.path, 2);
  });

  it('trims a bend that is too tight for the tool and says so (review focus 4)', () => {
    // a U-turn 4 mm wide; offsetting 3 mm to the inside cannot follow it
    const u: Path2D = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 4 }, { x: 0, y: 4 }], false);
    const inside = offsetOpenPath(u, 'left', 3, tol);
    expect(inside).not.toBeNull();
    expect(inside!.rounded).toBe(true);
    check(u, inside!.path, 3);
    const tightArc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 2, startAngle: 0, sweep: Math.PI }] };
    const r = offsetOpenPath(tightArc, 'left', 3, tol); // left of a CCW arc is toward the centre
    if (r) {
      expect(r.rounded).toBe(true);
      check(tightArc, r.path, 3);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test open-offset`
Expected: FAIL. `openOffset.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

`packages/core/src/geometry/offset/openOffset.ts`:

```ts
import type { Path2D, Vec2 } from '../path2d';
import { fitArcs } from './arcFit';
import { sweepPolylines } from './clipper';
import { flattenPath, nearestS, pathLength, pointAt } from './pathOps';

export interface OpenOffset { path: Path2D; rounded: boolean }

/**
 * The tool-centre path `distance` to the left or right of an open path, seen along its direction. It is the part
 * of the disc-swept band around the path that lies on that side between the two end caps, so bends too tight for
 * the distance are trimmed (rounded) instead of crossing the line. Like closed-contour offsets, the flattening,
 * join and fit approximations are added to the distance, so the result never comes closer than `distance`.
 */
export function offsetOpenPath(path: Path2D, side: 'left' | 'right', distance: number, tol: number): OpenOffset | null {
  const flatTol = tol / 4, joinTol = tol / 8, fitTol = tol / 2;
  const d = distance + flatTol + joinTol + fitTol;
  const pts = flattenPath(path, flatTol);
  if (pts.length < 2 || !(distance > 0)) return null;
  const total = pathLength(path);
  const want = side === 'left' ? 1 : -1;
  const band = sweepPolylines([{ points: pts, closed: false }], d, joinTol);

  /** 1 / −1 for a point beside the path (left / right), 0 for one on an end cap. */
  const classify = (v: Vec2): { side: number; s: number } => {
    const { s } = nearestS(path, v);
    const { point, tangent } = pointAt(path, s);
    const dx = v.x - point.x, dy = v.y - point.y;
    const along = dx * tangent.x + dy * tangent.y;
    if ((s <= 1e-9 && along < -1e-6) || (s >= total - 1e-9 && along > 1e-6)) return { side: 0, s };
    return { side: tangent.x * dy - tangent.y * dx > 0 ? 1 : -1, s };
  };

  const runs: { pts: Vec2[]; s: number[] }[] = [];
  for (const ring of band) {
    const cls = ring.map(classify);
    const n = ring.length;
    const breakAt = cls.findIndex((c) => c.side !== want);
    if (breakAt < 0) continue; // a ring entirely on one side is a hole inside a tight bend: not a cutting path
    let cur: { pts: Vec2[]; s: number[] } | null = null;
    for (let j = 1; j <= n; j++) {
      const k = (breakAt + j) % n;
      if (cls[k].side === want) {
        cur ??= { pts: [], s: [] };
        cur.pts.push(ring[k]);
        cur.s.push(cls[k].s);
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
  }
  const usable = runs.filter((r) => r.pts.length >= 2);
  if (!usable.length) return null;
  const span = (r: { s: number[] }) => Math.abs(r.s[r.s.length - 1] - r.s[0]);
  usable.sort((a, b) => span(b) - span(a));
  const best = usable[0];
  const ordered = best.s[0] <= best.s[best.s.length - 1] ? best.pts : [...best.pts].reverse();
  const rounded = usable.length > 1 || tightBend(path, want, distance);
  return { path: fitArcs(ordered, false, fitTol, fitTol), rounded };
}

/** True when an arc of the path bends toward `want` (1 = left) with a radius no larger than the distance. */
function tightBend(path: Path2D, want: number, distance: number): boolean {
  return path.segments.some((s) => s.kind === 'arc' && Math.sign(s.sweep) === want && s.radius <= distance);
}
```

Add `export * from './geometry/offset/openOffset';` to `packages/core/src/index.ts`.

If the U-turn test reports `rounded: false`, check that it produces more than one run or a shortened single run. The U-turn's inside band has a concave notch, which produces two left-side runs once the inner offsets cross. If it still does not flag, also treat "the run covers less than 99 % of the path's length between the end caps" as rounded: compare `span(best)` with `total`. Add that to `rounded` and say so in the report. Do not weaken the test.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sponcam/core test open-offset && pnpm --filter @sponcam/core typecheck`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/geometry/offset/openOffset.ts packages/core/src/index.ts packages/core/test/open-offset.test.ts
git commit -m "feat(core): offset an open line to its left or right, trimming bends that are too tight"
```

---

### Task 6: Core — open sides in the job model and the profile operation

**Files:**
- Modify: `cam/types.ts`, `cam/defaults.ts`, `job/commands.ts`, `io/migrations.ts`, `cam/features/chain.ts`, `cam/features/resolve.ts`, `cam/ops/profile.ts`
- Modify (tests that assert the current schema version is 3): `test/job-programs.test.ts`, `test/job-v3.test.ts`, `test/job-update.test.ts`. Assertions that mean "the current version" use `CURRENT_SCHEMA_VERSION`. A literal `schemaVersion: 3` in a job built by a test to be migrated stays 3.
- Test: `packages/core/test/profile-open-sides.test.ts`, plus a migration case in `test/job-v3.test.ts` or a new `test/migration-v4.test.ts`

**Interfaces:**
- Consumes: `offsetOpenPath` (Task 5).
- Produces:
  - `ProfileOp.openSide: 'left' | 'on' | 'right'`, defaulting to `'on'` in `newOperation`
  - `DxfPathRef.reverse?: true`
  - `CamCode` gains `'bend-rounded'`
  - `CURRENT_SCHEMA_VERSION = 4`, with a migration from v3 that adds `openSide: 'on'` to every profile operation
  - `chainPaths(...)` returns `{ closed, open, openSeeds }`, where `openSeeds[k]` is the index into the input `paths` of the piece that seeded `open[k]`
  - `resolveGeometry`: each open chain of a profile is a contour whose `ref` is its seed's index in `op.geometry`, reversed when that seed has `reverse`. There is no `open-contour` error for profiles any more.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/profile-open-sides.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommand, applyCommands, chainPaths, createJob, type JobCommand, migrateJob, pathFromPoints, PipelineCache, programContext, runPipeline,
  setModel, setStock, type Toolpath,
} from '../src';
import type { CamGeometry } from '../src';
import { tool6 } from './fixtures/camSetup';

// an L: (0,0) → (60,0) → (60,40), as a one-layer drawing at the model's raw coordinates
const drawing: CamGeometry = {
  kind: 'drawing',
  drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [pathFromPoints([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }], false)] }] },
  rawPoints: new Float32Array([0, 0, 0, 60, 0, 0, 60, 40, 0]),
};

function cut(patch: Record<string, unknown>, reverse = false): Toolpath {
  let job = setModel(createJob(), { sourceName: 'l.svg', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: 0, path: 0, ...(reverse ? { reverse: true as const } : {}) }], stepdown: 3, ...patch } },
  ];
  job = applyCommands(job, commands);
  const { run, toolpaths } = runPipeline(job, drawing as never, programContext(job, drawing as never), new PipelineCache(), { date: '2026-01-01' });
  expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return toolpaths[0];
}

/** The tool-centre XY moves at cutting depth (feed moves below the top). */
const cuts = (tp: Toolpath) => tp.moves.filter((m) => m.kind !== 'rapid' && m.to.z < -0.5).map((m) => m.to);

describe('open-line sides', () => {
  it('cuts on the line by default, as before', () => {
    const pts = cuts(cut({}));
    expect(pts.some((p) => Math.abs(p.y) < 1e-6 && p.x > 1 && p.x < 59)).toBe(true);
  });

  it('cuts left or right of the drawn direction at the tool radius', () => {
    // from (0,0) along +X: left is +Y, right is −Y (in program coordinates the stock origin shifts both equally)
    const left = cuts(cut({ openSide: 'left' }));
    const right = cuts(cut({ openSide: 'right' }));
    const yAtMid = (pts: { x: number; y: number }[]) => pts.filter((p) => p.x > 20 && p.x < 40).map((p) => p.y);
    const on = yAtMid(cuts(cut({})))[0];
    expect(yAtMid(left).every((y) => Math.abs(y - (on + 3)) < 0.02)).toBe(true);
    expect(yAtMid(right).every((y) => Math.abs(y - (on - 3)) < 0.02)).toBe(true);
  });

  it('sets the travel direction from climb or conventional and reverse; every level runs the same way', () => {
    const firstCut = (tp: Toolpath) => {
      const at = tp.moves.findIndex((m) => m.kind !== 'rapid' && m.to.z < -0.5);
      return { from: tp.moves[at].to, next: tp.moves[at + 1].to };
    };
    const dir = (tp: Toolpath) => {
      const { from, next } = firstCut(tp);
      return Math.sign(next.x - from.x) || Math.sign(next.y - from.y);
    };
    expect(dir(cut({ openSide: 'left', direction: 'climb' }))).toBe(1); // with the drawn direction
    expect(dir(cut({ openSide: 'right', direction: 'climb' }))).not.toBe(1);
    expect(dir(cut({ openSide: 'left', direction: 'conventional' }))).not.toBe(1);
    expect(dir(cut({ openSide: 'left', direction: 'climb' }, true))).not.toBe(1); // reversed chain, so left is the other side
    // two levels (6 mm / 3 mm stepdown): each starts at the same end
    const tp = cut({ openSide: 'left' });
    const starts = tp.moves.filter((m, i) => m.kind !== 'rapid' && i > 0 && tp.moves[i - 1].to.z > m.to.z + 1e-9 && m.to.z < -0.5 && m.to.x === tp.moves[i - 1].to.x).map((m) => m.to);
    expect(new Set(starts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(1);
  });

  it('records which piece seeds each open chain', () => {
    const a = pathFromPoints([{ x: 10, y: 0 }, { x: 20, y: 0 }], false);
    const b = pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], false);
    const r = chainPaths([a, b], 1e-6);
    expect(r.open).toHaveLength(1);
    expect(r.openSeeds).toEqual([0]);
  });

  it('migrates v3 jobs: profiles get openSide on, and post the same G-code', () => {
    const v3 = { ...createJob(), schemaVersion: 3, operations: [{ ...applyCommand(createJob(), { type: 'addOperation', opType: 'profile', toolId: null, id: 'p' }).operations[0] }] };
    delete (v3.operations[0] as Record<string, unknown>).openSide;
    const job = migrateJob(v3);
    expect(job.operations[0]).toMatchObject({ openSide: 'on' });
    expect(job.schemaVersion).toBe(4);
  });
});
```

`Move` is `{ kind: 'rapid' | 'line' | 'arc'; to: Vec3; … }` (`cam/types.ts`), which is what the helpers read.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test profile-open-sides`
Expected: FAIL. `openSide` is rejected as a key, and `openSeeds` is undefined.

- [ ] **Step 3: Write the implementation**

`cam/types.ts`:
- `ProfileOp` gains `/** Open chains: which side of the line (seen along its direction) the tool runs on. */ openSide: 'left' | 'on' | 'right';`.
- `DxfPathRef` becomes `{ kind: 'dxfPath'; blobId: string; layer: number; path: number; /** Open chains seeded by this reference run against its drawn direction. */ reverse?: true }`.
- `CamCode` gains `'bend-rounded'`.

`cam/defaults.ts`: add `openSide: 'on'` to the profile operation, next to `side: 'outside'`.

`job/commands.ts`: the profile `OP_KEYS` gains `'openSide'`.

`io/migrations.ts`: `CURRENT_SCHEMA_VERSION = 4`, and:

```ts
  // v3 → v4 (Milestone 4.1): profiles get a side for open chains; "on" keeps the old behaviour
  3: (job) => ({
    ...job,
    operations: (Array.isArray(job.operations) ? job.operations : []).map((op) =>
      (op as { type?: unknown }).type === 'profile' ? { openSide: 'on', ...(op as object) } : op),
  }),
```

`cam/features/chain.ts`: keep a parallel array of input indices for `pieces` (`pieceIndex`), push `pieceIndex[i]` into `openSeeds` whenever a grown chain is pushed to `open`, and return `{ closed, open, openSeeds }`.

`cam/features/resolve.ts`, in the profile branch:

```ts
      const { closed, open, openSeeds } = chainPaths(dxf.map((d) => d.path), ctx.tolerance);
      if (op.type === 'profile') {
        for (const path of closed) out.contours.push({ path, z: drawingZ, ref: firstRef });
        open.forEach((path, k) => {
          const seed = dxf[openSeeds[k]].ref;
          const g = op.geometry[seed];
          const reversed = g.kind === 'dxfPath' && g.reverse === true;
          out.contours.push({ path: reversed ? reversePath(path) : path, z: drawingZ, ref: seed });
        });
      } else {
```

(Import `reversePath` from `../../geometry/offset/pathOps`. The pocket branch keeps its `open-contour` error.)

`cam/ops/profile.ts`:
- Import `offsetOpenPath`.
- `centreLaps` returns diagnostics-friendly results for open paths:

```ts
function centreLaps(path: Path2D, op: ProfileOp, offset: number, tol: number): { laps: Path2D[]; rounded: boolean } | null {
  if (!path.closed) {
    if (op.openSide === 'on' || offset === 0) return { laps: [path], rounded: false };
    const res = offsetOpenPath(path, op.openSide, offset, tol);
    if (!res) return null;
    // climb keeps the cut edge on the tool's right (M3): left of the line runs with it, right runs against it
    const forward = (op.openSide === 'left') === (op.direction === 'climb');
    return { laps: [forward ? res.path : reversePath(res.path)], rounded: res.rounded };
  }
  if (op.side === 'on' || offset === 0) return { laps: [path], rounded: false };
  // … existing closed-path code, returning { laps: res.map(...), rounded: false } or null
}
```

- The callers:
  - Read `.laps`.
  - Add `if (laps.rounded) diag('warning', 'bend-rounded', 'The tool is too large for a bend in this line; the bend was rounded', c.ref);`.
  - The finish-pass call reads `(centreLaps(c.path, op, r, tol)?.laps ?? [])`.
  - The null case keeps `offset-collapsed`, with the message `'The tool does not fit beside this line'` for open paths and the old message for closed ones.
- `cutOpen(lap, levels, h, first)` gains a `sameWay: boolean` parameter, true when `op.openSide !== 'on'`. Pass `!lap.closed && op.openSide !== 'on'` from the caller:

```ts
  const cutOpen = (lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean, sameWay: boolean) => {
    if (op.entry.mode !== 'plunge' && !plungeWarned) {
      diag('warning', 'entry-plunge', 'Open contours are entered with a plunge');
      plungeWarned = true;
    }
    let path = lap;
    w.travel(pathStart(path), first ? h.clearance : h.retract, h.feed);
    levels.forEach((z, i) => {
      if (sameWay && i > 0) w.travel(pathStart(path), h.retract, h.feed); // back over the top: every level cuts the same way
      w.line({ x: w.pos!.x, y: w.pos!.y, z }, plunge);
      emitLap(w, path, z, z, feed, null);
      if (!sameWay) path = reversePath(path);
    });
    w.up(h.retract);
  };
```

Fix the schema-version assertions listed under Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test profile-open-sides job open-offset pipeline-run preview`
Expected: PASS.
Run: `pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS. Every existing profile and DXF golden test is unchanged, because `openSide: 'on'` keeps the old path.

`pnpm typecheck` across the repo may now fail in `mcp/src/schemas.ts`, because its type-level equality test no longer matches `JobCommand`. Task 8 fixes that. If it blocks your run, add `openSide: z.enum(['left', 'on', 'right'])` to the operation patch schema and `reverse: z.literal(true).optional()` to the `dxfPath` ref schema now, and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/mcp/src/schemas.ts
git commit -m "feat(core): profiles cut left or right of open lines (openSide, reverse), schema v4"
```

---

### Task 7: Core — LinuxCNC tool tables

**Files:**
- Create: `packages/core/src/tools/linuxcnc.ts`, `packages/core/test/fixtures/tool.tbl`
- Modify: `packages/core/src/index.ts` (export it)
- Test: `packages/core/test/linuxcnc.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolType`, `sortTools`, `mergeToolLibrary`, `parseToolLibraryFile`, `ToolLibraryMerge`, `starterLibrary` and `LengthUnit`.
- Produces:
  - `interface ToolTableImport { tools: Tool[]; skipped: { line: number; reason: string }[]; guesses: string[] }`
  - `parseLinuxCncToolTable(text: string, units: LengthUnit): ToolTableImport` (throws `Error('No tools found in this tool table')`)
  - `mergeToolTable(existing: readonly Tool[], imported: readonly Tool[]): ToolLibraryMerge`. `incoming` includes renumbered existing tools.
  - `interface ToolFileImport extends ToolLibraryMerge { skipped: { name: string; reason: string }[] }`
  - `importToolFile(existing: readonly Tool[], bytes: Uint8Array, fileName: string, units?: LengthUnit): ToolFileImport`. A `.tbl` without units throws `Error('A LinuxCNC tool table has no units')`.
  - `suggestToolTableUnits(text: string): LengthUnit`
  - `isToolTableFile(fileName: string): boolean`

- [ ] **Step 1: Write the fixture and the failing test**

`packages/core/test/fixtures/tool.tbl`:

```
; LinuxCNC tool table
T1 P1 D0.25 Z+1.0 ;1/4 flat endmill
t2 p2 z+0.5 d0.125 ;Spiralbohrer 1/8
T3 P3 D0.5 Z+0.8 ;V60 engraving
T4 P4 D0.25 ;ball nose
T5 P5 D0.375 ;bull R0.03
T6 P6 D0.5 ;chamfer 90°

T7 P7 Z+0.2 ;no diameter
T1 P8 D0.3 ;duplicate number
T8 P9 D0.1
```

`packages/core/test/linuxcnc.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importToolFile, mergeToolTable, parseLinuxCncToolTable, starterLibrary, suggestToolTableUnits } from '../src';

const text = readFileSync(new URL('./fixtures/tool.tbl', import.meta.url), 'utf8');

describe('LinuxCNC tool tables', () => {
  it('parses words in any order and case, converting inches to mm', () => {
    const r = parseLinuxCncToolTable(text, 'in');
    expect(r.tools.map((t) => t.number)).toEqual([1, 2, 3, 4, 5, 6, 8]);
    expect(r.tools[0]).toMatchObject({ id: 'linuxcnc-T1', name: '1/4 flat endmill', type: 'flat', diameter: 6.35, flutes: 2, presets: [] });
    expect(r.tools[0].fluteLength).toBeCloseTo(19.05, 9);
    expect(r.tools[0].stickout).toBeCloseTo(25.4, 9);
    expect(r.tools[6]).toMatchObject({ name: 'T8 ⌀0.1', diameter: 2.54 });
    expect(r.skipped).toEqual([
      { line: 9, reason: 'no diameter (D)' },
      { line: 10, reason: 'T1 appears again; the first line was used' },
    ]);
  });

  it('guesses the tool type from the comment and lists the guesses', () => {
    const r = parseLinuxCncToolTable(text, 'in');
    const by = (n: number) => r.tools.find((t) => t.number === n)!;
    expect(by(2)).toMatchObject({ type: 'drill', tipAngleDeg: 118 });
    expect(by(3)).toMatchObject({ type: 'vbit', tipAngleDeg: 60 });
    expect(by(4)).toMatchObject({ type: 'ball', cornerRadius: 3.175 });
    expect(by(5).type).toBe('bull');
    expect(by(5).cornerRadius).toBeCloseTo(0.762, 9);
    expect(by(6)).toMatchObject({ type: 'chamfer', tipAngleDeg: 90 });
    expect(r.guesses).toContain('T2 Spiralbohrer 1/8: drill (from the comment)');
    expect(r.guesses.some((g) => g.startsWith('T1 '))).toBe(false); // flat with no keyword is not a guess
  });

  it('suggests inches when every diameter is under 1', () => {
    expect(suggestToolTableUnits(text)).toBe('in');
    expect(suggestToolTableUnits('T1 D6\nT2 D0.5')).toBe('mm');
  });

  it("keeps the table's T numbers and moves clashing library tools (review focus 5)", () => {
    const library = starterLibrary();
    const clash = library.find((t) => t.number === 3)!;
    const merge = mergeToolTable(library, parseLinuxCncToolTable(text, 'in').tools);
    const numbers = merge.library.map((t) => t.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(merge.library.find((t) => t.id === 'linuxcnc-T3')!.number).toBe(3);
    const moved = merge.library.find((t) => t.id === clash.id)!;
    expect(moved.number).not.toBe(3);
    expect(merge.notes).toContain(`${clash.name} moved from T3 to T${moved.number}`);
    expect(merge.incoming.some((t) => t.id === clash.id)).toBe(true);
    // re-importing updates the same tools
    const again = mergeToolTable(merge.library, parseLinuxCncToolTable(text, 'in').tools);
    expect(again.added).toBe(0);
    expect(again.updated).toBe(7);
  });

  it('imports through importToolFile, and needs units for .tbl', () => {
    const bytes = new TextEncoder().encode(text);
    expect(() => importToolFile([], bytes, 'tool.tbl')).toThrow('A LinuxCNC tool table has no units');
    const r = importToolFile([], bytes, 'tool.tbl', 'in');
    expect(r.added).toBe(7);
    expect(r.skipped).toEqual([
      { name: 'line 9', reason: 'no diameter (D)' },
      { name: 'line 10', reason: 'T1 appears again; the first line was used' },
    ]);
    expect(() => parseLinuxCncToolTable('; nothing\n', 'mm')).toThrow('No tools found in this tool table');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test linuxcnc`
Expected: FAIL. The module does not exist yet.

- [ ] **Step 3: Write the implementation**

`packages/core/src/tools/linuxcnc.ts`:

```ts
import type { LengthUnit } from '../units/units';
import { mergeToolLibrary, parseToolLibraryFile, sortTools, type ToolLibraryMerge } from './library';
import type { Tool, ToolType } from './types';

export interface ToolTableImport { tools: Tool[]; skipped: { line: number; reason: string }[]; guesses: string[] }
export interface ToolFileImport extends ToolLibraryMerge { skipped: { name: string; reason: string }[] }

export const isToolTableFile = (fileName: string): boolean => fileName.toLowerCase().endsWith('.tbl');

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const trimNumber = (n: number) => String(Number(n.toFixed(4)));

function words(body: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of body.matchAll(new RegExp(`([A-Za-z])\\s*(${NUM})`, 'g'))) {
    const letter = m[1].toUpperCase();
    if (!out.has(letter)) out.set(letter, Number(m[2]));
  }
  return out;
}

/** Tool type from comment keywords; `scale` converts lengths written in the comment (R…) to mm. */
function guessType(comment: string, diameter: number, scale: number): { type: ToolType; cornerRadius: number; tipAngleDeg: number; matched: boolean } {
  const c = comment.toLowerCase();
  const angle = (fallback: number) => {
    const m = /(\d+(?:\.\d+)?)\s*(?:°|deg)/.exec(c) ?? /\bv\s*-?\s*(\d+(?:\.\d+)?)\b/.exec(c);
    return m ? Number(m[1]) : fallback;
  };
  if (/drill|bohr/.test(c)) return { type: 'drill', cornerRadius: 0, tipAngleDeg: 118, matched: true };
  if (/chamfer|fase/.test(c)) return { type: 'chamfer', cornerRadius: 0, tipAngleDeg: angle(90), matched: true };
  if (/v-?bit|engrav/.test(c) || /\bv\s*-?\s*\d/.test(c) || /\d\s*°/.test(c)) return { type: 'vbit', cornerRadius: 0, tipAngleDeg: angle(60), matched: true };
  if (/ball/.test(c)) return { type: 'ball', cornerRadius: diameter / 2, tipAngleDeg: 0, matched: true };
  const r = /\br\s*(\d+(?:\.\d+)?)\b/.exec(c);
  if (/bull/.test(c) || r) {
    const radius = r ? Math.min(Number(r[1]) * scale, diameter / 2) : diameter / 10;
    return { type: 'bull', cornerRadius: radius, tipAngleDeg: 0, matched: true };
  }
  return { type: 'flat', cornerRadius: 0, tipAngleDeg: 0, matched: false };
}

/** Parses a LinuxCNC tool table (T, P, D, offsets, ;comment per line). `units` is the machine's length unit. */
export function parseLinuxCncToolTable(text: string, units: LengthUnit): ToolTableImport {
  const scale = units === 'in' ? 25.4 : 1;
  const tools: Tool[] = [];
  const skipped: ToolTableImport['skipped'] = [];
  const guesses: string[] = [];
  const seen = new Set<number>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const semi = raw.indexOf(';');
    const body = (semi < 0 ? raw : raw.slice(0, semi)).trim();
    const comment = semi < 0 ? '' : raw.slice(semi + 1).trim();
    if (!body) return;
    const w = words(body);
    const t = w.get('T');
    const d = w.get('D');
    if (t === undefined || !Number.isInteger(t) || t < 0) return void skipped.push({ line, reason: 'no tool number (T)' });
    if (d === undefined) return void skipped.push({ line, reason: 'no diameter (D)' });
    if (!(d > 0)) return void skipped.push({ line, reason: 'the diameter must be greater than 0' });
    if (seen.has(t)) return void skipped.push({ line, reason: `T${t} appears again; the first line was used` });
    seen.add(t);
    const diameter = d * scale;
    const name = comment || `T${t} ⌀${trimNumber(d)}`;
    const g = guessType(comment, diameter, scale);
    if (g.matched) guesses.push(`T${t} ${name}: ${g.type} (from the comment)`);
    tools.push({
      id: `linuxcnc-T${t}`, name, type: g.type, number: t, diameter, cornerRadius: g.cornerRadius, tipAngleDeg: g.tipAngleDeg,
      fluteLength: 3 * diameter, stickout: 4 * diameter, flutes: 2, presets: [],
    });
  });
  if (!tools.length) throw new Error('No tools found in this tool table');
  return { tools, skipped, guesses };
}

/** Inches when every diameter is under 1 (a 1 mm tool table entry is rare; a 1 inch one is too). */
export function suggestToolTableUnits(text: string): LengthUnit {
  const ds = [...text.matchAll(new RegExp(`(?:^|\\s)[dD]\\s*(${NUM})`, 'gm'))].map((m) => Number(m[1])).filter((d) => d > 0);
  return ds.length && ds.every((d) => d < 1) ? 'in' : 'mm';
}

/** The table's T numbers win (they must match the machine); a different library tool holding one moves to the next free number. */
export function mergeToolTable(existing: readonly Tool[], imported: readonly Tool[]): ToolLibraryMerge {
  const importedIds = new Set(imported.map((t) => t.id));
  const existingIds = new Set(existing.map((t) => t.id));
  const tableNumbers = new Set(imported.map((t) => t.number));
  const others = existing.filter((t) => !importedIds.has(t.id));
  const taken = new Set([...tableNumbers, ...others.map((t) => t.number)]);
  const notes: string[] = [];
  const moved: Tool[] = [];
  for (const t of others) {
    if (!tableNumbers.has(t.number)) continue;
    let n = t.number;
    while (taken.has(n)) n++;
    taken.add(n);
    notes.push(`${t.name} moved from T${t.number} to T${n}`);
    moved.push({ ...t, number: n });
  }
  const incoming = [...imported, ...moved];
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  const updated = imported.filter((t) => existingIds.has(t.id)).length;
  return { incoming, library: sortTools([...byId.values()]), added: imported.length - updated, updated, notes };
}

/** One entry point for every tool library file: Spon/Fusion libraries, or a LinuxCNC tool table (needs units). */
export function importToolFile(existing: readonly Tool[], bytes: Uint8Array, fileName: string, units?: LengthUnit): ToolFileImport {
  if (isToolTableFile(fileName)) {
    if (!units) throw new Error('A LinuxCNC tool table has no units');
    const table = parseLinuxCncToolTable(new TextDecoder().decode(bytes), units);
    const merge = mergeToolTable(existing, table.tools);
    return { ...merge, notes: [...merge.notes, ...table.guesses], skipped: table.skipped.map((s) => ({ name: `line ${s.line}`, reason: s.reason })) };
  }
  const parsed = parseToolLibraryFile(bytes, fileName);
  return { ...mergeToolLibrary(existing, parsed.tools), skipped: parsed.skipped };
}
```

Add `export * from './tools/linuxcnc';` to `packages/core/src/index.ts`, unless `tools/library.ts` is already re-exported through a barrel that should include it.

If `starterLibrary()` has no tool with T number 3, change the test's clash number to one the starter library does use (read `starterLibrary.ts`) and add a matching line to the fixture. Keep the assertion that numbers stay unique.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sponcam/core test linuxcnc && pnpm --filter @sponcam/core typecheck`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/linuxcnc.ts packages/core/src/index.ts packages/core/test/fixtures/tool.tbl packages/core/test/linuxcnc.test.ts
git commit -m "feat(core): LinuxCNC tool.tbl import with type guesses and table-wins T numbers"
```

---

### Task 8: MCP — open sides, reversed handles and tool tables

**Files:**
- Modify: `packages/mcp/src/schemas.ts`, `src/handles.ts`, `src/instructions.ts`, `src/session.ts` (`ToolLibraryAccess`), `src/library.ts`, `src/live/liveSession.ts`, `src/tools/library.ts`, `test/fakeTab.ts`, `README.md`
- Modify (core): `bridge/protocol.ts` (`tools.import` params gain `units?: LengthUnit`)
- Modify (web): `bridge/handlers.ts` `'tools.import'` (passes `units`), `state/toolLibrary.ts` `importLibraryBytes(fileName, bytes, units?)`, which now uses `importToolFile`
- Test: `packages/mcp/test/schemas.test.ts`, `handles.test.ts`, `tools-edit.test.ts`, `tools-library.test.ts`

**Interfaces:**
- Consumes: `importToolFile`, `isToolTableFile` (Task 7); `openSide` and `reverse` (Task 6).
- Produces:
  - zod: the operation patch gains `openSide`; the `dxfPath` ref gains `reverse`.
  - `HandleMap.resolve('C3!')` → that contour's ref with `reverse: true`. `!` on a non-contour handle → `SessionError('Only drawing contours (C…) can be reversed')`.
  - `ToolLibraryAccess.importFile(fileName: string, bytes: Uint8Array, options?: { label?: string; units?: LengthUnit }): Promise<LibraryImportResult>`
  - `import_tool_library { path, units? }`
  - Web `importLibraryBytes(fileName, bytes, units?: LengthUnit)` and `importLibraryFile(file, units?)`

- [ ] **Step 1: Write the failing tests**

Add to `packages/mcp/test/handles.test.ts`:

```ts
  it('reverses a contour handle with a trailing !', () => {
    const map = new HandleMap();
    map.assign({ faces: [], holes: [], contours: [{ ref: { kind: 'dxfPath', blobId: 'b', layer: 0, path: 2 }, layer: 'L', closed: false, length: 10, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } }, circle: null }] } as never);
    expect(map.resolve('C1!')).toEqual({ kind: 'dxfPath', blobId: 'b', layer: 0, path: 2, reverse: true });
    expect(map.resolve('c1')).toEqual({ kind: 'dxfPath', blobId: 'b', layer: 0, path: 2 });
    expect(() => map.resolve('F1!')).toThrow(/Unknown handle F1|Only drawing contours/);
  });
```

Add to `packages/mcp/test/tools-edit.test.ts`. Use the `cad.svg` fixture, which has an open line, through `connect({}, ['svg/cad.svg'])`:

```ts
  it('profiles an open line on its right with a reversed handle', async () => {
    const { call } = await connect({}, ['svg/cad.svg']);
    await call('new_job');
    await call('import_model', { path: 'cad.svg' });
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } } }] });
    const catalog = data(await call('describe_geometry')) as { contours: { handle: string; closed: boolean }[] };
    const open = catalog.contours.find((c) => !c.closed)!;
    const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [`${open.handle}!`], params: { openSide: 'right' } });
    expect(added.isError).toBeFalsy();
    expect(data(added).operation).toMatchObject({ openSide: 'right', geometry: [{ reverse: true }] });
    const gen = data(await call('generate')) as { operations: { status: string }[] };
    expect(gen.operations[0].status).not.toBe('error');
  });
```

Add to `packages/mcp/test/tools-library.test.ts` (copy the core fixture `tool.tbl` with `connect({}, ['tool.tbl'])`):

```ts
  it('imports a LinuxCNC tool table, asking for units first', async () => {
    const { call } = await connect({}, ['tool.tbl']);
    const ask = await call('import_tool_library', { path: 'tool.tbl' });
    expect(ask.isError).toBe(true);
    expect(text(ask)).toBe('A LinuxCNC tool table has no units — call import_tool_library again with units: "mm" or "in"');
    const done = await call('import_tool_library', { path: 'tool.tbl', units: 'in' });
    expect(data(done)).toMatchObject({ added: 7 });
    expect(text(done)).toContain('moved from T');
    const listed = data(await call('list_tools', { query: 'Spiralbohrer' })) as { tools: { number: number; type: string }[] };
    expect(listed.tools[0]).toMatchObject({ number: 2, type: 'drill' });
  });
```

In `packages/mcp/test/schemas.test.ts`, extend the round-trip list with `{ type: 'updateOperation', id: 'p', patch: { openSide: 'left', geometry: [{ kind: 'dxfPath', blobId: 'b', layer: 0, path: 1, reverse: true }] } }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/mcp test handles tools-edit tools-library schemas`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/schemas.ts`:
- The `dxfPath` ref becomes `z.strictObject({ kind: z.literal('dxfPath'), blobId: z.string(), layer: z.number().int(), path: z.number().int(), reverse: z.literal(true).optional() })`.
- The operation patch gains `openSide: z.enum(['left', 'on', 'right'])`, next to `side`.
- If the type-level equality test complains about `reverse?: true` against `reverse?: true | undefined`, mirror whatever the file already does for other optional fields.

`src/handles.ts`, `resolve`:

```ts
  resolve(item: string | GeometryRef): GeometryRef {
    if (typeof item !== 'string') return item;
    const raw = item.trim().toUpperCase();
    const reverse = raw.endsWith('!');
    const name = reverse ? raw.slice(0, -1) : raw;
    const ref = this.refs.get(name);
    if (!ref) throw new SessionError(`Unknown handle ${item.trim()} — call describe_geometry for the current list`);
    if (!reverse) return ref;
    if (ref.kind !== 'dxfPath') throw new SessionError('Only drawing contours (C…) can be reversed');
    return { ...ref, reverse: true };
  }
```

`add_operation`'s description of `on` (in `tools/edit.ts`) strips a trailing `!` only for display. It already upper-cases handle strings, so `C3!` shows as `C3!`, which is fine.

`src/instructions.ts`, under "Operation parameters", add to the profile line `openSide (left | on | right, for open lines; seen along the line's direction)`. Add a line:

```
- Open lines: profile them with openSide left or right to cut beside the line (the line is the part's edge). A handle with a trailing ! (C3!) reverses the line's direction, which swaps left and right.
```

`src/session.ts`: `ToolLibraryAccess.importFile(fileName: string, bytes: Uint8Array, options?: { label?: string; units?: LengthUnit }): Promise<LibraryImportResult>`.

`src/library.ts` `ToolLibraryFile.importFile`:

```ts
  importFile(fileName: string, bytes: Uint8Array, options: { label?: string; units?: LengthUnit } = {}): Promise<LibraryImportResult> {
    const label = options.label ?? fileName;
    return this.serial(async () => {
      let result: ReturnType<typeof importToolFile>;
      try {
        result = importToolFile(await this.read(), bytes, fileName, options.units);
      } catch (err) {
        throw new SessionError(`Could not read the tool library file ${label}: ${message(err)}`);
      }
      await this.write(result.library);
      return { added: result.added, updated: result.updated, skipped: result.skipped, notes: result.notes };
    });
  }
```

(Drop the now-unused `mergeToolLibrary` and `parseToolLibraryFile` imports.)

`src/tools/library.ts` `import_tool_library`:
- Its shape gains `units: lengthUnitSchema.optional().describe('LinuxCNC tool tables (.tbl) only: the machine\'s units')`.
- Before reading, `if (isToolTableFile(a.path) && !a.units) throw new SessionError('A LinuxCNC tool table has no units — call import_tool_library again with units: "mm" or "in"');`.
- The call becomes `ctx.library().importFile(basename(input.path), input.bytes, { label: input.path, units: a.units })`.
- Its description mentions `.tbl`.

`src/live/liveSession.ts`: `importFile: (fileName, bytes, options) => tab.request('tools.import', { fileName, bytes: toBase64(bytes), ...(options?.units ? { units: options.units } : {}) })`. In `core/src/bridge/protocol.ts`, `'tools.import'` params become `{ fileName: string; bytes: string; units?: LengthUnit }`. `test/fakeTab.ts` passes `{ units: p.units }`.

Web:
- `state/toolLibrary.ts`:

```ts
export async function importLibraryBytes(fileName: string, bytes: Uint8Array, units?: LengthUnit): Promise<LibraryImportResult> {
  const d = await db();
  const result = importToolFile(await d.getAll('tools'), bytes, fileName, units);
  const tx = d.transaction('tools', 'readwrite');
  for (const t of result.incoming) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
  return { added: result.added, updated: result.updated, skipped: result.skipped, notes: result.notes };
}

export async function importLibraryFile(file: File, units?: LengthUnit): Promise<LibraryImportResult> {
  return importLibraryBytes(file.name, new Uint8Array(await file.arrayBuffer()), units);
}
```

- `bridge/handlers.ts`: `'tools.import': ({ fileName, bytes, units }) => importLibraryBytes(fileName, fromBase64(bytes), units)`.

`README.md`: `import_tool_library` accepts LinuxCNC `.tbl` files with `units`; handles take a trailing `!` to reverse an open contour.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/mcp test && pnpm --filter @sponcam/web test toolLibrary handlers && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/mcp packages/web
git commit -m "feat(mcp): openSide and reversed handles for open lines; LinuxCNC tool tables in import_tool_library"
```

---

### Task 9: Web — the SVG scale dialog and opening `.svg`

**Files:**
- Create: `packages/web/src/layout/SvgScaleDialog.tsx`, `packages/web/src/layout/svgScale.ts`
- Modify: `packages/web/src/App.tsx` (mount the dialog), `packages/web/src/state/fileio.ts` (`OPEN_TYPES` gains `.svg`), `packages/web/src/layout/TopBar.tsx` (the `accept` attribute gains `.svg`), `packages/web/src/state/documents.ts` (the unsupported-type message lists `.svg`)
- Test: `packages/web/src/layout/svgScale.test.ts`

**Interfaces:**
- Consumes: `pendingScale`, `importPendingScale` and `cancelPendingScale` (Task 4); `resolveSvgScale` and `SvgScale` (core).
- Produces:
  - `scaleChoices(rawSize: Vec2): { id: '96' | '72'; label: string; scale: SvgScale; size: Vec2 }[]`, with sizes in mm
  - `widthScale(widthMm: number): SvgScale | null` (null unless > 0)
  - test ids `svg-scale-dialog`, `svg-scale-96`, `svg-scale-72`, `svg-scale-width` (input) and `svg-scale-width-apply`

- [ ] **Step 1: Write the failing test**

`packages/web/src/layout/svgScale.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/web test svgScale`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`packages/web/src/layout/svgScale.ts`:

```ts
import { resolveSvgScale, type SvgScale, type Vec2 } from '@sponcam/core';

const CHOICES = [
  { id: '96' as const, label: '96 dpi (CSS, Inkscape, Affinity)', scale: { dpi: 96 } },
  { id: '72' as const, label: '72 dpi (Illustrator)', scale: { dpi: 72 } },
];

export function scaleChoices(rawSize: Vec2) {
  return CHOICES.map((c) => {
    const s = resolveSvgScale(c.scale, rawSize);
    return { ...c, size: { x: rawSize.x * s, y: rawSize.y * s } };
  });
}

export const widthScale = (widthMm: number): SvgScale | null => (Number.isFinite(widthMm) && widthMm > 0 ? { width: widthMm } : null);
```

`packages/web/src/layout/SvgScaleDialog.tsx` follows `UnitsDialog.tsx`'s structure and styling:
- A `Dialog` open while `pendingScale` is set; closing calls `cancelPendingScale()`.
- Title: `Size of {fileName}`.
- Description: `This SVG has no real-world size. Pick how its pixels convert to millimetres.`
- One button per `scaleChoices(pending.rawSize)` entry. 96 dpi is the default (`variant="default"`, `autoFocus`). Each shows its `size` formatted with `formatLength(v, 'mm')` as `W × H mm`, and clicking calls `importPendingScale(choice.scale)`.
- Then a row with a `LengthField`-style input. Use a plain `Input` with `data-testid="svg-scale-width"`, a "Width" label and an `mm` suffix, plus a button `svg-scale-width-apply` ("Use this width") that is enabled when `widthScale(Number(value))` is not null and calls `importPendingScale(widthScale(...)!)`. Below it, a muted line shows the height that width implies: `height = width × rawSize.y / rawSize.x`.

Mount `<SvgScaleDialog />` in `App.tsx` next to `<UnitsDialog />`. Add `.svg` to `OPEN_TYPES` in `fileio.ts`, to the `accept` attribute in `TopBar.tsx`, and to the unsupported-type message in `documents.ts`. The drop zone goes through `openFile`, which uses `fileKind`, so it needs no change.

- [ ] **Step 4: Run the tests and build**

Run: `pnpm --filter @sponcam/web test svgScale && pnpm --filter @sponcam/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): open SVG files and choose the scale of px-based SVGs"
```

---

### Task 10: Web — Open side, the Reverse toggle and direction arrows

**Files:**
- Create: `packages/web/src/inspector/openChains.ts`
- Modify: `packages/web/src/inspector/PassesTab.tsx`, `packages/web/src/inspector/GeometryTab.tsx`, `packages/web/src/viewport/CamOverlays.tsx`
- Test: `packages/web/src/inspector/openChains.test.ts`

**Interfaces:**
- Consumes: `resolveGeometry`, `camContext`, `pathLength`, `pointAt` and `Operation` (core); `ProfileOp.openSide` and `DxfPathRef.reverse` (Task 6).
- Produces:
  - `contourKinds(op: Operation, ctx: CamContext): { closed: boolean; open: boolean }`
  - `openChains(op: Operation, ctx: CamContext): { ref: number; path: Path2D }[]` (open chains in their final direction; `ref` is the seed index)
  - `toggleReverse(geometry: readonly GeometryRef[], index: number): GeometryRef[]`
  - test ids:
    - `pass-open-side`, with items `left`, `on` and `right`;
    - `geo-reverse-<i>` on seed rows;
    - `open-chain-arrow` on the viewport arrow lines (as a `name`, for debugging, not for tests).

- [ ] **Step 1: Write the failing test**

`packages/web/src/inspector/openChains.test.ts`:

```ts
import { applyCommands, camContext, createJob, pathFromPoints, segmentStart, setModel, setStock } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { ModelGeometry } from '@/state/store';
import { contourKinds, openChains, toggleReverse } from './openChains';

const geometry: ModelGeometry = {
  kind: 'drawing',
  drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [
    pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], false),
    pathFromPoints([{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 15 }, { x: 0, y: 15 }], true),
  ] }] },
  rawPoints: new Float32Array([0, 0, 0, 10, 15, 0]),
};
const ref = (path: number, reverse = false) => ({ kind: 'dxfPath' as const, blobId: 'b', layer: 0, path, ...(reverse ? { reverse: true as const } : {}) });

function setup(geo: ReturnType<typeof ref>[]) {
  let job = setStock(setModel(createJob(), { sourceName: 'a.svg', blobId: 'b', kind: 'drawing', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 5 } });
  job = applyCommands(job, [
    { type: 'addOperation', opType: 'profile', toolId: null, id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: geo } },
  ]);
  return { op: job.operations[0], ctx: camContext(job, geometry) };
}

describe('open chains in the inspector', () => {
  it('knows which settings apply', () => {
    expect(contourKinds(setup([ref(0)]).op, setup([ref(0)]).ctx)).toEqual({ closed: false, open: true });
    const both = setup([ref(0), ref(1)]);
    expect(contourKinds(both.op, both.ctx)).toEqual({ closed: true, open: true });
  });

  it('lists open chains with their seed and direction, honouring reverse', () => {
    const fwd = setup([ref(0)]);
    const rev = setup([ref(0, true)]);
    const [a] = openChains(fwd.op, fwd.ctx);
    const [b] = openChains(rev.op, rev.ctx);
    expect(a.ref).toBe(0);
    expect(segmentStart(a.path.segments[0]).x).toBeLessThan(segmentStart(b.path.segments[0]).x);
  });

  it('toggles reverse on one reference', () => {
    expect(toggleReverse([ref(0), ref(1)], 0)).toEqual([ref(0, true), ref(1)]);
    expect(toggleReverse([ref(0, true)], 0)).toEqual([ref(0)]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/web test openChains`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`packages/web/src/inspector/openChains.ts`:

```ts
import { type CamContext, type GeometryRef, type Operation, type Path2D, resolveGeometry } from '@sponcam/core';

/** Whether the operation's drawing geometry has closed contours and/or open chains (decides which Side settings show). */
export function contourKinds(op: Operation, ctx: CamContext): { closed: boolean; open: boolean } {
  const contours = resolveGeometry(op, ctx).contours;
  return { closed: contours.some((c) => c.path.closed), open: contours.some((c) => !c.path.closed) };
}

/** Open chains of a profile in the direction they will be cut along (reverse applied), with their seed reference. */
export function openChains(op: Operation, ctx: CamContext): { ref: number; path: Path2D }[] {
  if (op.type !== 'profile') return [];
  return resolveGeometry(op, ctx).contours.filter((c) => !c.path.closed).map((c) => ({ ref: c.ref, path: c.path }));
}

export function toggleReverse(geometry: readonly GeometryRef[], index: number): GeometryRef[] {
  return geometry.map((g, i) => {
    if (i !== index || g.kind !== 'dxfPath') return g;
    if (g.reverse) {
      const { reverse: _, ...rest } = g;
      return rest;
    }
    return { ...g, reverse: true as const };
  });
}
```

The contours returned by `resolveGeometry` are in program coordinates. That is fine for the arrows and for the closed/open check. If a mesh-face contour sneaks into `contourKinds`, it counts as closed, which is correct.

`PassesTab.tsx`, in `ProfilePasses`:
- Compute `const kinds = useMemo(() => contourKinds(op, camContext(job, geometry)), [op, job, geometry])`, with `job` and `geometry` from `useApp`.
- Show the existing Side group only when `kinds.closed || !kinds.open`, so a profile with no geometry yet still shows Side.
- Add, when `kinds.open`:

```tsx
      {kinds.open && (
        <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Open side</span>
          <ToggleGroup
            type="single" variant="outline" size="sm" data-testid="pass-open-side" value={op.openSide}
            onValueChange={(v) => v && patch({ openSide: v as ProfileOp['openSide'] })}
          >
            <ToggleGroupItem value="left">Left</ToggleGroupItem>
            <ToggleGroupItem value="on">On</ToggleGroupItem>
            <ToggleGroupItem value="right">Right</ToggleGroupItem>
          </ToggleGroup>
        </label>
      )}
```

`GeometryTab.tsx`:
- Compute `const seeds = useMemo(() => new Set(openChains(op, camContext(job, geometry)).map((c) => c.ref)), [op, job, geometry])`.
- In each row whose index is in `seeds`, before the remove button, add:

```tsx
              {seeds.has(i) && (
                <Toggle
                  size="sm" pressed={ref.kind === 'dxfPath' && ref.reverse === true} data-testid={`geo-reverse-${i}`} title="Reverse the line's direction"
                  onPressedChange={() => setGeometry(toggleReverse(op.geometry, i))}
                >
                  <ArrowLeftRight className="size-3.5" />
                </Toggle>
              )}
```

(Import `ArrowLeftRight` from `lucide-react`. Also import `camContext` and `useMemo`.)

`CamOverlays.tsx`: add a component `OpenChainArrows({ job, geometry, op })` that, for a profile operation, takes `openChains(op, camContext(job, geometry))`. For each chain it takes the point and tangent at half its length (`pointAt(path, pathLength(path) / 2)`) and draws a 3-point arrowhead with drei's `Line` in `PICK_COLOR`:
- The tip is the midpoint plus 2 mm along the tangent.
- The two barbs are 2 mm back and 1.2 mm to each side.
- Z is the contour's Z (`0` in program coordinates for drawings).

When `op.openSide !== 'on'`, it also draws a thin dashed line (drei `Line` with `dashed`, `dashSize={1}`, `gapSize={0.6}`) of `offsetOpenPath(path, op.openSide, toolRadius, 0.05)?.path`, so the side is visible before generating. `toolRadius` is the operation's tool diameter / 2 from `job.tools`; when there is no tool it is skipped. Render `<OpenChainArrows … />` inside `CamOverlays` next to `PickedGeometry`, with `raycast={noRaycast}` as the other overlays do.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test openChains && pnpm --filter @sponcam/web typecheck && pnpm --filter @sponcam/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): Open side setting, reverse toggle and direction arrows for open lines"
```

---

### Task 11: Web — importing `tool.tbl` in the tool library dialog

**Files:**
- Modify: `packages/web/src/tools/ToolLibraryDialog.tsx`
- Create: `packages/web/src/tools/toolTableImport.ts`
- Test: `packages/web/src/tools/toolTableImport.test.ts`

**Interfaces:**
- Consumes: `importLibraryFile(file, units?)` (Task 8); `isToolTableFile` and `suggestToolTableUnits` (core).
- Produces:
  - `importSummary(r: LibraryImportResult): { title: string; description: string | undefined }`. The dialog's toast text moves here so it is unit-tested.
  - Test ids:
    - `tool-import-input`, whose `accept` becomes `.json,.tools,.tbl`;
    - `tool-table-units` (the prompt), `tool-table-units-mm` and `tool-table-units-in`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/tools/toolTableImport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { importSummary } from './toolTableImport';

describe('tool import summary', () => {
  it('counts, lists skipped lines, renumbering and guesses', () => {
    const s = importSummary({
      added: 6, updated: 1,
      skipped: [{ name: 'line 9', reason: 'no diameter (D)' }],
      notes: ['Starter 6 mm flat moved from T3 to T21', 'T2 Spiralbohrer: drill (from the comment)'],
    });
    expect(s.title).toBe('Imported 7 tools (1 updated); 1 skipped');
    expect(s.description).toBe('line 9: no diameter (D)\nStarter 6 mm flat moved from T3 to T21\nT2 Spiralbohrer: drill (from the comment)');
    expect(importSummary({ added: 1, updated: 0, skipped: [], notes: [] })).toEqual({ title: 'Imported 1 tool; 0 skipped', description: undefined });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/web test toolTableImport`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`packages/web/src/tools/toolTableImport.ts`:

```ts
import type { LibraryImportResult } from '@sponcam/core';

export function importSummary({ added, updated, skipped, notes }: LibraryImportResult): { title: string; description: string | undefined } {
  const total = added + updated;
  const updatedPart = updated > 0 ? ` (${updated} updated)` : '';
  const details = [...skipped.map((s) => `${s.name}: ${s.reason}`), ...notes];
  return {
    title: `Imported ${total} tool${total === 1 ? '' : 's'}${updatedPart}; ${skipped.length} skipped`,
    description: details.length ? details.join('\n') : undefined,
  };
}
```

`ToolLibraryDialog.tsx`:
- `handleImport(file)` uses `importSummary` for its toast.
- The file input's `accept` becomes `.json,.tools,.tbl`.
- When the chosen file `isToolTableFile(file.name)`, it reads the text first (`await file.text()`) and keeps `{ file, suggested: suggestToolTableUnits(text) }` in a `pendingTable` state, then shows a small inline prompt (`data-testid="tool-table-units"`): "Units of {file.name}: [Millimetres] [Inches]". The suggested option shows `(suggested)` and uses the primary variant. Choosing calls `handleImport(file, unit)`, which passes `units` to `importLibraryFile(file, units)`. A Cancel button clears `pendingTable`.

Follow the dialog's existing button and layout classes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test toolTableImport && pnpm --filter @sponcam/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/tools
git commit -m "feat(web): import LinuxCNC tool.tbl files into the tool library"
```

---

### Task 12: End-to-end tests, docs and verification

**Files:**
- Create: `packages/web/e2e/inputs.spec.ts`
- Modify: `.claude/skills/spon-dev/SKILL.md` (supported import formats), `packages/mcp/README.md` (if Task 8 missed anything)

- [ ] **Step 1: Write the Playwright test**

`packages/web/e2e/inputs.spec.ts`. Follow `e2e/cam.spec.ts`: the same `beforeEach` that disables the File System Access pickers, and `openFixture` through `open-input`.

```ts
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

const open = (page: Page, rel: string) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, rel));

test('Inkscape SVG opens without a prompt; an open line profiles on its right with a direction arrow', async ({ page }) => {
  await open(page, 'svg/inkscape.svg');
  await expect(page.getByTestId('svg-scale-dialog')).toHaveCount(0);
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-profile').click();
  await page.getByTestId('catalog-contour-Engrave-0').click();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-open-side').getByText('Right').click();
  await expect(page.locator('[data-testid^="op-row-"]').last()).toHaveAttribute('data-status', /ok|warning/);
  await page.getByTestId('inspector-tab-geometry').click();
  await expect(page.getByTestId('geo-reverse-0')).toBeVisible();
});

test('a px SVG asks for its scale and shows the resulting size', async ({ page }) => {
  await open(page, 'svg/illustrator.svg');
  const dialog = page.getByTestId('svg-scale-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('svg-scale-72')).toContainText('44.45 × 19.05 mm');
  await page.getByTestId('svg-scale-72').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('catalog-list')).toContainText('#ff0000');
});

test('a LinuxCNC tool.tbl imports in inches with its T numbers', async ({ page }) => {
  await page.getByTestId('open-tool-library').click();
  await page.getByTestId('tool-import-input').setInputFiles(path.join(FIXTURES, 'tool.tbl'));
  await expect(page.getByTestId('tool-table-units')).toBeVisible();
  await page.getByTestId('tool-table-units-in').click();
  await expect(page.getByText(/Imported 7 tools/)).toBeVisible();
  await expect(page.getByTestId('library-tool-linuxcnc-T2')).toContainText('Spiralbohrer 1/8');
});
```

`open-tool-library` and `library-tool-<id>` are the dialog's existing test ids. The 72 dpi size text follows from the fixture (126 × 54 px → 44.45 × 19.05 mm). Match `formatLength`'s rounding if it prints fewer decimals.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @sponcam/web exec playwright test inputs`
Expected: PASS (3 tests).

- [ ] **Step 3: Docs**

In `.claude/skills/spon-dev/SKILL.md`, where import formats or fixtures are mentioned, add SVG (`core/test/fixtures/svg/`) and `tool.tbl`.

- [ ] **Step 4: Full verification**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (core, web, mcp).
Run: `pnpm build`
Expected: PASS.
Run: `pnpm e2e`
Expected: PASS (all specs, including `inputs.spec.ts` and `live.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/web/e2e/inputs.spec.ts .claude/skills/spon-dev/SKILL.md packages/mcp/README.md
git commit -m "test(e2e): SVG import, open-line side and tool.tbl import; docs"
```
