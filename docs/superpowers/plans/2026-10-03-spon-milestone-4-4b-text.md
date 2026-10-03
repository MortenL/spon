# Spon Milestone 4.4b — Text in Spon: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text typed in Spon. Each text is an editable job item, laid out in a bundled or uploaded font, placed on the stock top or on a model face. Operations pick it as geometry: outline text for profile, pocket, engrave and V-carve; single-line text for engrave.

**Architecture:**
- **Job model:** `Job.texts: TextItem[]` (schema 6). Fonts are bundled modules or uploaded blobs.
- **Fonts:** an async `FontStore` parses the fonts a job needs, with opentype.js for outline fonts and a Hershey adapter for single-line fonts. It is then read synchronously through `FontSet` during generation.
- **Layout:** `layoutText` turns a `TextItem` and a `LoadedFont` into shapes (unioned outlines) or strokes, in stock coordinates. A `{ kind: 'text' }` geometry reference resolves to them at the text's surface Z, so the existing toolpath code is unchanged.
- **Pipeline:** `runPipeline` takes a `FontSet` and returns per-text summaries (diagnostics and outlines), which the web app draws and drags.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn, zustand, Comlink worker, three.js / react-three-fiber, MCP SDK + zod, Playwright 1.63, clipper2-ts.
- **New runtime dependency:** `opentype.js` (MIT) in `@sponcam/core`.
- **New dev dependencies (font sources):** `@fontsource/inter` (OFL 1.1) and `@fontsource/roboto-slab` (Apache 2.0) in `@sponcam/core`.

**Spec:** `docs/superpowers/specs/2026-10-03-text-design.md`. Read it with this plan; the spec is the authority.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs. Font data reaches core as bytes; bundled fonts are TypeScript modules loaded with dynamic `import()`.
- Dependencies: `opentype.js` (MIT) runtime in core; `@fontsource/inter`, `@fontsource/roboto-slab` dev only in core. Hershey data is committed with its original notice. No GPL anywhere — if a font or data source turns out to be GPL, stop and report BLOCKED.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()` / `dispatch` / `dispatchBatch`.
- `CURRENT_SCHEMA_VERSION` becomes 6 (migration 5→6 adds `texts: []`). Existing golden G-code tests pass unchanged.
- Fixed messages (verbatim; `{name}` = the text item's name, `{font}` = the font's display name, `{chars}` = missing characters joined with no separator):
  - `This font file can't be read` (error, `font-unreadable`; also thrown by `parseFontFile`)
  - `WOFF2 fonts are not supported; use TTF, OTF or WOFF` (thrown by `parseFontFile`)
  - `The font file for {name} is missing` (error, `font-missing`)
  - `{name} has no text` (error, `text-empty`)
  - `{font} has no glyph for: {chars}` (warning, `text-missing-glyphs`)
  - `{name} doesn't fit its box` (error, `text-fit`)
  - `The arc radius of {name} is smaller than its text` (error, `text-arc`)
  - `Text without a model needs a fixed stock size` (error, `text-no-stock`)
  - `{name} uses a single-line font; this operation needs closed outlines` (error, `text-single-line`)
  - Existing `ref-missing` text for a deleted text: `The picked text no longer exists`; existing `ref-changed` for a text's face that no longer resolves (reuse the face resolver's message).
- Bundled font ids, families and kinds (spec §3.1): `sans` Inter Regular, `sansBold` Inter Bold, `serif` Roboto Slab Regular (outline); `hersheySans` Hershey Simplex, `hersheyDuplex` Hershey Duplex, `hersheyScript` Hershey Script Simplex (single-line).
- Defaults for a new text: `text: 'Text'`, `font: { kind: 'bundled', id: 'sans' }`, `size: 10`, `letterSpacing: 0`, `lineSpacing: 1.6`, `align: 'center'`, `fit: null`, `anchor: 'center'`, `position` = stock XY centre (or `{x: 0, y: 0}` with no stock), `angle: 0`, `mirror: false`, `arc: null`, `surface: { from: 'stockTop' }`, `name: 'Text <n>'`.
- Web test ids (spec §7): `rail-text`, `text-add`, `text-content`, `text-font`, `text-size`, `text-letter-spacing`, `text-line-spacing`, `text-align`, `text-fit-on`, `text-fit-width`, `text-fit-height`, `text-x`, `text-y`, `text-anchor-<anchor>`, `text-angle`, `text-mirror`, `text-arc-on`, `text-arc-radius`, `text-arc-side`, `text-surface`, `text-pick-face`, `text-centre-stock`, `text-centre-face`. Rows: `text-row-<id>`.
- Playwright uses ports 5199 (dev) and 5198 (preview). Never touch port 5173; never bind 5197.
- Root `README.md` updated in this branch: Features (text with fonts), Status and roadmap (4.4b done, 4.4c V-carve inlays next, then 4.5, 4.6). `THIRD_PARTY_NOTICES.md` lists opentype.js, Inter, Roboto Slab and the Hershey fonts.
- Commits: plain new commits on `milestone-4-4b-text`, each ending with your own `Co-Authored-By` trailer. Never push, rewrite history, stash, reset, rebase, amend or check out other refs.

## Clarifications to the spec (binding for this plan)

1. **Bundled outline font files** come from the `@fontsource` packages' Latin-subset WOFF files instead of hand-subset TTFs:
   - `@fontsource/inter/files/inter-latin-400-normal.woff` → `sans`
   - `@fontsource/inter/files/inter-latin-700-normal.woff` → `sansBold`
   - `@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff` → `serif`
   
   That subset already covers spec §3.1's character list; a test checks every listed character has a glyph. `scripts/build-fonts.mjs` writes `src/text/bundled/<id>.ts` (`export default '<base64>'`), which is committed. If a file name differs in the installed version, use the matching Latin 400/700 WOFF file and note it in the report.
2. **Hershey data:**
   - **Files:** the original `.jhf` files `rowmans.jhf` (Simplex), `rowmand.jhf` (Duplex) and `scripts.jhf` (Script Simplex), committed under `packages/core/assets/hershey/` with the Hershey distribution notice in `packages/core/assets/hershey/NOTICE`.
   - **Source:** they may be taken from any distribution that carries them under the original Hershey notice (for example the `hershey-fonts/` data directory of kamalmostafa/hershey-fonts). The data directory carries the Hershey notice even though that project's C library is GPL; do not copy any of its code.
   - **Licence check:** verify the notice text before committing. If the only available copy is under GPL terms, stop and report BLOCKED.
   - **Generated tables:** `build-fonts.mjs` turns them into `src/text/bundled/<id>.ts` stroke tables (`export default` a JSON-compatible object).
3. **Uploaded-font test fixture:** instead of a committed `.ttf`, tests build a small font in code with opentype.js (`new opentype.Font({...}).toArrayBuffer()`) and load those bytes. This avoids a binary fixture and gives exact glyph geometry.
4. **Fit with an arc:** `fit` limits the straight layout (ink width and ink height of the block) before arc placement.
5. **Texts are only drawn after a generate:** the web app draws texts from the pipeline result (`CamRun.texts`). Generation already runs after every job change.
6. **Live MCP mode:** `load_font` follows whatever the live bridge does for model import. If importing a model is not available live, `load_font` is refused live with `Load fonts in the Spon window while connected live`. The other text tools are plain job commands and work in both modes.

## Review Focus

1. **Characters outside the font** (emoji, CJK, `\t`) are skipped with the warning and never crash or emit NaN. → Task 3 test (missing glyphs incl. emoji and tab).
2. **Degenerate numbers from the UI or MCP** (size 0, negative fit, NaN angle, radius 0, empty lines between text lines) are refused by commands or give a diagnostic; never NaN coordinates. → Task 1 validation test; Task 3 test (blank lines, whitespace-only text = `text-empty`).
3. **A font blob that goes missing** (job saved by hand, MCP blob removed), then reappears: the diagnostic is `font-missing`, and once the bytes are back the next generate clears it. The cache must not keep the stale error. → Task 4 test (font status in the operation key).
4. **Text far outside the stock or partly off a face.** It is still laid out and cut where it is (the existing gouge and stock checks apply); no crash. → Task 4 test (text off the stock edge generates without error).
5. **Large text** (a 200-character, 3-line paragraph in the bold sans) stays responsive: layout under 300 ms in the core test, cached afterwards. → Task 3 performance test.

---

## File map

**Core: new**
- `src/text/types.ts`, `src/text/fonts.ts`, `src/text/hershey.ts`, `src/text/layout.ts`, `src/text/resolve.ts`, `src/text/bundled/*.ts` (generated, committed)
- `scripts/build-fonts.mjs`, `assets/hershey/*.jhf`, `assets/hershey/NOTICE`
- Tests: `test/text-model.test.ts`, `test/text-fonts.test.ts`, `test/text-layout.test.ts`, `test/text-resolve.test.ts`, `test/fixtures/testFont.ts`

**Core: changed**
- `src/job/types.ts`, `src/job/commands.ts`, `src/job/defaults.ts` (or wherever `createJob` lives), `src/io/migrations.ts`, `src/io/spon.ts`
- `src/cam/types.ts`, `src/cam/context.ts`, `src/cam/features/resolve.ts`, `src/cam/generate.ts`, `src/pipeline/run.ts`, `src/index.ts`, `package.json`

**MCP:** `src/schemas.ts`, `src/instructions.ts`, `src/fileSession.ts`, `src/tools/edit.ts` (or a new `src/tools/text.ts` registered next to it), `README.md`; tests.

**Web:**
- `state/store.ts`, `state/documents.ts`, `state/autosave.ts`, `state/programs.ts` (blob pruning), `state/cam.ts`, `workers/import.worker.ts`
- `layout/railPanels.ts`, `layout/railStore.ts` (`PanelId`), `layout/setupStatus.ts`
- `panels/TextPanel.tsx`, `panels/TextRow.tsx`, `inspector/TextInspector.tsx`, `inspector/Inspector.tsx`, `inspector/GeometryTab.tsx`, `inspector/geometryLabels.ts`
- `viewport/TextObjects.tsx`, `viewport/Viewport.tsx`
- `e2e/text.spec.ts`

**Docs:** `README.md`, `THIRD_PARTY_NOTICES.md`, `.claude/skills/spon-dev/SKILL.md`.

---

### Task 1: Job model: texts, commands, schema 6 and font blobs

**Files:**
- Create: `packages/core/src/text/types.ts`, `packages/core/test/text-model.test.ts`
- Modify: `packages/core/src/job/types.ts`, `src/job/commands.ts`, `createJob` (find it with `grep -rn "export function createJob" packages/core/src`), `src/io/migrations.ts`, `src/io/spon.ts`, `src/index.ts`
- Modify (compile fixes only): any web or MCP code that builds a `Job` literal, and the MCP command schema (`packages/mcp/src/schemas.ts`), which has a type-equality test against `JobCommand`.

**Interfaces (produces):**
```ts
// src/text/types.ts
import type { Vec2 } from '../geometry/path2d';
import type { MeshFaceRef } from '../cam/types';
export type BundledFontId = 'sans' | 'sansBold' | 'serif' | 'hersheySans' | 'hersheyDuplex' | 'hersheyScript';
export type FontRef = { kind: 'bundled'; id: BundledFontId } | { kind: 'file'; blobId: string; name: string };
export interface TextArc { radius: number; side: 'outside' | 'inside' }
export type TextSurface = { from: 'stockTop' } | { from: 'face'; face: MeshFaceRef };
export type TextAnchor = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';
export const TEXT_ANCHORS: readonly TextAnchor[];
export interface TextItem {
  id: string; name: string; text: string; font: FontRef;
  size: number; letterSpacing: number; lineSpacing: number; align: 'left' | 'center' | 'right';
  fit: { width: number; height: number | null } | null;
  position: Vec2; anchor: TextAnchor; angle: number; mirror: boolean;
  arc: TextArc | null; surface: TextSurface;
}
export type TextPatch = Partial<Omit<TextItem, 'id'>>;
export function newTextItem(id: string, name: string, position: Vec2): TextItem;   // the Global Constraints defaults
export const fontBlobPath = (blobId: string, name: string): string;              // `fonts/${blobId}.${ext}`, ext from name: ttf | otf | woff (lower-case)

// Job (job/types.ts): schemaVersion: 6; texts: TextItem[]
// JobCommand gains:
//   | { type: 'addText'; id?: string; patch?: TextPatch }
//   | { type: 'updateText'; id: string; patch: TextPatch }
//   | { type: 'removeText'; id: string }
//   | { type: 'moveText'; id: string; delta: -1 | 1 }
```

- [ ] **Step 1: Write the failing tests** (`text-model.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, applyCommands, createJob, CURRENT_SCHEMA_VERSION, migrateJob, readSpon, setStock, writeSpon } from '../src';

const fixed = () => setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } });

describe('texts in the job', () => {
  it('starts empty and migrates schema 5 jobs', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(6);
    expect(createJob().texts).toEqual([]);
    const v5 = { ...createJob(), schemaVersion: 5 } as Record<string, unknown>;
    delete v5.texts;
    expect(migrateJob(v5).texts).toEqual([]);
  });

  it('adds a text with defaults, centred on a fixed stock', () => {
    const job = applyCommand(fixed(), { type: 'addText', id: 't1' });
    expect(job.texts[0]).toEqual({
      id: 't1', name: 'Text 1', text: 'Text', font: { kind: 'bundled', id: 'sans' }, size: 10, letterSpacing: 0, lineSpacing: 1.6,
      align: 'center', fit: null, position: { x: 100, y: 50 }, anchor: 'center', angle: 0, mirror: false, arc: null, surface: { from: 'stockTop' },
    });
    expect(applyCommand(job, { type: 'addText' }).texts[1].name).toBe('Text 2');
  });

  it('updates, reorders and removes texts', () => {
    let job = applyCommands(fixed(), [{ type: 'addText', id: 'a' }, { type: 'addText', id: 'b' }]);
    job = applyCommand(job, { type: 'updateText', id: 'a', patch: { text: 'SPON\nSIGN', size: 25, arc: { radius: 60, side: 'outside' }, fit: { width: 150, height: null } } });
    expect(job.texts[0]).toMatchObject({ text: 'SPON\nSIGN', size: 25, arc: { radius: 60, side: 'outside' } });
    job = applyCommand(job, { type: 'moveText', id: 'b', delta: -1 });
    expect(job.texts.map((t) => t.id)).toEqual(['b', 'a']);
    job = applyCommand(job, { type: 'removeText', id: 'b' });
    expect(job.texts.map((t) => t.id)).toEqual(['a']);
  });

  it('refuses bad values', () => {
    const job = applyCommand(fixed(), { type: 'addText', id: 'a' });
    const bad = (patch: object) => () => applyCommand(job, { type: 'updateText', id: 'a', patch: patch as never });
    expect(bad({ size: 0 })).toThrow('size must be greater than 0');
    expect(bad({ lineSpacing: -1 })).toThrow('lineSpacing must be greater than 0');
    expect(bad({ fit: { width: 0, height: null } })).toThrow('fit.width must be greater than 0');
    expect(bad({ fit: { width: 10, height: 0 } })).toThrow('fit.height must be greater than 0');
    expect(bad({ arc: { radius: 0, side: 'outside' } })).toThrow('arc.radius must be greater than 0');
    expect(bad({ angle: Number.NaN })).toThrow('angle must be a finite number');
    expect(bad({ letterSpacing: Infinity })).toThrow('letterSpacing must be a finite number');
    expect(bad({ align: 'justify' })).toThrow('align must be one of left, center, right');
    expect(bad({ anchor: 'middle' })).toThrow('anchor must be one of');
    expect(bad({ id: 'x' })).toThrow('"id" cannot be changed');
    expect(() => applyCommand(job, { type: 'updateText', id: 'nope', patch: {} })).toThrow('No text with id nope');
    expect(() => applyCommand(job, { type: 'addText', id: 'a' })).toThrow('A text with id a already exists');
  });

  it('stores uploaded font blobs in .spon files and drops unused ones', () => {
    let job = applyCommands(fixed(), [{ type: 'addText', id: 'a' }]);
    job = applyCommand(job, { type: 'updateText', id: 'a', patch: { font: { kind: 'file', blobId: 'f1', name: 'Sign.TTF' } } });
    const bytes = writeSpon(job, { f1: new Uint8Array([1, 2, 3]), unused: new Uint8Array([9]) });
    const back = readSpon(bytes);
    expect(back.job.texts[0].font).toEqual({ kind: 'file', blobId: 'f1', name: 'Sign.TTF' });
    expect(back.blobs.f1).toEqual(new Uint8Array([1, 2, 3]));
    expect(back.blobs.unused).toBeUndefined();
  });
});
```

Adapt the exact error texts to the command module's existing phrasing (see how `patchOperation` words "must be greater than 0", "must be one of" and "does not apply"), keeping each assertion's intent. If `writeSpon` throws on a referenced blob that is missing (as it may for programs), keep that behaviour for fonts too.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core test text-model`. Expected: FAIL.

- [ ] **Step 3: Implement**
- **`text/types.ts`:** as in Interfaces.
  - `newTextItem` returns the defaults.
  - `fontBlobPath` lower-cases the extension of `name`; unknown extensions → `ttf`.
- **`job/types.ts`:** `schemaVersion: 6`, `texts: TextItem[]` (after `operations`).
- **`createJob`:** add `texts: []`.
- **`migrations.ts`:**
  - `CURRENT_SCHEMA_VERSION = 6`;
  - add `5: (job) => ({ ...job, texts: [] })` with comment `// v5 → v6 (Milestone 4.4b): texts`;
  - `assertJobShape` also requires `Array.isArray(job.texts)`.
- **`commands.ts`:** the four commands.
  - **`addText`:**
    - **id:** `c.id ?? crypto.randomUUID()`; refuse duplicates.
    - **name:** `Text <n>`, where `n` = number of existing texts + 1.
    - **position:** the stock XY centre in stock coordinates. With a fixed stock that is `size.x / 2, size.y / 2`. With an auto stock and a model, it is half the auto stock box size: compute it from the existing `stockBox` if the placement is available. Commands have no geometry, so use `{x: 0, y: 0}` and let the web app's "Centre on stock" button fix it. Without any stock it is `{x: 0, y: 0}`.
    - Then apply `c.patch` through the same validation as `updateText`.
  - **`updateText`:** validate every key of the patch.
    - **Known keys:** those of `TextItem` except `id`. `id` → `"id" cannot be changed`; anything else → `"<key>" is not a text setting`.
    - **Positive numbers:** `size` and `lineSpacing`.
    - **Finite numbers:** `letterSpacing` and `angle`, plus `position.x` and `position.y`.
    - **Enums:** `align`, `anchor`, `arc.side`, and `surface.from` (`stockTop` | `face`; `face` requires a `face` object).
    - **`fit`:** null, or an object whose `width` is greater than 0 and whose `height` is null or greater than 0.
    - **`arc`:** null, or an object whose `radius` is greater than 0.
    - **`font`:** `bundled` with a known id, or `file` with string `blobId` and `name`.
    - **`text`** is a string; `name` is a non-empty string; `mirror` is a boolean.
    - **Errors:** throw `CommandError` with texts like the tests'.
  - **`removeText`, `moveText`:** mirror `removeOperation` and `moveOperation`. Unknown id → `No text with id <id>`.
- **`spon.ts`:**
  - `blobIds(job)` and `blobPaths(job)` add the font blobs of `job.texts` (deduplicated, `font.kind === 'file'`), using `fontBlobPath`.
  - `readSpon` reads `fonts/` entries back by the same mapping (follow how programs are read).
- **`index.ts`:** export `src/text/types.ts`.
- **MCP compile fix:** the `JobCommand` schema in `schemas.ts` gains the four commands, with a `textPatch` zod schema mirroring `TextPatch` (`strictObject`, all keys optional; `face` uses the existing `meshFaceRef`). Keep the existing type-equality test passing.
- **Web compile fix:** wherever a `Job` literal or `schemaVersion: 5` appears outside tests, update it.

- [ ] **Step 4: Verify.** Run `pnpm --filter @sponcam/core test text-model`, then from the root `pnpm typecheck && pnpm test`. Expected: PASS, with goldens unchanged.

- [ ] **Step 5: Commit.** `feat(core): texts in the job, text commands and schema 6`

---

### Task 2: Fonts: bundled data, opentype.js and Hershey adapters, FontStore

**Files:**
- Create: `packages/core/scripts/build-fonts.mjs`, `packages/core/assets/hershey/{rowmans,rowmand,scripts}.jhf`, `packages/core/assets/hershey/NOTICE`, `packages/core/src/text/bundled/{sans,sansBold,serif,hersheySans,hersheyDuplex,hersheyScript}.ts` (generated), `packages/core/src/text/fonts.ts`, `packages/core/src/text/hershey.ts`, `packages/core/test/fixtures/testFont.ts`, `packages/core/test/text-fonts.test.ts`
- Modify: `packages/core/package.json` (`opentype.js` dependency, `@fontsource/inter` and `@fontsource/roboto-slab` devDependencies, script `"build:fonts": "node scripts/build-fonts.mjs"`), `src/index.ts`
- If `opentype.js` has no bundled types, add `@types/opentype.js` as a devDependency (MIT).

**Interfaces (produces):**
```ts
// src/text/fonts.ts
import type { Vec2 } from '../geometry/path2d';
export interface GlyphData {
  advance: number;            // font units
  loops: Vec2[][];            // closed outlines, flattened, font units, y up (outline fonts)
  strokes: Vec2[][];          // open polylines, font units, y up (single-line fonts)
}
export interface LoadedFont {
  kind: 'outline' | 'singleLine';
  name: string;               // display name: family (bundled) or file name (uploaded)
  unitsPerEm: number;
  capHeight: number;          // font units
  /** null when the font has no glyph for `ch` (a single UTF-16 code point string). `tol` is the flattening tolerance in font units. */
  glyph(ch: string, tol: number): GlyphData | null;
  kerning(a: string, b: string): number;   // font units
}
export const BUNDLED_FONTS: readonly { id: BundledFontId; family: string; kind: 'outline' | 'singleLine' }[];
export class FontFileError extends Error {}
/** Parses an uploaded font; throws FontFileError('WOFF2 fonts are not supported; use TTF, OTF or WOFF') or FontFileError("This font file can't be read"). */
export function parseFontFile(bytes: Uint8Array, fileName: string): LoadedFont;
export function loadBundledFont(id: BundledFontId): Promise<LoadedFont>;
export type FontStatus = 'ok' | 'missing' | 'unreadable';
export interface FontSet {
  get(ref: FontRef): LoadedFont | null;
  status(ref: FontRef): FontStatus;   // 'missing' until loaded or when the blob is absent
}
export const EMPTY_FONTS: FontSet;     // get → null, status → 'missing'
export class FontStore implements FontSet {
  /** Loads every font the job's texts reference (bundled modules and blobs from `blobs`); idempotent and cached by font key. */
  ensure(job: Job, blobs: Readonly<Record<string, Uint8Array>>): Promise<void>;
  get(ref: FontRef): LoadedFont | null;
  status(ref: FontRef): FontStatus;
}
export const fontKey = (ref: FontRef): string; // 'bundled:<id>' | 'file:<blobId>'

// src/text/hershey.ts
export interface HersheyTable { glyphs: Record<string, { left: number; right: number; strokes: [number, number][][] }> }  // Hershey units, y DOWN as in the source
export function parseJhf(text: string): HersheyTable;    // used by build-fonts.mjs (import from the compiled path or duplicate the parser there; keep one tested copy in hershey.ts and have the script import it via a tiny JS shim if TS import is awkward)
export function hersheyFont(name: string, table: HersheyTable): LoadedFont;
```

Hershey format (`.jhf`):
- **Records:** one glyph per record. Columns 0–4 hold the glyph number, columns 5–7 the vertex count (counting the bearing pair), and pairs of characters follow. A record may continue over several physical lines: concatenate until `2 × count` characters after column 8 are read.
- **Coordinates:** each value is `charCode − 'R'.charCodeAt(0)`. The first pair is `(left, right)`. The pair `" R"` (space, R) lifts the pen.
- **Characters:** in the three files, record *k* (0-based) is the ASCII character `32 + k` for the 95 printable characters.
- **Font units and axes:** the font is y-down. Use `unitsPerEm = 32`, convert to y-up, and put the baseline at `y = 9` (the standard Roman baseline), so `yUp = 9 − y`. `capHeight` is the height of `H`'s strokes (21 for Roman Simplex). `advance = right − left`, and glyph x is shifted by `−left`. Kerning is 0.

- [ ] **Step 1: Get the font sources.**
  - Run `pnpm --filter @sponcam/core add opentype.js` and `pnpm --filter @sponcam/core add -D @fontsource/inter @fontsource/roboto-slab`.
  - Fetch the three `.jhf` files and their notice (see Clarification 2), and commit them under `assets/hershey/`.
  - Record the exact source URL of the Hershey files in `NOTICE`.

- [ ] **Step 2: Write the failing tests** (`test/fixtures/testFont.ts` and `text-fonts.test.ts`)

```ts
// test/fixtures/testFont.ts — a 1000-unit font: 'H' is a 600×700 box, 'O' a 600×700 box with a 200×300 counter, 'A' and 'V' with kerning −100
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
  // kerning A-V = -100: if opentype.js cannot write a kern table, set font.kerningPairs = { '3,4': -100 } after parsing in the test instead and say so in the report
  return new Uint8Array(font.toArrayBuffer());
}
```

```ts
// text-fonts.test.ts
import { describe, expect, it } from 'vitest';
import { applyCommands, BUNDLED_FONTS, createJob, FontFileError, FontStore, loadBundledFont, parseFontFile } from '../src';
import { testFontBytes } from './fixtures/testFont';

describe('fonts', () => {
  it('parses an uploaded font and reads glyphs in font units, y up', () => {
    const f = parseFontFile(testFontBytes(), 'TestSans.otf');
    expect(f).toMatchObject({ kind: 'outline', name: 'TestSans.otf', unitsPerEm: 1000, capHeight: 700 });
    const o = f.glyph('O', 1)!;
    expect(o.advance).toBe(700);
    expect(o.loops).toHaveLength(2);
    const ys = o.loops[0].map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(700, 6);
    expect(f.glyph('Z', 1)).toBeNull();
  });

  it('refuses woff2 and unreadable bytes', () => {
    expect(() => parseFontFile(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]), 'x.woff2')).toThrow('WOFF2 fonts are not supported; use TTF, OTF or WOFF');
    expect(() => parseFontFile(new Uint8Array([1, 2, 3, 4, 5]), 'x.ttf')).toThrow(FontFileError);
    expect(() => parseFontFile(new Uint8Array([1, 2, 3, 4, 5]), 'x.ttf')).toThrow("This font file can't be read");
  });

  it('loads every bundled font, with the spec character set in the outline fonts', async () => {
    for (const { id, kind } of BUNDLED_FONTS) {
      const f = await loadBundledFont(id);
      expect(f.kind).toBe(kind);
      expect(f.capHeight).toBeGreaterThan(0);
      expect(f.glyph('H', 1)).not.toBeNull();
    }
    const sans = await loadBundledFont('sans');
    const missing = [...'AZaz09°±Ø×–—‘’“”•€ÆÅØæåø'].filter((ch) => !sans.glyph(ch, 1));
    expect(missing).toEqual([]);
    const curve = sans.glyph('O', 0.5)!;
    expect(curve.loops).toHaveLength(2);
  });

  it('reads Hershey strokes as open polylines', async () => {
    const h = await loadBundledFont('hersheySans');
    expect(h).toMatchObject({ kind: 'singleLine', unitsPerEm: 32 });
    expect(h.capHeight).toBe(21);
    const g = h.glyph('H', 0.1)!;
    expect(g.loops).toEqual([]);
    expect(g.strokes).toHaveLength(3); // two verticals and the bar
    expect(Math.max(...g.strokes.flat().map((p) => p.y))).toBeCloseTo(21, 6);
    expect(h.glyph('é', 0.1)).toBeNull();
  });

  it('FontStore loads what a job needs and reports missing blobs', async () => {
    const job = applyCommands(createJob(), [
      { type: 'addText', id: 'a', patch: { font: { kind: 'file', blobId: 'f1', name: 'T.otf' } } },
      { type: 'addText', id: 'b', patch: { font: { kind: 'file', blobId: 'gone', name: 'G.ttf' } } },
      { type: 'addText', id: 'c', patch: { font: { kind: 'file', blobId: 'bad', name: 'B.ttf' } } },
      { type: 'addText', id: 'd' },
    ]);
    const store = new FontStore();
    await store.ensure(job, { f1: testFontBytes(), bad: new Uint8Array([1, 2, 3]) });
    expect(store.status(job.texts[0].font)).toBe('ok');
    expect(store.status(job.texts[1].font)).toBe('missing');
    expect(store.status(job.texts[2].font)).toBe('unreadable');
    expect(store.get(job.texts[3].font)?.name).toBe('Inter');
    await store.ensure(job, { f1: testFontBytes(), gone: testFontBytes(), bad: new Uint8Array([1, 2, 3]) });
    expect(store.status(job.texts[1].font)).toBe('ok');
  });
});
```

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @sponcam/core test text-fonts`. Expected: FAIL (missing exports).

- [ ] **Step 4: Implement**
- **`hershey.ts`:** `parseJhf` follows the format above, and `hersheyFont` wraps a table as a `LoadedFont`. A stroke with one point becomes a 2-point stroke of zero length, so dots survive. Drop zero-length strokes only if both points coincide *and* the glyph has other strokes.
- **`scripts/build-fonts.mjs`** (Node, run once; its outputs are committed):
  - read the three WOFF files from `node_modules/@fontsource/...` and write `src/text/bundled/sans.ts`, `sansBold.ts` and `serif.ts`, each `// generated by scripts/build-fonts.mjs — do not edit\nexport default '<base64>';`;
  - parse the three `.jhf` files with the same algorithm as `parseJhf`, and write `hersheySans.ts`, `hersheyDuplex.ts` and `hersheyScript.ts` as `export default <JSON> as const;`. A small duplicated parser in the script is fine; the TS one is the tested one, and a test compares their outputs for `H`;
  - run it and commit the outputs.
- **`fonts.ts`:**
  - **`parseFontFile`:** a `wOF2` signature or a `.woff2` name → the WOFF2 error. Otherwise `opentype.parse(bytes.buffer slice)` inside try/catch → the unreadable error. Also refuse a font with no glyphs or a `unitsPerEm` ≤ 0.
  - **`capHeight`:** `tables.os2.sCapHeight` if > 0, else the `H` glyph's yMax, else `0.7 × unitsPerEm`.
  - **`glyph(ch, tol)`:** `font.charToGlyph(ch)`. Index 0 (`.notdef`) → null. Flatten the path commands with `tol` (font units), with no y flip: opentype.js paths from `glyph.path` are y-up. Quadratic and cubic Béziers are subdivided until flat within `tol`; reuse a flattening helper from `geometry/` if one exists. Each `Z` closes a loop; drop loops with fewer than 3 points. Cache results per `(ch, tol)`.
  - **`kerning`:** `font.getKerningValue(glyphA, glyphB)`.
  - **`loadBundledFont`:** a `switch` with `await import('./bundled/sans')` and so on (literal paths, so bundlers can split them). Decode base64 without Node: use `atob` (present in browsers, workers and Node ≥ 16). Cache the promise per id.
  - **Display names:** `Inter`, `Inter Bold`, `Roboto Slab`, `Hershey Sans`, `Hershey Duplex`, `Hershey Script`.
  - **`FontStore`:** a map from `fontKey` to `LoadedFont | 'unreadable'`.
    - `ensure` loads bundled fonts, and each `file` font whose key is not yet loaded and whose blob is in `blobs`.
    - It does not cache absence, so a later `ensure` with the blob present loads it.
    - `status`: `'ok'` if loaded, `'unreadable'` if parsing failed, otherwise `'missing'`.
- **`index.ts`:** export `fonts.ts` and `hershey.ts`.

- [ ] **Step 5: Verify.** Run `pnpm --filter @sponcam/core test text-fonts`, then `pnpm typecheck && pnpm test`. Also run `pnpm build` once, and confirm in the report that the web bundle puts the bundled fonts in separate chunks (list the chunk sizes).

- [ ] **Step 6: Commit.** `feat(core): bundled and uploaded fonts (opentype.js, Hershey)`, plus `THIRD_PARTY_NOTICES.md` entries for opentype.js (MIT), Inter (OFL 1.1), Roboto Slab (Apache 2.0) and the Hershey fonts (the notice text). Add the licence texts or links in the same style as the existing entries.

---

### Task 3: Layout

**Files:**
- Create: `packages/core/src/text/layout.ts`, `packages/core/test/text-layout.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `TextItem` (Task 1), `LoadedFont`, `GlyphData` (Task 2); `polysToRegions`, `Poly` from `geometry/offset/clipper.ts`; `pathFromPoints` from `geometry/offset/pathOps.ts`; `Shape` from `cam/features/chain.ts` (outer CCW, islands CW).
- Produces:
```ts
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
/** Lays out `item` in `font`; coordinates are stock coordinates (mm). `tol` is the job tolerance (mm). Cached per (item JSON, font identity, tol). */
export function layoutText(item: TextItem, font: LoadedFont, tol: number): TextLayout;
```

**Algorithm** (spec §4, with Clarification 4):
1. **Empty text:** if `item.text.trim() === ''` → `error: 'text-empty'` with no geometry.
2. **Scale:** `k = size / font.capHeight`. Glyphs are flattened at `tol / k` font units, but never below `0.001 / k`.
3. **Lines:** for each `\n`-separated line, walk its code points (`[...line]`).
   - **Missing characters:** `\t` and any character with no glyph are recorded in `missing`, unique and in order, and take no space. A space without a glyph uses an advance of `0.25 × unitsPerEm`.
   - **Pen:** `x += (advance + kerning(prev, ch)) · k + letterSpacing` after each glyph. Kerning counts only between adjacent drawn glyphs.
   - **Line width:** the pen x after the last glyph minus the trailing `letterSpacing`.
4. **Stacking and alignment:** baseline `yᵢ = −i · lineSpacing · size`. A line's x-shift is `0` for left, `(W − wᵢ)/2` for centre and `W − wᵢ` for right, where `W` is the widest line. Blank lines take their vertical slot.
5. **Fit:** measure the ink width `W` and the ink height `H` of the straight block (spec §4.4: from the ink bounds). The scale is `s = min(1, fit.width / W, fit.height ? fit.height / H : 1)`. Scale every coordinate, the spacings and letter spacing included, by `s`. If `size · s < 1` → `error: 'text-fit'`, with no geometry.
6. **Arc** (when `arc`): line *i* has radius `Rᵢ = R − i·lineSpacing·size·s` (outside) or `Rᵢ = R + i·lineSpacing·size·s` (inside). Any `Rᵢ ≤ size·s` → `error: 'text-arc'`, with no geometry.
   - **Arc position:** for a glyph whose advance-centre is at straight x-position `u` on its line, take `σ = u − a`, where `a` is `0` for left, `wᵢ/2` for centre and `wᵢ` for right.
   - **Outside:** `θ = π/2 − σ/Rᵢ`, and the glyph is rotated by `θ − π/2`.
   - **Inside:** `θ = −π/2 + σ/Rᵢ`, and the glyph is rotated by `θ + π/2`.
   - **Placing a glyph:** a glyph point `(gx, gy)`, relative to the glyph's advance-centre on the baseline, is rotated, then moved to `(Rᵢ cos θ, Rᵢ sin θ)`. The circle centre is the local origin.
7. **Anchor** (no arc): translate so the anchor point of the ink bounds is at the origin (`topLeft` = (minX, maxY), `center` = midpoint, …).
8. **Mirror, rotate, place:** with `mirror`, `x → −x`. Then rotate by `angle` degrees counter-clockwise about the origin, then add `position`. Mirror reverses the loop orientation, which the union in step 9 tolerates.
9. **Union (outline fonts):** collect every glyph loop as a `Poly` and call `polysToRegions` (NonZero). Each region becomes a `Shape` via `pathFromPoints(…, true)`: outer CCW, islands CW (re-orient by signed area if needed). Regions nested inside a hole become their own shapes, which `polysToRegions` already does. Single-line strokes become `pathFromPoints(points, false)`.
10. **Bounds:** the bounds of all output points.

- [ ] **Step 1: Write the failing tests** (`text-layout.test.ts`; the test font gives exact numbers: cap height 700 units, `H` ink 50…650 × 0…700, advance 700)

```ts
import { describe, expect, it } from 'vitest';
import { layoutText, loadBundledFont, newTextItem, parseFontFile, type TextItem, type TextLayout } from '../src';
import { testFontBytes } from './fixtures/testFont';

const font = parseFontFile(testFontBytes(), 'TestSans.otf');
const item = (patch: Partial<TextItem>): TextItem => ({ ...newTextItem('t', 'Text 1', { x: 0, y: 0 }), text: 'H', anchor: 'bottomLeft', ...patch });
const w = (l: TextLayout) => l.bounds!.max.x - l.bounds!.min.x;
const h = (l: TextLayout) => l.bounds!.max.y - l.bounds!.min.y;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('text layout', () => {
  it('scales by cap height', () => {
    const l = layoutText(item({ size: 7 }), font, 0.01);
    near(h(l), 7);              // H is exactly cap height
    near(w(l), 6);              // 600 units × 7/700
    expect(l.shapes).toHaveLength(1);
  });

  it('applies letter spacing and kerning', () => {
    const base = layoutText(item({ size: 7, text: 'HH' }), font, 0.01);
    near(w(base), 6 + 7);       // second H starts one advance (7 mm) later
    near(w(layoutText(item({ size: 7, text: 'HH', letterSpacing: 2 }), font, 0.01)), 15);
    const av = layoutText(item({ size: 7, text: 'AV' }), font, 0.01);
    near(w(av), 13 - 1);        // kerning −100 units = −1 mm
  });

  it('stacks lines and aligns them', () => {
    const t = 'HH\nH';
    const left = layoutText(item({ size: 7, text: t, align: 'left', lineSpacing: 2 }), font, 0.01);
    near(h(left), 7 + 14);      // second baseline 2 × 7 mm lower
    const right = layoutText(item({ size: 7, text: t, align: 'right' }), font, 0.01);
    const centre = layoutText(item({ size: 7, text: t, align: 'center' }), font, 0.01);
    const lowLeftX = (l: TextLayout) => Math.min(...l.shapes.filter((s) => s.outer.segments.every((g) => (g.kind === 'line' ? g.from.y : 0) < -1)).flatMap((s) => s.outer.segments.map((g) => (g.kind === 'line' ? g.from.x : Infinity))));
    near(lowLeftX(right) - lowLeftX(left), 7);
    near(lowLeftX(centre) - lowLeftX(left), 3.5);
  });

  it('keeps blank lines and reports empty text', () => {
    near(h(layoutText(item({ size: 7, text: 'H\n\nH', lineSpacing: 1 }), font, 0.01)), 7 + 14);
    expect(layoutText(item({ text: '  \n ' }), font, 0.01)).toMatchObject({ error: 'text-empty', shapes: [], bounds: null });
  });

  it('fits into a box, never scaling up', () => {
    const l = layoutText(item({ size: 7, text: 'HHHH', fit: { width: 13, height: null } }), font, 0.01);
    near(w(l), 13);
    near(w(layoutText(item({ size: 7, text: 'H', fit: { width: 100, height: 100 } }), font, 0.01)), 6);
    near(h(layoutText(item({ size: 7, text: 'H', fit: { width: 100, height: 3.5 } }), font, 0.01)), 3.5);
    expect(layoutText(item({ size: 7, text: 'HHHH', fit: { width: 2, height: null } }), font, 0.01).error).toBe('text-fit');
  });

  it('puts each anchor at the position, then rotates and mirrors about it', () => {
    const at = (anchor: TextItem['anchor']) => layoutText(item({ size: 7, anchor, position: { x: 100, y: 50 } }), font, 0.01).bounds!;
    expect(at('bottomLeft').min).toEqual({ x: 100, y: 50 });
    near(at('center').min.x, 97); near(at('center').min.y, 46.5);
    near(at('topRight').max.x, 100); near(at('topRight').max.y, 50);
    const r = layoutText(item({ size: 7, angle: 90, position: { x: 100, y: 50 } }), font, 0.01).bounds!;
    near(r.max.x, 100); near(r.min.x, 93); near(r.min.y, 50); near(r.max.y, 56);
    const m = layoutText(item({ size: 7, mirror: true, position: { x: 100, y: 50 } }), font, 0.01).bounds!;
    near(m.max.x, 100); near(m.min.x, 94);
  });

  it('places glyphs on an arc, outside clockwise and inside counter-clockwise', () => {
    const glyphCentres = (l: TextLayout) => l.shapes.map((s) => {
      const pts = s.outer.segments.map((g) => (g.kind === 'line' ? g.from : { x: NaN, y: NaN }));
      return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    });
    const out = layoutText(item({ size: 7, text: 'HHH', arc: { radius: 50, side: 'outside' }, position: { x: 0, y: 0 } }), font, 0.01);
    const oc = glyphCentres(out).sort((a, b) => a.x - b.x);
    expect(oc).toHaveLength(3);
    // middle glyph straddles the top: ink centre radius = 50 + 3.5 (half the cap height above the baseline)
    near(Math.hypot(oc[1].x, oc[1].y), 53.5); near(oc[1].x, 0);
    // reading order left→right runs clockwise: the left glyph has the larger angle
    expect(Math.atan2(oc[0].y, oc[0].x)).toBeGreaterThan(Math.atan2(oc[2].y, oc[2].x));
    const inn = layoutText(item({ size: 7, text: 'HHH', arc: { radius: 50, side: 'inside' } }), font, 0.01);
    const ic = glyphCentres(inn).sort((a, b) => a.x - b.x);
    near(Math.hypot(ic[1].x, ic[1].y), 46.5); expect(ic[1].y).toBeLessThan(0);
    expect(layoutText(item({ size: 7, arc: { radius: 6, side: 'outside' } }), font, 0.01).error).toBe('text-arc');
    expect(layoutText(item({ size: 7, text: 'H\nH', lineSpacing: 2, arc: { radius: 18, side: 'outside' } }), font, 0.01).error).toBe('text-arc'); // second line radius 4
  });

  it('unions overlapping contours and keeps counters as islands', async () => {
    const o = layoutText(item({ size: 7, text: 'O' }), font, 0.01);
    expect(o.shapes).toHaveLength(1);
    expect(o.shapes[0].islands).toHaveLength(1);
    const overlap = layoutText(item({ size: 7, text: 'HH', letterSpacing: -3 }), font, 0.01); // boxes overlap by 2 mm
    expect(overlap.shapes).toHaveLength(1);
    const sans = await loadBundledFont('sans');
    const b = layoutText(item({ text: 'B', font: { kind: 'bundled', id: 'sans' } }), sans, 0.01);
    expect(b.shapes).toHaveLength(1);
    expect(b.shapes[0].islands).toHaveLength(2);
  });

  it('skips and lists missing characters without NaN', () => {
    const l = layoutText(item({ size: 7, text: 'H😀\tZH' }), font, 0.01);
    expect(l.missing).toEqual(['😀', '\t', 'Z']);
    expect(l.shapes).toHaveLength(2);
    expect(l.shapes.flatMap((s) => s.outer.segments).every((g) => g.kind !== 'line' || (Number.isFinite(g.from.x) && Number.isFinite(g.to.y)))).toBe(true);
  });

  it('lays out single-line fonts as strokes', async () => {
    const hs = await loadBundledFont('hersheySans');
    const l = layoutText(item({ size: 21, text: 'H', font: { kind: 'bundled', id: 'hersheySans' } }), hs, 0.01);
    expect(l.shapes).toEqual([]);
    expect(l.strokes).toHaveLength(3);
    expect(l.strokes.every((p) => !p.closed)).toBe(true);
    near(h(l), 21);
  });

  it('is fast enough for a paragraph and caches', async () => {
    const bold = await loadBundledFont('sansBold');
    const text = ['The quick brown fox jumps over the lazy dog 0123456789 ÆØÅ æøå!', 'Pack my box with five dozen liquor jugs, then sign it.', 'Sphinx of black quartz, judge my vow. 1234567890 °±×'].join('\n').repeat(1).padEnd(200, 'x');
    const it0 = item({ text, size: 12, font: { kind: 'bundled', id: 'sansBold' } });
    let t = performance.now();
    layoutText(it0, bold, 0.002);
    expect(performance.now() - t).toBeLessThan(300);
    t = performance.now();
    layoutText(it0, bold, 0.002);
    expect(performance.now() - t).toBeLessThan(5);
    const line = item({ text: 'Spon CAM: text in Spon, 40 characters!!', font: { kind: 'bundled', id: 'sans' } });
    const sans = await loadBundledFont('sans');
    t = performance.now();
    layoutText(line, sans, 0.002);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
```

Notes for the implementer:
- **Helpers:** `lowLeftX` and `glyphCentres` in the tests are crude helpers. Replace them with clearer ones from `src` (for example `flattenPath`) if those exist; keep each assertion's meaning.
- **Arc test:** if the arc test's expected radii disagree with the algorithm's definition of the ink centre, check against §4 step 6 rather than adjusting the numbers silently, and explain any change in the report.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core test text-layout`. Expected: FAIL.

- [ ] **Step 3: Implement `layout.ts`** following the algorithm above.
  - **Cache:** a `Map` keyed by `JSON.stringify(item) + '|' + tol`, inside a `WeakMap` keyed by `LoadedFont`. Limit it to 200 entries per font (delete the oldest).
  - **Export:** `layoutText` and `TextLayout` from `index.ts`.

- [ ] **Step 4: Verify.** Run `pnpm --filter @sponcam/core test text-layout`, then `pnpm typecheck && pnpm test`.

- [ ] **Step 5: Commit.** `feat(core): text layout (lines, spacing, fit, anchor, arc, mirror, union)`

---

### Task 4: Text as geometry: resolution, diagnostics and the pipeline

**Files:**
- Create: `packages/core/src/text/resolve.ts`, `packages/core/test/text-resolve.test.ts`
- Modify: `src/cam/types.ts` (`TextRef`, `CamCode` additions), `src/cam/context.ts` (`fonts` in `CamContext`), `src/cam/features/resolve.ts`, `src/cam/generate.ts` (key, `generateJob` signature), `src/pipeline/run.ts`, `src/index.ts`; compile fixes in `packages/mcp/src/fileSession.ts`, `packages/mcp/src/schemas.ts` (geometry ref) and `packages/web/src/workers/import.worker.ts` (they pass `EMPTY_FONTS` for now; Tasks 5 and 6 wire real fonts)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
```ts
// cam/types.ts
export interface TextRef { kind: 'text'; textId: string }
export type GeometryRef = DxfPathRef | MeshFaceRef | MeshLoopRef | MeshHoleRef | MeshSlotRef | TextRef;
// CamCode gains: 'font-unreadable' | 'font-missing' | 'text-empty' | 'text-missing-glyphs' | 'text-fit' | 'text-arc' | 'text-no-stock' | 'text-single-line'

// cam/context.ts
export function camContext(job: Job, geometry: CamGeometry | null, fonts: FontSet = EMPTY_FONTS): CamContext;   // CamContext gains `fonts: FontSet`

// text/resolve.ts
export interface ResolvedText {
  textId: string;
  z: number | null;                       // surface Z (program coordinates); null if it doesn't resolve
  shapes: Shape[];                        // program coordinates
  strokes: Path2D[];                      // program coordinates
  kind: 'outline' | 'singleLine' | null;  // null when the font isn't available
  diagnostics: CamDiagnostic[];           // operationId '' — the text's own problems
}
export function resolveText(item: TextItem, ctx: CamContext): ResolvedText;
export interface TextSummary { textId: string; diagnostics: CamDiagnostic[]; z: number | null; loops: { points: Vec2[]; closed: boolean }[] }  // flattened, program coordinates, for drawing
export function textSummaries(job: Job, ctx: CamContext): TextSummary[];

// cam/generate.ts
export function generateJob(job: Job, geometry: CamGeometry | null, cache?: GenerationCache, fonts?: FontSet): OperationResult[];
// pipeline/run.ts
export function runPipeline(job, geometry, ctx, cache?, opts?, fonts: FontSet = EMPTY_FONTS): PipelineResult;
// CamRun gains `texts: TextSummary[]`
```

Rules (spec §2.4, §5):
- **Stock to program:** `ctx.stock` is the stock box in program coordinates, so a stock-coordinate point `p` maps to `(ctx.stock.min.x + p.x, ctx.stock.min.y + p.y)`.
  - **No stock box** (`ctx.stock === null`): the text gets `text-no-stock` when the job has no model and the stock is `auto`. In any other case without a stock box it gets `ref-missing` with `Set up the stock first`.
- **Surface Z:**
  - `stockTop` → `ctx.stock.max.z`.
  - `face` → the existing face resolver; a face that fails gives its own code and message, as an error on the text.
- **Diagnostics, in order:**
  1. font status `missing` → `font-missing`; `unreadable` → `font-unreadable`;
  2. a layout `error` → its code with the §5 message;
  3. any missing glyphs → the `text-missing-glyphs` warning.
  
  Messages use `item.name` and `font.name`.
- **In `resolveGeometry`**, for each `TextRef` at index `i`:
  - **Missing text:** `ref-missing` with `The picked text no longer exists`.
  - **The text's own errors:** copy each error from `resolveText` with `operationId: op.id, ref: i`, and stop. The missing-glyph warning is copied too, then the text continues.
  - **Single-line fonts:** with `op.type !== 'engrave'` → `text-single-line`. With engrave, each stroke becomes `contours.push({ path, z, ref: i })`.
  - **Outline fonts:**
    - **Engrave:** each shape's outer and islands become contours (`kind: 'outer'` / `'inner'`), like face loops.
    - **Profile:** each outer and each island becomes a contour.
    - **Pocket and V-carve:** each shape becomes `shapes.push({ shape, z, ref: i })`.
    - **Other types** (drill, face, chamfer, slot) → `wrong-geometry` with `Text can't be used by this operation`. The web app won't offer it; MCP could.
- **`operationKey`:** add `texts` to the key. For each `TextRef` in `op.geometry`, include `[job.texts.find(…) ?? null, fonts.status(font)]`, so a font that arrives later invalidates the cached result.
- **`text-no-stock`** is also reported in `textSummaries` for every text when it applies.
- **`textSummaries`:** one entry per `job.texts` item, with diagnostics (`operationId: ''`) and `loops`: flattened outer and island loops (closed) or strokes (open), in program coordinates.

- [ ] **Step 1: Write the failing tests** (`text-resolve.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { applyCommands, camContext, createJob, FontStore, type Job, PipelineCache, programContext, runPipeline, setStock } from '../src';
import { faceAt, plateSetup, tool6 } from './fixtures/camSetup';
import { testFontBytes } from './fixtures/testFont';

const vbit = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0 };

async function signJob(textPatch: object, opType: 'vcarve' | 'engrave' | 'pocket' | 'profile' | 'drill' = 'vcarve', fontBlobs: Record<string, Uint8Array> = {}) {
  let job: Job = setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } });
  job = applyCommands(job, [
    { type: 'addText', id: 't', patch: { text: 'SPON', size: 30, ...textPatch } },
    { type: 'addTool', tool: vbit },
    { type: 'addOperation', opType, toolId: 'v60', id: 'o' },
    { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'text', textId: 't' }] } },
  ]);
  const fonts = new FontStore();
  await fonts.ensure(job, fontBlobs);
  const { run, toolpaths } = runPipeline(job, null, programContext(job, null), new PipelineCache(), { date: '2026-01-01' }, fonts);
  return { job, fonts, run, toolpaths, ctx: camContext(job, null, fonts) };
}

describe('text as geometry', () => {
  it('V-carves a sign on fixed stock with no model', async () => {
    const { run, toolpaths } = await signJob({});
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(toolpaths).toHaveLength(1);
    expect(run.texts[0]).toMatchObject({ textId: 't', diagnostics: [], z: 0 });
    expect(run.texts[0].loops.length).toBeGreaterThan(4);   // S, P, O + counter, N
  });

  it('keeps its place on the part when the work origin moves', async () => {
    const a = await signJob({});
    const job = applyCommands(a.job, [{ type: 'setWcs', patch: { anchor: { x: 'max', y: 'max', z: 'top' } } }]);
    const b = runPipeline(job, null, programContext(job, null), new PipelineCache(), { date: '2026-01-01' }, a.fonts);
    const minX = (r: typeof b.run) => Math.min(...r.texts[0].loops.flatMap((l) => l.points.map((p) => p.x)));
    expect(minX(a.run) - minX(b.run)).toBeCloseTo(200, 6);   // program X shifted by the stock width, text unmoved on the stock
  });

  it('engraves Hershey text and refuses single-line text elsewhere', async () => {
    const eng = await signJob({ font: { kind: 'bundled', id: 'hersheySans' } }, 'engrave');
    expect(eng.toolpaths).toHaveLength(1);
    const pocket = await signJob({ font: { kind: 'bundled', id: 'hersheySans' } }, 'pocket');
    expect(pocket.run.results[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-single-line', message: 'Text 1 uses a single-line font; this operation needs closed outlines', ref: 0 }));
    const drill = await signJob({}, 'drill');
    expect(drill.run.results[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'wrong-geometry' }));
  });

  it('reports text problems on the text and on the operation', async () => {
    const empty = await signJob({ text: ' ' });
    expect(empty.run.texts[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-empty', message: 'Text 1 has no text' }));
    expect(empty.run.results[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-empty', ref: 0 }));
    const arc = await signJob({ arc: { radius: 10, side: 'outside' } });
    expect(arc.run.texts[0].diagnostics[0]).toMatchObject({ code: 'text-arc', message: 'The arc radius of Text 1 is smaller than its text' });
    const fit = await signJob({ fit: { width: 1, height: null } });
    expect(fit.run.texts[0].diagnostics[0]).toMatchObject({ code: 'text-fit', message: "Text 1 doesn't fit its box" });
    const glyphs = await signJob({ text: 'SPON😀' });
    expect(glyphs.run.texts[0].diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'text-missing-glyphs', message: 'Inter has no glyph for: 😀' })]);
  });

  it('reports a missing font file, and clears it when the bytes arrive (no stale cache)', async () => {
    const fontRef = { kind: 'file', blobId: 'f1', name: 'TestSans.otf' } as const;
    const a = await signJob({ text: 'HO', font: fontRef });
    expect(a.run.texts[0].diagnostics[0]).toMatchObject({ code: 'font-missing', message: 'The font file for Text 1 is missing' });
    const cache = new PipelineCache();
    runPipeline(a.job, null, programContext(a.job, null), cache, {}, a.fonts);
    await a.fonts.ensure(a.job, { f1: testFontBytes() });
    const b = runPipeline(a.job, null, programContext(a.job, null), cache, {}, a.fonts);
    expect(b.run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(b.toolpaths).toHaveLength(1);
  });

  it('needs a fixed stock without a model', async () => {
    const job = applyCommands(createJob(), [{ type: 'addText', id: 't' }]);
    const fonts = new FontStore();
    await fonts.ensure(job, {});
    const { run } = runPipeline(job, null, programContext(job, null), new PipelineCache(), {}, fonts);
    expect(run.texts[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-no-stock', message: 'Text without a model needs a fixed stock size' }));
  });

  it('sits on a picked model face', async () => {
    // plateSetup(): auto stock with no Z margin, so program Z 0 is the plate top
    const { job: base, geometry } = plateSetup();
    const mesh = geometry as typeof geometry & { kind: 'mesh' };
    const p = mesh.mesh.positions;
    let zTop = -Infinity, xMin = Infinity, yMin = Infinity;
    for (let i = 0; i < p.length; i += 3) { zTop = Math.max(zTop, p[i + 2]); xMin = Math.min(xMin, p[i]); yMin = Math.min(yMin, p[i + 1]); }
    const face = faceAt(mesh, xMin + 1, yMin + 1, zTop);
    const job = applyCommands(base, [
      { type: 'addText', id: 't', patch: { text: 'HI', size: 5, surface: { from: 'face', face } } },
      { type: 'addTool', tool: vbit },
      { type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'o' },
      { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'text', textId: 't' }] } },
    ]);
    const fonts = new FontStore();
    await fonts.ensure(job, {});
    const { run, toolpaths } = runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), {}, fonts);
    expect(run.texts[0].z).toBeCloseTo(camContext(job, geometry, fonts).model!.max.z, 6);
    expect(run.texts[0].z).toBeCloseTo(0, 6);
    expect(toolpaths).toHaveLength(1);
  });

  it('cuts text that runs off the stock edge without crashing', async () => {
    const { run, toolpaths } = await signJob({ position: { x: 190, y: 50 }, size: 40 });
    expect(toolpaths).toHaveLength(1);
    expect(run.results[0].diagnostics.every((d) => d.code !== 'internal')).toBe(true);
  });
});
```

Notes:
- **Face test:** the text is centred on the stock by default, which may sit over the plate's pocket rather than its top face. That's fine: the assertions are about Z, and the V-carve cuts at the face height wherever the text lies.
- **Golden test:** add a golden G-code test next to the existing goldens (find them with `grep -rln "golden" packages/core/test`). It covers an engraving of `"SPON"` in `hersheySans`, size 20, at depth 0.3 on a 100 × 50 × 10 fixed stock, with tool `v60`, posted with `{ date: '2026-01-01' }`. Generate the golden file once with the same mechanism the existing goldens use, and check by eye that its Z values are 0 and −0.3 before committing.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core test text-resolve`. Expected: FAIL.

- [ ] **Step 3: Implement** as specified in Rules.
  - `resolveText` calls `layoutText(item, font, ctx.tolerance)` and maps the result to program coordinates.
  - `generateJob` and `runPipeline` take the new `fonts` argument; `camContext` stores it.
  - **Compile fixes:**
    - pass `EMPTY_FONTS` in the web worker and MCP `fileSession.ts` for now;
    - the MCP geometry-ref zod schema gains `z.strictObject({ kind: z.literal('text'), textId: z.string() })`;
    - web code with exhaustive switches over `GeometryRef['kind']` (e.g. `inspector/geometryLabels.ts`) gets a `text` case: label `Text: <name>`, or `Text (deleted)`.

- [ ] **Step 4: Verify.** Run `pnpm --filter @sponcam/core test text-resolve`, then `pnpm typecheck && pnpm test`. Goldens other than the new one are unchanged.

- [ ] **Step 5: Commit.** `feat(core): text as operation geometry, text diagnostics and summaries`

---

### Task 5: MCP: text and font tools

**Files:**
- Modify: `packages/mcp/src/fileSession.ts` (a `FontStore`; `await fonts.ensure(job, blobs)` before every `runPipeline`), `src/session.ts` / live session (pass fonts likewise, or follow Clarification 6), `src/tools/edit.ts` or a new `src/tools/text.ts` (registered where the other tool modules are), `src/schemas.ts`, `src/instructions.ts`, `packages/mcp/README.md`
- Test: `packages/mcp/test/tools-text.test.ts` (follow `tools-edit.test.ts` for setting up a session and calling tools)

**Tools (spec §8):**
- **`list_fonts {}`** → `{ bundled: [{ id, family, kind }], inJob: [{ blobId, name, usedBy: string[] }] }`.
- **`load_font { path }`** reads the file, checks it with `parseFontFile`, and stores the bytes as a blob with id `font-<uuid>`. It returns `{ font: { kind: 'file', blobId, name } }`, where `name` is the file name. On a `FontFileError`, the tool result is an error carrying that exact message.
- **`add_text { id?, ...TextPatch }`** → `{ id }`; it uses the `addText` command.
- **`update_text { id, patch }`** and **`remove_text { id }`** use the commands.
- **Existing operation tools** (`add_operation`, `update_operation`, `apply_commands`) already accept `{ kind: 'text', textId }` after Task 4.
- **Generation:** `generate` / `export` / `render_preview` call `fonts.ensure` with the session's blobs first.
- **Instructions:** `instructions.ts` gains a "Text" section:
  - texts are job items in stock coordinates (mm from the stock's min corner);
  - surface is `stockTop` or a picked face;
  - a text needs a fixed stock when there is no model;
  - outline fonts are for profile, pocket, engrave and V-carve; single-line (Hershey) fonts are for engrave only;
  - `load_font` comes before using an uploaded font;
  - the defaults.
- **README:** the MCP README lists the new tools.

- [ ] **Step 1: Write the failing tests** (`tools-text.test.ts`):
  - **Sign:**
    1. Start a session with no model and set a fixed stock.
    2. Call `list_fonts` and check it lists 6 bundled fonts.
    3. Call `add_text` with `{ text: 'SPON', size: 30 }`.
    4. Add a V-bit and a V-carve with geometry `[{ kind: 'text', textId }]`, then export.
    
    The export must contain a G-code file, and the generate result must have no errors.
  - **Uploaded font:** write `testFontBytes()` to a temp file (in the test's temp dir), then `load_font` it. Then `update_text` the font to the returned ref, and check that generating gives no `font-missing`.
  - **Refused fonts:** `load_font` on a `.woff2` path gives the WOFF2 message.
  - **Save and reopen:** save the session to a `.spon` file, reopen it, and check that the text and the uploaded font survive (generate gives no `font-missing`).
  - **Validation:** `update_text` with `size: 0` returns the command error.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/mcp test tools-text`.

- [ ] **Step 3: Implement** the tools and the `FontStore` wiring. Zod schemas use `strictObject`. The `textPatch` schema from Task 1 is reused, and a type-equality test (like the existing ones) checks `textPatch` against `TextPatch`, including the key sets.

- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/mcp test`, then `pnpm typecheck && pnpm test`.

- [ ] **Step 5: Commit.** `feat(mcp): text and font tools`

---

### Task 6: Web: state, fonts in the worker, persistence, Text panel and inspector

**Files:**
- Modify:
  - `packages/web/src/state/store.ts`: `fontBytes: Record<string, Uint8Array>`, `selectedTextId: string | null`, `addFontBytes(blobId, bytes)`, and `selectText(id)`. Selecting a text clears `selectedOperationId` and the reverse.
  - `state/documents.ts`: new, open and save carry `fontBytes` like `programBytes`; save puts them in the `BlobMap`; open fills `fontBytes` from blobs referenced by texts.
  - `state/autosave.ts`: persists font blobs like program blobs.
  - `state/programs.ts`: blob pruning keeps font blobs referenced by any job in `past`, `job` or `future`.
  - `state/cam.ts`: sends font bytes to the worker before generating; stores `run.texts` as `camTexts`.
  - `workers/import.worker.ts`: a `FontStore`; `addFonts(map)`; `generate` becomes `async` and awaits `fonts.ensure(job, fontBlobs)`.
  - `layout/railStore.ts`: `PanelId` adds `'text'`.
  - `layout/railPanels.ts`: a Text panel after `origin`, group `setup`, title `Text`, icon `Type` from lucide.
  - `layout/setupStatus.ts`: problem-only dot for `text` when any `camTexts` entry has an error.
  - `inspector/Inspector.tsx`: shows `TextInspector` when `selectedTextId` is set.
- Create: `packages/web/src/panels/TextPanel.tsx`, `panels/TextRow.tsx`, `inspector/TextInspector.tsx`, `inspector/textFonts.ts` (font dropdown model, tested), plus unit tests `state/texts.test.ts` and `inspector/textFonts.test.ts`.

**Behaviour (spec §7):**
- **Text panel:**
  - **Rows** reuse `SortableList` and the two-line row style of `OperationRow`. Line 1 is the name. Line 2 is the first line of the text, truncated to 24 characters, then ` · <font display name> · <size in display units>`.
  - **⋯ menu:**
    - Rename, Duplicate, Delete. Duplicate is `addText` with the source's fields and the name `<name> copy`, placed right after it with `moveText` in the same `dispatchBatch`.
    - **Add operation ▸ V-carve / Engrave / Pocket.** It adds a V-carve, Engrave or Pocket operation with geometry `[{ kind: 'text', textId }]` and the first suitable job tool, or none, in one `dispatchBatch`, then selects it. For single-line fonts only Engrave is shown.
  - **Rows also support** Del, Ctrl+D, and Alt+↑/↓ through the existing `listShortcuts` helper.
  - **"Add text"** (`text-add`) dispatches `addText`, then `updateText` to centre it on the stock. The centre is the stock box size / 2, read from the store's derived stock box (stock coordinates). It then selects the new text.
- **Text inspector** (fields and test ids in Global Constraints):
  - **Number fields:** use `NumericField` in display units for lengths. Angle is in degrees and line spacing is a plain number (×).
  - **Editing:** each field change is one `dispatch(updateText)`. The text area commits on blur and on Ctrl+Enter, not on every keystroke, so undo steps stay meaningful.
  - **Font dropdown:**
    - **Groups:** Outline (sans, sansBold, serif), Single-line (the three Hershey fonts), In this job (distinct `file` fonts used by any text), and `Load font…`.
    - **Load font…:** opens a file input accepting `.ttf,.otf,.woff,.woff2`. It reads the bytes, checks them with `parseFontFile`; on an error it shows the exact message in the existing toast or alert used for import errors. Otherwise it calls `addFontBytes(blobId)` with a `crypto.randomUUID()` blob id, then `updateText` with the font set to `{ kind: 'file', blobId, name: file.name }`.
  - **Fit, arc and surface:** fit and arc are each a checkbox that, when on, shows its fields. Turning fit on sets `{ width: <current ink width or 100>, height: null }`; turning arc on sets `{ radius: 50, side: 'outside' }`.
  - **Surface:**
    - **Stock top / Face:** choosing Face enters the existing face-pick mode, reusing the Heights tab's face pick. The picked `MeshFaceRef` is stored as `surface: { from: 'face', face }`.
    - **"Pick face":** `text-pick-face` re-enters the face-pick mode.
    - **Without a mesh model** the Face option is disabled.
  - **Centre on stock:** sets `position` to the stock size / 2 and `anchor` to `center`.
  - **Centre on face:** sets `position` to the centre of the face's outer-loop bounding box, converted from program to stock coordinates: subtract `stock.min` in program coordinates. Use the catalog or `camResults` data the Heights tab already uses for faces. If none is reachable, add a small core helper `faceOutlineBounds(job, geometry, face)` with a unit test.
  - **Diagnostics:** this text's diagnostics from `camTexts`, shown under the fields in the same style the operation inspector uses.
- **Worker:**
  - Font bytes go to the worker once per blob id. `cam.ts` keeps a `sentFontIds` set and calls `api.addFonts({ [id]: bytes })` for new ids before `generate`.
  - The worker passes its accumulated map to `fonts.ensure`.
  - `setCamModel` does not clear fonts.

- [ ] **Step 1: Write the failing unit tests:**
  - **`state/texts.test.ts`** (store-level, following `store.test.ts` patterns):
    - add text centres it on a fixed stock;
    - duplicate adds `<name> copy` right after the source;
    - "Add operation ▸ V-carve" creates one undo step with the operation's geometry set;
    - selecting a text clears the selected operation and the reverse;
    - pruning keeps a font blob referenced only in `past`;
    - save → open round trip keeps `fontBytes` (follow `fileio.test.ts` / `export.test.ts`).
  - **`inspector/textFonts.test.ts`:** the dropdown model groups the bundled fonts and the in-job fonts (deduplicated by blob id), and marks single-line fonts.
- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/web test texts textFonts`.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/web test`, then `pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Step 5: Commit.** `feat(web): Text panel, text inspector, fonts in the worker and in saved jobs`

---

### Task 7: Web: drawing, picking and dragging texts; texts in the geometry tab

**Files:**
- Create: `packages/web/src/viewport/TextObjects.tsx`, `packages/web/src/viewport/textDrag.ts` (pure drag maths, tested), `packages/web/src/viewport/textDrag.test.ts`
- Modify: `viewport/Viewport.tsx` (mount `TextObjects`; hide while a toolpath simulation is playing — use the same flag the toolpath playback uses), `inspector/GeometryTab.tsx` (a "Texts" group), `inspector/geometryLabels.ts` (if not done in Task 4)

**Behaviour:**
- **Drawing:** `TextObjects` draws each `camTexts` entry's `loops` as three.js line loops or lines.
  - **Position:** at scene `Z = summary.z + origin.z`, with XY = program XY + origin XY. Use the same program-to-scene conversion the toolpath view uses (`viewport/convert.ts`).
  - **Colours:** the normal colour is the existing contour colour; hovered and selected texts use the highlight colours used for picked geometry.
  - **Entries with `z === null`** are not drawn.
- **Picking:** a click on a text's lines selects it (`selectText`), using a raycast with a line threshold of 1.5 mm in screen-scaled units like the existing contour picking in `camPick.ts`. Clicks never pick a text while a face/geometry pick mode is active.
- **Dragging:** pointer-down on the *selected* text starts a drag.
  - Orbit controls are disabled during the drag, via the `OrbitLike` handle.
  - The pointer is projected onto the plane `Z = text Z`. The text is drawn shifted by the pointer delta (a local state offset).
  - On pointer-up, one `dispatch(updateText(id, { position: start + delta }))` (stock coordinates; the delta is the same in program and stock coordinates). A drag shorter than 0.5 mm on screen is a click, not a move.
  - Escape cancels the drag.
  - `textDrag.ts` holds the pure parts: `planeHit(ray, z)` and `dragPosition(start, hit0, hit, minMove)`, and they are unit-tested.
- **Geometry tab:** for profile, pocket, engrave and V-carve operations, a "Texts" group lists `job.texts` (name, font display name) with the same checkbox and pick style as the other groups.
  - Ticking one adds `{ kind: 'text', textId }`; unticking removes it.
  - Single-line texts are listed only for engrave operations.
  - Drill, face, chamfer, slot and clearing operations show no Texts group.

- [ ] **Step 1: Write the failing unit tests:**
  - **`textDrag.test.ts`:**
    - `planeHit` of a ray straight down at (5, 6) on `z = −3` → (5, 6, −3);
    - a ray parallel to the plane → null;
    - `dragPosition` returns `null` below `minMove` and `start + (hit − hit0)` above it.
  - **Geometry-tab model:** if the tab's list-building logic is not already a pure helper, extract it into `inspector/geometryGroups.ts` with a test showing which texts are listed for engrave vs pocket vs drill.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/web test`, then `pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Step 5: Commit.** `feat(web): texts in the view (pick and drag) and in the geometry tab`

---

### Task 8: End-to-end tests, docs and verification

**Files:**
- Create: `packages/web/e2e/text.spec.ts`; a font fixture for the upload test. Use `testFontBytes()` written to `packages/core/test/fixtures/TestSans.otf` by `make-fixtures.mjs`. If writing it from `.mjs` is awkward, add a tiny `scripts/make-test-font.mjs` that imports opentype.js the same way and is called by `make-fixtures.mjs`, then commit the `.otf`.
- Modify: `packages/core/test/fixtures/make-fixtures.mjs`, `README.md`, `THIRD_PARTY_NOTICES.md` (check that Task 2 covered it), `.claude/skills/spon-dev/SKILL.md` (fixtures and the `build:fonts` script)

**e2e tests** (`text.spec.ts`; use `openPanel(page, 'text')` from `e2e/helpers.ts`, and add `'text'` to its id list):
1. **Sign without a model:**
   1. Set a fixed stock of 200 × 100 × 18 in the Stock panel. Open Text and click `text-add`.
   2. Type `SPON` in `text-content` and blur, then set `text-size` to 30.
   3. Expect the row to read `SPON`.
   4. Drag the text in the view by 20 mm in X; `text-x` changes by 20 (±1).
   5. Press Ctrl+Z; `text-x` is back.
   6. From the row's ⋯ menu choose Add operation ▸ V-carve, pick the V-bit tool, and set a max depth. Then use `vcarve-add-clearing` and pick a flat end mill.
   7. Generate. The status is `ok`, and export downloads files.
2. **Uploaded font survives saving:**
   1. Add text and load `TestSans.otf` through `Load font…`.
   2. Save the `.spon` file (follow the existing save/open e2e helpers), reload the page, and open it.
   3. The font dropdown shows `TestSans.otf` under "In this job", and the Text panel shows no problem dot.
3. **Single-line text on a model face:**
   1. Import `stepped.stl`, add text, and set `text-font` to Hershey Sans.
   2. Set the surface to Face and pick the boss's top face.
   3. Click `text-centre-face`, then add an Engrave operation from the row menu.
   4. Generate. The status is `ok`.
4. **Single-line font refused by a pocket:** with a Hershey text, add a Pocket from the Operations panel and tick the text in the geometry tab. The operation shows `Text 1 uses a single-line font; this operation needs closed outlines`.

**Docs:**
- **README Features:** add "Text: typed text in bundled or uploaded fonts (outline and single-line), on the stock or a model face, with multi-line, spacing, fit, arc, rotation and mirror; V-carve, engrave, pocket or profile it."
- **README Status and roadmap:** 4.4b done, 4.4c V-carve inlays next, then 4.5 Thread milling and 4.6 Auto-suggest.
- **spon-dev skill:** add `TestSans.otf` and `pnpm --filter @sponcam/core build:fonts`.

- [ ] **Step 1:** Generate the font fixture and commit it.
- [ ] **Step 2:** Write the e2e tests. Run `pnpm e2e -- text`; expect FAIL only where the UI is missing. Fix the test ids or helpers, never the assertions' intent.
- [ ] **Step 3:** Docs.
- [ ] **Step 4: Full verification** from the root: `pnpm typecheck && pnpm test && pnpm build && pnpm e2e`. Everything must be green, with the existing goldens unchanged.
- [ ] **Step 5: Commit.** `test(e2e): text signs, fonts and single-line engraving; docs for milestone 4.4b`

---

## Spec coverage

| Spec | Task |
|---|---|
| §1 decisions, scope | all |
| §2.1 TextItem, defaults | 1 |
| §2.2 commands, validation, drag = one undo step | 1, 7 |
| §2.3 schema 6, `.spon` fonts, IndexedDB | 1, 6 |
| §2.4 TextRef, shapes/contours, surface Z, stock coordinates | 4 |
| §3.1 bundled fonts | 2 (Clarifications 1, 2) |
| §3.2 uploaded fonts, refusals | 2, 5, 6 |
| §3.3 LoadedFont, cap height, cache | 2 |
| §4 layout 1–9 | 3 |
| §5 diagnostics, operation acceptance | 4 (messages), 6 (panel dot), 7 (geometry tab filtering) |
| §6 code layout, async loading, sync generation | 2, 4 |
| §7 web panel, inspector, view, geometry tab, saving | 6, 7 |
| §8 MCP | 5 |
| §9 testing | 1–8 |
| §10 acceptance | 8 |
