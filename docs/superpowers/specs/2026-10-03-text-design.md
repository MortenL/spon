# Spon — Milestone 4.4b: Text in Spon

**Date:** 2026-10-03
**Status:** Design approved in conversation; written spec awaiting review
**Builds on:** Milestones 1–4.4 (on `master`).

## 1. Scope

| | Contents |
|---|---|
| 4.4 | Engrave, V-carve, V-carve clearing (done) |
| **4.4b (this spec)** | Text typed in Spon: bundled and uploaded fonts, layout, placement, and text as operation geometry |
| 4.4c | V-carve inlays (male and female pairs) |
| 4.5 | Thread milling |
| 4.6 | Automatic operation suggestions |

The user wants text for signs (blank stock, no model), labels on machined panels (text on a model face), and later inlays. Text stays editable: changing the words, font, size or placement regenerates every operation that uses it.

### Decisions taken in conversation
- Text is its own item in the job, works with or without a model, and sits on the stock top or on a picked flat face.
- Fonts: a few bundled fonts (outline and single-line), plus user-loaded `.ttf` / `.otf` / `.woff` files stored inside the job. No system-font access.
- Layout: multi-line with alignment and line spacing; letter spacing; size by cap height; optional fit box; text on an arc; rotation; mirror.
- Placement: numbers in an inspector, plus drag in the view; "Centre on stock" and "Centre on face" buttons.

### Out of scope
- System fonts (Local Font Access API), `.woff2`, variable-font axes, OpenType features beyond kerning (no ligatures, no complex scripts, no right-to-left).
- Text along arbitrary paths (only circles), per-character styling, scale or rotate handles in the view.
- Text on curved or sloped surfaces. Only stock top and flat, upward-facing faces.
- Inlays (4.4c).

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()` / `dispatch` / `dispatchBatch`.
- No GPL dependencies. New: `opentype.js` (MIT) in `@sponcam/core`. Bundled fonts under OFL 1.1 or Apache 2.0; Hershey data under its permissive notice. All recorded in `THIRD_PARTY_NOTICES.md`.
- Playwright uses ports 5199 / 5198; never 5173.

## 2. Job model

### 2.1 `TextItem`

`Job.texts: TextItem[]` (list order = panel order).

```ts
type FontRef =
  | { kind: 'bundled'; id: BundledFontId }
  | { kind: 'file'; blobId: string; name: string };   // name = original file name

interface TextArc { radius: number; side: 'outside' | 'inside' }

type TextSurface = { from: 'stockTop' } | { from: 'face'; face: MeshFaceRef };

type TextAnchor = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';

interface TextItem {
  id: string;
  name: string;              // default "Text 1", "Text 2", …
  text: string;              // '\n' separates lines
  font: FontRef;
  size: number;              // cap height, mm (> 0)
  letterSpacing: number;     // mm added after every glyph, may be negative
  lineSpacing: number;       // baseline-to-baseline distance as a multiple of size (> 0), default 1.6
  align: 'left' | 'center' | 'right';
  fit: { width: number; height: number | null } | null;   // scale down to fit; never up
  position: Vec2;            // anchor point, mm from the stock's min corner (XY)
  anchor: TextAnchor;        // which point of the laid-out block sits at `position`
  angle: number;             // degrees, counter-clockwise, about the anchor
  mirror: boolean;           // mirror in X about the anchor (before rotation)
  arc: TextArc | null;       // baseline follows a circle centred at `position`
  surface: TextSurface;
}
```

Defaults for a new text: `text: 'Text'`, bundled sans, `size: 10`, `letterSpacing: 0`, `lineSpacing: 1.6`, `align: 'center'`, `fit: null`, `anchor: 'center'`, `position` = stock XY centre, `angle: 0`, `mirror: false`, `arc: null`, `surface: { from: 'stockTop' }`.

### 2.2 Commands

New commands in `commands.ts`: `addText(item?)`, `updateText(id, patch)`, `removeText(id)`, `moveText(id, delta)`. Loading a font is not a command: the bytes are stored as a blob, and an `updateText` that sets `font: { kind: 'file', … }` references it. Command validation refuses `size ≤ 0`, `lineSpacing ≤ 0`, `fit.width ≤ 0`, `fit.height ≤ 0`, `arc.radius ≤ 0`, and a non-finite number anywhere. Removing a text leaves operation references to it in place; they report `ref-missing` (existing behaviour for missing refs).

A drag is one `updateText` of `position`, committed once on pointer-up (one undo step).

### 2.3 Schema and files
- `CURRENT_SCHEMA_VERSION` 5 → 6. Migration 5→6 adds `texts: []`. Existing golden G-code tests pass unchanged.
- Uploaded font bytes are blobs. In `.spon` they are stored at `fonts/<blobId>.<ext>` (ext from the file name: `ttf`, `otf`, `woff`). `blobIds(job)` includes every font blob a text references (deduplicated). A font blob that no text references is not written.
- The web store keeps font blobs in IndexedDB like programs.

### 2.4 Geometry reference

New `GeometryRef` member: `{ kind: 'text'; textId: string }`. It resolves (in `cam/features/resolve.ts`) to:
- **Outline fonts:** `shapes` — one `ResolvedShape` per connected region of the unioned glyphs (outer boundary + holes), at the text's surface Z.
- **Single-line fonts:** `contours` — one open `ResolvedContour` per stroke, at the surface Z.

Surface Z: `stockTop` → stock top in program coordinates; `face` → that face's Z through the existing `faceZ`. A face that no longer resolves gives `ref-changed` on the text (see §5).

Coordinates: `position` is in stock coordinates (mm from the stock's min corner). Resolution maps it to program coordinates with the same stock-to-program transform the model uses, so changing the WCS does not move text relative to the part. Moving the model inside a fixed stock does not move the text.

## 3. Fonts

### 3.1 Bundled fonts

| `BundledFontId` | Family | Kind | Licence |
|---|---|---|---|
| `sans` | Inter Regular | outline | OFL 1.1 |
| `sansBold` | Inter Bold | outline | OFL 1.1 |
| `serif` | Roboto Slab Regular | outline | Apache 2.0 |
| `hersheySans` | Hershey Simplex (Roman) | single-line | Hershey notice |
| `hersheyDuplex` | Hershey Duplex (Roman) | single-line | Hershey notice |
| `hersheyScript` | Hershey Script Simplex | single-line | Hershey notice |

- Outline fonts are subset once (offline, committed) to Basic Latin, Latin-1 Supplement and `° ± Ø × – — ' ' " " • €`, and committed as `.ttf` files under `packages/core/assets/fonts/`. A generator script turns each into a TypeScript module exporting its bytes (base64) so core loads them without `fs` or `fetch`. Bundled font modules are loaded with dynamic `import()` so they are only in the bundle chunk that needs them.
- Hershey fonts are committed as the original `.jhf` data, converted by the same script into compact stroke tables (per glyph: left/right bearing and polylines in Hershey units).

### 3.2 Uploaded fonts
- Accepted: `.ttf`, `.otf`, `.woff` (opentype.js parses all three). `.woff2` is refused with "WOFF2 fonts are not supported; use TTF, OTF or WOFF".
- Parsed with opentype.js from an `ArrayBuffer`. A file that fails to parse is refused at load time with "This font file can't be read".
- An uploaded font is always an outline font.

### 3.3 Font interface (core)

```ts
interface LoadedFont {
  kind: 'outline' | 'singleLine';
  unitsPerEm: number;
  capHeight: number;            // font units; from OS/2 sCapHeight, else the height of 'H', else 0.7 × unitsPerEm
  glyph(ch: string): { advance: number; outline: Path2D[] /* closed, font units */ | null; strokes: Path2D[] /* open */ | null } | null;
  kerning(a: string, b: string): number;   // font units, 0 for single-line fonts
}
```

Parsed fonts are cached by bundled id or blob id.

## 4. Layout (`core/src/text/layout.ts`)

Input: a `TextItem`, a `LoadedFont`, the job tolerance. Output: `{ shapes: Shape[] } | { strokes: Path2D[] }` in stock coordinates (mm), plus `missing: string[]` (characters not in the font) and `bounds`.

1. **Scale:** `k = size / capHeight` (mm per font unit).
2. **Lines:** split `text` on `\n`. For each line, place glyphs left to right: x advances by `advance·k + letterSpacing`, plus `kerning·k` between pairs. Spaces use the font's space advance. A character with no glyph is skipped and listed in `missing`.
3. **Stacking and alignment:** baseline of line *i* at `y = −i · lineSpacing · size`. Each line is shifted so that its advance box aligns left, centre or right within the widest line.
4. **Fit:** block width (and height, when given) measured from the ink bounds. If larger than `fit`, scale the whole block by the smaller ratio. If the resulting cap height would be below 1 mm, error `text-fit` (§5).
5. **Arc** (when `arc` is set; replaces the straight baseline):
   - Each line has its own radius: line 0 at `arc.radius`; following lines step by `lineSpacing · size`, inward for `outside`, outward for `inside`.
   - `outside`: text reads clockwise over the top of the circle, glyph tops pointing away from the centre. `inside`: text reads counter-clockwise under the bottom, glyph tops pointing toward the centre.
   - Each glyph is placed rigidly (not bent): its advance-centre goes onto the circle at the arc length of its advance-centre, rotated to the tangent. Alignment applies along the arc: `center` centres the line on the top (outside) or bottom (inside) of the circle; `left` / `right` start or end there.
   - With an arc, `position` is the circle centre and `anchor` is ignored.
   - Error `text-arc` if a line's radius ≤ size.
6. **Anchor:** without an arc, the block's ink bounding box anchor point is moved to the origin.
7. **Mirror, rotate, place:** mirror in X (if set), rotate by `angle`, translate to `position`.
8. **Flatten and union:** glyph curves are flattened at the job tolerance. Outline glyphs are unioned with clipper2 using the non-zero fill rule, so overlapping contours merge and counters become holes; the result is split into shapes (outer + holes). Single-line strokes are not unioned.
9. **Cache:** results are cached by (text item JSON, font key, tolerance). Target: < 50 ms for a 40-character single line in an outline font (core test).

## 5. Diagnostics

Text problems are reported on the text (shown on the Text panel) and, through the `text` geometry reference, on every operation that uses it (with that reference's index). Messages (verbatim):

| Code | Severity | Message |
|---|---|---|
| `font-unreadable` | error | `This font file can't be read` |
| `font-missing` | error | `The font file for {name} is missing` |
| `text-empty` | error | `{name} has no text` |
| `text-missing-glyphs` | warning | `{font} has no glyph for: {chars}` |
| `text-fit` | error | `{name} doesn't fit its box` |
| `text-arc` | error | `The arc radius of {name} is smaller than its text` |
| `text-no-stock` | error | `Text without a model needs a fixed stock size` |
| `text-single-line` | error | `{name} uses a single-line font; this operation needs closed outlines` |
| `ref-changed` | error | (existing message for a face that no longer resolves) |

`{name}` is the text item's name, `{font}` the font's display name, `{chars}` the missing characters joined without separators.

`text-no-stock` applies when the job has no model and the stock is `auto` and at least one text exists.

Which operations accept which text:
- Outline text: profile, pocket, engrave (follows the outlines), V-carve (and its clearing through the V-carve).
- Single-line text: engrave only. Every other operation gives `text-single-line`. Drill, face, chamfer and slot do not list texts in their geometry tab.

## 6. Code layout (core)

| Path | Contents |
|---|---|
| `src/text/types.ts` | `TextItem`, `FontRef`, `TextArc`, `TextSurface`, `TextAnchor`, `BundledFontId` |
| `src/text/fonts.ts` | `LoadedFont`, bundled font registry, `loadFont(ref, blobs)`, opentype.js adapter, cache |
| `src/text/hershey.ts` | Hershey stroke-table adapter |
| `src/text/layout.ts` | §4 |
| `src/text/resolve.ts` | text → resolved shapes or contours, diagnostics |
| `assets/fonts/`, `scripts/build-fonts.mjs` | committed font files and the generator |
| `src/job/commands.ts`, `defaults.ts`, `types.ts` | text commands and defaults, `Job.texts` |
| `src/io/migrations.ts`, `src/io/spon.ts` | 5→6 migration; font blobs |
| `src/cam/types.ts`, `src/cam/features/resolve.ts` | `TextRef`; resolution |

Font loading is async (dynamic import, parsing). The pipeline loads every font the job's texts reference before generating toolpaths; generation itself stays synchronous.

## 7. Web

- **Text panel** in the Setup group of the icon rail, after Origin (panel id `text`, test id `rail-text`). It lists text items in two-line rows (name; first line of text · font · size) with the ⋯ menu (Rename, Duplicate, Delete, Add operation ▸ V-carve / Engrave / Pocket — only Engrave for single-line fonts), drag reorder, and an "Add text" button (`text-add`). A problem-only status dot follows the rail rules from 4.3a.
- **Text inspector** (right side, like an operation):
  - Text (multi-line textarea, `text-content`);
  - Font (`text-font`): groups "Outline", "Single-line", "In this job", and "Load font…" which opens a file picker;
  - Size (`text-size`), Letter spacing (`text-letter-spacing`), Line spacing (`text-line-spacing`), Alignment (`text-align`);
  - Fit to box (`text-fit-on`, `text-fit-width`, `text-fit-height`);
  - Position X / Y (`text-x`, `text-y`), Anchor (3×3 picker, `text-anchor-<name>`), Angle (`text-angle`), Mirror (`text-mirror`);
  - Arc (`text-arc-on`, `text-arc-radius`, `text-arc-side`);
  - Surface (`text-surface`: Stock top / Face, with "Pick face" `text-pick-face`);
  - Buttons "Centre on stock" (`text-centre-stock`) and "Centre on face" (`text-centre-face`, shown when the surface is a face; centres the anchor on the face's outer-loop bounding-box centre).
  - Lengths use the display units and the existing numeric fields.
- **View:** each text is drawn at its surface Z as outlines (or strokes). Hover highlights; click selects (opens the inspector). Dragging a selected text moves it in XY on its surface plane, with a live preview, and commits one `updateText` on release. Texts are hidden while a toolpath simulation plays.
- **Geometry tab:** a "Texts" group lists text items for profile, pocket, engrave and V-carve; picking one adds `{ kind: 'text', textId }`.
- **Saving and loading:** `.spon` export and import carry font blobs; autosave keeps them.

## 8. MCP

New tools:
- `list_fonts` — bundled fonts (id, family, kind) and fonts in the job.
- `load_font { path }` — reads a font file from disk, stores it as a blob; returns its `blobId`.
- `add_text { ...TextItem fields, all optional }` — returns the new id.
- `update_text { id, patch }`, `remove_text { id }`.
- Existing operation tools accept `{ kind: 'text', textId }` in `geometry`.
- The MCP instructions text describes texts, fonts, the stock-coordinates rule and the fixed-stock rule.

## 9. Testing

**Core**
- Layout: cap-height scaling (an `H` is `size` tall); letter spacing; line spacing; left / centre / right alignment; fit box (width only, width and height, never scales up); all 9 anchors; rotation and mirror checked through bounds.
- Arc: every glyph's advance-centre lies on its line's radius (±0.01 mm) and its rotation matches the tangent; outside reads clockwise, inside counter-clockwise; `text-arc` error.
- Union: "O" and "B" give shapes with holes; a font with overlapping contours unions to one region per letter.
- Missing glyphs: warning lists them; the rest are laid out.
- Single-line: Hershey strokes are open, scaled, mirrored and arc-placed like outlines.
- Uploaded font: a committed test `.ttf` (OFL) loads from bytes; `.woff2` and garbage bytes are refused.
- Schema: 5→6 migration; `.spon` round trip with an uploaded font.
- Resolution: text on stock top and on a face of `stepped.stl` gives shapes at the right Z; WCS change keeps the text at the same place on the part; `text-no-stock`; `text-single-line`.
- Operations: V-carve of "SPON" in `sans` produces a toolpath with no diagnostics; golden G-code for an engraving in `hersheySans`.
- Performance: a 40-character line lays out in < 50 ms.

**MCP:** load a font, add text, V-carve it on fixed stock, export.

**e2e** (new `e2e/text.spec.ts`):
- Add text on a fixed stock with no model, edit words and size, drag it, undo the drag.
- Sign: V-carve plus clearing of a text, generate, export.
- Load a font file, save `.spon`, reload, text still renders with that font.
- Engrave single-line text on a face of `stepped.stl`.

## 10. Acceptance criteria
1. Text can be added, edited, placed (numbers and drag) and deleted in the web app and through MCP, with or without a model.
2. Every layout feature in §4 works and is covered by core tests.
3. V-carve, pocket, profile and engrave run on outline text; engrave runs on single-line text; other combinations give the §5 errors.
4. Uploaded fonts survive save, reload and `.spon` round trips.
5. No GPL code; `THIRD_PARTY_NOTICES.md` lists opentype.js, Inter, Roboto Slab and the Hershey fonts.
6. All unit suites, typecheck, build and e2e pass; existing golden G-code is unchanged.
7. The README lists text in Features and shows 4.4b done, 4.4c V-carve inlays next.
