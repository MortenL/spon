# Spon — Milestone 4.1: SVG import, LinuxCNC tool tables and open-line sides

**Date:** 2026-10-01
**Status:** Draft for review
**Builds on:** Milestones 1–3.5 (merged to `master`). Milestone 4 is split into sub-milestones; this is the first.

## 1. Scope

Milestone 4 (recorded in the Milestone 3 spec §13) is split into five sub-milestones, each with its own spec, plan and implementation:

| | Contents |
|---|---|
| **4.1 Inputs (this spec)** | SVG import, LinuxCNC `tool.tbl` import, and profile sides for open lines |
| 4.2 Simple 2.5D operations | Facing, chamfer, slot |
| 4.3 Engrave and V-carve | Engraving along paths, variable-depth V-carving |
| 4.4 Thread milling | Helical thread milling and its post support |
| 4.5 Auto-suggest | Operation suggestions from slicing at flat levels |

4.1 delivers three things:
- **SVG import.** SVG files from Inkscape, Illustrator, Affinity, CAD sketch exports and downloaded artwork open as 2D drawings, exactly like DXF files. Every 2D operation, geometry handle and MCP tool works with them unchanged.
- **Open-line sides.** A profile can cut to the left or right of an open line, not only on it.
- **LinuxCNC tool tables.** A `tool.tbl` file imports into the tool library.

### Out of scope
- SVG text (it must be converted to paths first), embedded images, clip paths, masks, filters, patterns and gradients. They are skipped with a warning.
- Stroke width. Spon machines the path itself (its centre line), whether the shape is filled or stroked.
- Exporting `tool.tbl`. Exporting SVG.
- A scale command for an already imported model.

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs. The SVG reader runs in the web import worker and in the MCP server (Node), and neither has `DOMParser`.
- No new runtime dependencies. No GPL dependencies.
- Stored lengths are mm. Job changes go through `core/src/job/update.ts` / commands and the store's `commit()`.
- The user's dev server on port 5173 is left alone.

## 2. SVG reader: `core/src/import/svg/`

A pure reader that turns SVG text into a `Drawing` (layers of `Path2D`), the same structure DXF produces.

| File | Responsibility |
|---|---|
| `xml.ts` | A small XML tokenizer producing an element tree: elements, attributes (with namespaces as written, e.g. `inkscape:label`), the five predefined entities and numeric character references, CDATA, comments, processing instructions and the doctype (skipped). Malformed XML fails with "Not a valid SVG file: <reason> at line <n>". |
| `style.ts` | Resolves `fill`, `stroke`, `display`, `visibility` and `opacity` for each element. Precedence, lowest first: inherited from the parent, presentation attributes, `<style>` rules, the inline `style` attribute. `<style>` supports type, `.class`, `#id` and comma-separated selector lists; other selectors are ignored. Colours are normalised to `#rrggbb` (named colours, `#rgb`, `rgb()`); `none`, `transparent` and anything unrecognised count as "no colour". |
| `transform.ts` | Parses `matrix`, `translate`, `scale`, `rotate` (with an optional centre), `skewX` and `skewY`, and composes nested transforms. It reuses `Affine2D` from the DXF importer. |
| `pathData.ts` | Parses the full path `d` grammar: M, L, H, V, C, S, Q, T, A and Z, absolute and relative, with implicit repeated commands, compact number forms (`1.5.5`, `1e-3`) and the arc flags written without separators (`a1 1 0 011 1`). A parse error keeps the subpaths read so far and adds a warning naming the element id. |
| `shapes.ts` | Converts `path`, `rect` (including `rx`/`ry`), `circle`, `ellipse`, `line`, `polyline` and `polygon` to geometry. It expands `use` (referring to `symbol` or any element, with `x`/`y`), and skips `defs` content except through `use`. |
| `units.ts` | Works out the scale from mm to SVG user units (§2.2). |
| `svg.ts` | `parseSvg(text, options): SvgImport`. It walks the tree, applies styles and transforms, builds the layers (§2.3) and collects warnings. |

### 2.1 Geometry
- The output is in mm with Y flipped. SVG's Y points down; the drawing's Y points up, so the drawing looks the way the file does on screen. The flip is about the `viewBox` (or the content box when there is none), so the drawing's minimum corner keeps its place.
- Straight segments stay straight.
- **Circular arcs and circles stay true arcs** when the element's full transform is a similarity (uniform scale, rotation, translation and mirroring, checked with `isSimilarity`). Otherwise they are flattened.
- **Béziers** (C, S, Q, T) and **elliptical arcs** (or circular arcs under a non-uniform transform) are flattened with `flattenCurve` at the DXF chord tolerance (`DEFAULT_CHORD_TOLERANCE`, 0.01 mm), then refitted to lines and arcs with `fitArcs` within the same tolerance. Toolpaths therefore stay smooth.
- A subpath ending in Z, or one whose end meets its start within the drawing tolerance, is closed. Every other subpath is open.
- The total segment count is capped like DXF (`MAX_DXF_SEGMENTS`). Going over it fails with the same "too complex" message.

### 2.2 Scale
- **The root has absolute units.** When the root `width` or `height` is in mm, cm, in, pt or pc, the scale comes from that length and the `viewBox`. The import needs no prompt; `detectedUnits` is set to mm.
- **The root has px or unitless sizes, or none.** The scale must be chosen:
  - 96 dpi (CSS, Inkscape and Affinity), the default;
  - 72 dpi (Illustrator);
  - "width = ___ mm": the scale that makes the drawing's content width equal to the given value.
- The chosen scale is stored as **one number**, `svgScale` (mm per SVG user unit), on the model (§5). Reopening a job, or re-reading the model, reproduces the drawing exactly. This works the way the chosen body does for STEP files.
- `parseSvg` takes `{ svgScale?: number }`. Without it, a file that needs a choice returns `needsScale` with the raw content size in user units (§3).
- A non-uniform `viewBox` aspect (`preserveAspectRatio="none"`) is honoured; the default `xMidYMid meet` is applied when the root size and the `viewBox` aspect differ.

### 2.3 Layers
- **Inkscape layers.** When the file has any `<g inkscape:groupmode="layer">`, each one becomes a layer named by its `inkscape:label` (or its id). Sublayers are named `Parent/Child`. Shapes outside every layer go to a layer named `0`.
- **Otherwise, by colour.** There is one layer per stroke colour, or per fill colour when an element has no stroke. The layer is named after its colour (`#ff0000`) and drawn in that colour. Shapes with neither go to a layer named `0`.
- Layer colour, used to draw the layer in the viewport: the label's group colour where Inkscape gives one, else the most common stroke or fill colour on the layer, else white, as for DXF.
- Hidden elements (`display:none`, `visibility:hidden`, or a hidden layer) are skipped. Elements with `opacity:0` are still read; artwork often uses them as cut guides.

### 2.4 Warnings
Each kind of skipped content gives one warning with a count. Examples:
- "3 text elements were skipped — convert text to paths before exporting"
- "1 embedded image was skipped"
- "Clip paths and masks were ignored; the full shapes were imported"

Unknown elements in other namespaces (Inkscape and Sodipodi metadata) are ignored silently.

## 3. Import flow

- `ModelFormat` gains `'svg'`, and `fileKind('x.svg')` is `'drawing'`. `importFile` reads SVG directly (no reader to load, like DXF). The web app's Open dialog and drop zone accept `.svg`.
- `ImportResult` for a drawing carries `svgScale` when the file decided it. It gains an outcome for SVGs that need a scale: `{ ok: true; kind: 'needsScale'; rawSize: Vec2 }` (content size in user units).
- `importModel(fileName, bytes, options)` takes an options object instead of the `body` argument: `{ body?: number; svgScale?: number }`. All callers move to the options object.
- `importStep` and `decideImport` turn `needsScale` into the new `ImportOutcome` `{ status: 'needsScale'; rawSize: Vec2; suggestedDpi: 96 }`.
- **Web units dialog.** For an SVG, the dialog offers 96 dpi, 72 dpi and "width ___ mm", and shows the resulting size for each. Confirming re-reads the file with the chosen `svgScale`.
- **MCP.** `import_model` gains `svgDpi` (96 or 72) and `svgWidth` (mm). A file that needs a scale answers `needsScale`, and the tool text explains both options. The live bridge's `importModel` request carries the same fields.

## 4. Open-line sides

### 4.1 Job model
- `ProfileOp` gains `openSide: 'left' | 'on' | 'right'` (default `'on'`). `side` stays `'outside' | 'inside' | 'on'` and applies to closed contours. One operation may hold both closed and open contours, so it carries both settings.
- `DxfPathRef` gains `reverse?: true`. An open chain runs in the drawn direction of its first reference, and `reverse` on that reference flips the chain. It has no effect on closed contours or on references inside a chain.
- **Schema.** The job schema version goes up by one. The migration adds `openSide: 'on'` to every profile operation. Old jobs therefore behave exactly as before.
- `updateOperation` accepts `openSide`, and accepts `reverse` inside geometry references. The MCP zod schemas follow, and the type-level equality test still holds. Geometry handles accept a trailing `!` for a reversed reference (`C3!`).

### 4.2 Cutting
- The offset side is the **waste** side. The line is the edge of the part that is kept.
  - `left`: the tool centre runs at tool radius + `stockRadial` to the left of the chain's direction.
  - `right`: the same distance to the right.
  - `on`: unchanged.
- **Travel direction** follows `direction`, assuming a clockwise (M3) spindle. Climb keeps the cut edge on the tool's right.
  - `left` + climb runs in the chain's direction.
  - `right` + climb runs against it.
  - Conventional swaps both.
- The offset uses the existing arc-preserving offset machinery for open polylines. Where the radius is too large for a tight bend, the self-intersecting loop is trimmed, and the operation gets a warning: "The tool is too large for a bend in this line; the bend was rounded".
- Ramping, leads, the finish pass and stepdowns work as they do for open chains on the line today. Leads apply at the two ends, on the waste side. Tabs remain closed-contour only.
- `side: 'inside'` or `'outside'` with only open contours keeps the `open-contour` error, with the message "Open chains: use left, on or right (Open side)". Pockets still need closed contours.

### 4.3 Web UI
- **Passes tab.** "Side" shows inside, on and outside when the operation has closed contours, and "Open side" shows left, on and right when it has open chains.
- **Geometry tab.** Each open chain has a "Reverse" toggle.
- **Viewport.** It draws a direction arrow on each selected open chain, so left and right are visible before generating.

## 5. Model reference

- `ModelRef.format` gains `'svg'`. `ModelRef` gains `svgScale?: number`, which is required when `format` is `'svg'`. `modelFilePath` and `modelSummary` know SVG.
- `newModelRef` copies `svgScale` from the geometry's source. Re-reading the model (opening a job, restoring autosave, the MCP `FileSession.open`) passes `svgScale` back to `importModel`.
- SVG contours use the existing drawing reference (`DxfPathRef`: layer index and path index). Handles (`C1`, …) and the catalog therefore work with no changes.

## 6. LinuxCNC tool tables: `core/src/tools/linuxcnc.ts`

`parseLinuxCncToolTable(text, units: LengthUnit): { tools: Tool[]; skipped: { line: number; reason: string }[]; guesses: string[] }`

**Parsing:**
- One tool per line. A line has words (`T<int>`, `P<int>`, `D<number>`, `X Y Z A B C U V W I J Q <number>`) in any order, case-insensitive, then an optional `;comment`.
- Blank lines and lines starting with `;` are skipped silently.
- A line without `T` or `D`, or with `D ≤ 0`, is skipped with its line number and the reason.
- A repeated T number keeps the first line and skips the rest.

**Building each tool:**
- **Units.** Lengths are converted from `units` to mm.
- **Id.** The id is `linuxcnc-T<n>`, so re-importing an edited table updates the same tools.
- **Name.** The name is the trimmed comment, or `T<n> ⌀<d>` (in the table's units) when there is none.
- **Type**, guessed from the comment (case-insensitive, first match wins):
  1. `drill` or `bohr` → drill, 118°.
  2. `chamfer` or `fase` → chamfer, 90° unless an angle is given.
  3. `v-bit`, `vbit`, `engrav`, or a standalone `V` with an angle such as `V60`/`60°` → vbit with that angle (default 60°).
  4. `ball` → ball (corner radius = diameter / 2).
  5. `bull`, or `R<number>` → bull with that corner radius (in the table's units).
  6. Otherwise → flat.
- **Other fields.** Flutes 2; flute length 3 × diameter; stickout 4 × diameter; no presets. A tool without a preset already warns that its feeds need to be set.
- **Guesses.** Every guessed type is listed, e.g. "T3 Spiralbohrer 5: type guessed as drill".

**Merging into the library:**
- Unlike a Fusion import, the **table's T numbers win**: they must match the machine.
- A library tool that holds a T number from the table and is not the same tool (a different id) is renumbered to the next free number, and the result says so ("Starter 6 mm flat moved from T3 to T21").
- This is a new `mergeToolTable` next to `mergeToolLibrary`, which keeps its current rule.

**Where it is used:**
- **Web.** The tool library dialog's import accepts `.tbl`. It first asks mm or inch, suggesting inch when every diameter is under 1. Then it shows the result: added, updated, renumbered, skipped and guessed.
- **MCP.** `import_tool_library` gains `units` ('mm' or 'in'), required for `.tbl`. Without it, the tool fails with "A LinuxCNC tool table has no units — call import_tool_library again with units: \"mm\" or \"in\"". In live mode it acts on the tab's library through the bridge's `tools.import`, which gains the same `units` field.

## 7. Errors

- An SVG with no drawable geometry (only text or images, for example) fails with "No shapes found in this SVG" plus the warnings that explain why.
- An SVG that is not valid XML fails with the line number. A file that is valid XML but has no `<svg>` root fails with "Not an SVG file".
- `tool.tbl` with no usable lines fails with "No tools found in this tool table".
- The MCP server and the live bridge pass these messages through unchanged.

## 8. Testing

**Core (Vitest)**
- XML tokenizer: entities, CDATA, comments, attributes with namespaces, malformed input with line numbers.
- Path data: every command, absolute and relative, implicit repeats, compact numbers and arc flags. Each is checked against hand-computed end points.
- Transforms: each function and nesting; similarity detection, so that circles stay arcs and become flattened curves under skew.
- Styles: precedence and inheritance, `<style>` class and id rules, colour normalisation.
- Fixtures, each checked for layer names, size in mm, the number of open and closed paths, the arc count and warnings:
  - Inkscape (mm root, nested layers, Béziers, a hidden layer);
  - Illustrator (px root at 72 dpi, `<style>` classes, layers as groups);
  - Affinity-style;
  - CAD-style (lines and arcs only);
  - web artwork (px, fills only, nested transforms, `use`/`symbol`, text and an image that must be skipped with warnings).
- Scale: an absolute-unit root needs no choice; a px root returns `needsScale` with the raw size; 96 dpi, 72 dpi and a target width give the expected sizes; `svgScale` round-trips through `ModelRef`.
- Open sides: an L-shaped line and an S-curve with left, right and on × climb and conventional × reverse. Each case is checked for the tool-centre offset distance, which side it is on and the travel direction. A tight bend with a large tool trims and warns. A migration test checks that old jobs get `openSide: 'on'` and post identical G-code.
- `tool.tbl`: parsing (word order, case, comments, skipped lines with line numbers, duplicate T numbers), inch conversion, each type guess, `mergeToolTable` renumbering the clashing library tool, and stable ids on re-import.

**MCP (Vitest)**
- `import_model` on a px SVG: `needsScale`, then `svgDpi: 96` → imported. Then `describe_geometry` → `add_operation` profile with `openSide: 'right'` on a reversed handle (`C2!`) → `generate` with no errors.
- `import_tool_library` on a `tool.tbl`: without units it gives the message; with units it gives the tools and the renumbering notes.
- Save and reopen a job with an SVG model: identical catalog and posted G-code.

**Web**
- Unit tests: the units dialog's SVG scale options compute the right sizes; the Passes tab shows Side and Open side depending on the operation's contours.
- Playwright:
  - drop the Inkscape fixture (no prompt), add a profile on an open line with Open side right, and see the arrow and a generated toolpath;
  - drop the web-artwork fixture, choose 96 dpi, and check the size shown;
  - import a `tool.tbl` in inches and see the tools in the library with their T numbers.

## 9. Acceptance criteria

1. SVGs from Inkscape, Illustrator, Affinity, a CAD sketch export and downloaded artwork open with the right size, sensible layers and clear warnings for skipped content. Profile, pocket and drill work on them as on DXF.
2. A px-based SVG asks for 96 dpi, 72 dpi or a width, in the web app and through MCP. The job reopens at the same size.
3. A profile cuts to the left or right of an open line, in the direction set by climb or conventional and the reverse toggle. The viewport shows the direction.
4. A LinuxCNC `tool.tbl` imports in mm or inches with its T numbers kept, guessed types are listed, and re-importing updates the same tools.
5. Existing jobs, tests and G-code are unchanged (the migration only adds `openSide: 'on'`).
