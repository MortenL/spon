# Spon — Milestone 3.5: MCP API

**Date:** 2026-09-30
**Status:** Draft for review
**Builds on:** Milestones 1–3.2 (merged to `master`); the command and query groundwork in the Milestone 3 spec §8a

## 1. Scope

An MCP server lets Claude drive Spon: create and open jobs, import models, set orientation, stock and WCS, query geometry, manage operations, tools and posts, generate, check its own work visually, export G-code and save.

It is used in two ways, and both matter:
- **Headless.** Claude Code in a terminal works on `.spon` files on disk. The user opens the result in the browser to check it.
- **Live.** The user watches the browser tab while Claude drives the job open there. Every tool call is one undo step.

One spec covers both. Implementation happens in **two phases with two plans**:
- **Phase 1:** move the pipeline into core, the `JobSession` interface, `FileSession`, every tool, the preview renderer, the tool library file, and the stdio server. Useful on its own.
- **Phase 2:** `LiveSession`, the WebSocket bridge in the MCP process, and the bridge client in the web app.

### Out of scope
- A hosted or remote server. The server runs locally, as the user, over stdio.
- Viewport camera control, playback control, and dragging tabs by hand (tab positions can still be set through `updateOperation`).
- Rendering with three.js or WebGL in Node.
- Undo history in headless mode.
- More than one live tab at a time.

### Constraints
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs. It does not import the STEP/IGES reader; the reader is injected.
- No GPL dependencies. New dependencies, all permissive: `@modelcontextprotocol/sdk` (MIT), `zod` (MIT), `ws` (MIT), `@resvg/resvg-wasm` (MPL-2.0), `esbuild` (MIT, dev only). `occt-import-js` (LGPL-2.1, already accepted) is loaded in Node as the same unmodified WebAssembly module.
- The user's dev server on port 5173 is left alone. Tests use their own ports.

## 2. Packages and the pipeline move

### 2.1 New package `packages/mcp` (`@sponcam/mcp`)
- Depends on `@sponcam/core` plus the dependencies above.
- Core ships TypeScript source with extensionless imports, which Node cannot run directly. The server is bundled with esbuild into a single file, `packages/mcp/dist/spon-mcp.js`. `occt-import-js`'s `.wasm`, resvg's `.wasm` and the Geist font file are copied next to it.
- Registering it: `claude mcp add spon -- node <repo>/packages/mcp/dist/spon-mcp.js`.
- Scripts: `build`, `test` (vitest), `typecheck`, matching the other packages. The root `test` and `typecheck` scripts pick it up through `pnpm -r`.

### 2.2 Pipeline moved into core: `core/src/pipeline/`
The generate → post → analyse flow and the model-loading helpers currently live in the web worker and `web/src/state`. Both sessions need exactly the same behaviour, so they move to core:

| Moves to core | From | Notes |
|---|---|---|
| `runPipeline(job, geometry, ctx, cache): CamRun` | body of `generate()` in `web/src/workers/import.worker.ts` | generate → post → parse → analyse, plus the geometry catalog (cached by `[model, stock, wcs, tolerance]` as today) |
| `CamRun`, `OperationSummary`, `GeneratedFile` | `web/src/state/camTypes.ts` | The web-only types (`CamFile`, `CamPickTarget`, `InspectorTab`) stay |
| `exportProblems`, `exportFiles` | `web/src/state/export.ts` | The toast and download code stays in web |
| `ModelGeometry`, `toModelGeometry`, `suggestedUnits` | `web/src/state/geometry.ts`, `store.ts` | |
| `placementFor`, `programContext`, `programOrigin` | `web/src/state/placement.ts`, `programContext.ts` | Already pure |
| `importModel(fileName, bytes, body, loadReader)` | `web/src/workers/modelImport.ts` | The reader is injected: web passes today's `?url` loader, Node passes a loader that reads the `.wasm` through `fs` |
| `OCCT_PARAMS`, `OcctReader` | `web/src/workers/occtReader.ts` | Both loaders tessellate identically, which face references rely on. `loadOcct` itself stays in web |
| `importStep`, `defaultBody` | `web/src/state/importFlow.ts` | Used by the session's import outcome |

Rules:
- A behaviour-preserving refactor. The web worker and state modules become thin callers. The existing web unit tests and e2e tests pass without changes to their assertions (only import paths may change).
- Done in its own commits at the start of phase 1, before any MCP code.

## 3. `JobSession`

`packages/mcp/src/session.ts`. Every tool is written against this interface and nothing else knows which backend is active.

```ts
interface JobSession {
  readonly kind: 'file' | 'live';
  describe(): Promise<SessionInfo>;  // file path or tab title, dirty flag, model summary, operation count
  job(): Promise<Job>;
  /** Atomic: all commands apply, or none do. Live: one undo step. */
  apply(commands: JobCommand[], label?: string): Promise<Job>;
  importModel(input: { fileName: string; bytes: Uint8Array; units?: LengthUnit; body?: number }): Promise<ImportOutcome>;
  /** Pipeline output for the current job; cached per job version. */
  run(): Promise<CamRun>;
  catalog(): Promise<GeometryCatalog | null>;
  previewSvg(options: PreviewOptions): Promise<string>;
  /** File: writes the .spon. Live: see §6.4. Returns the absolute path written. */
  save(path?: string): Promise<string>;
  /** Returns the posted files; the tool layer writes them. Refused on errors. */
  exportGcode(): Promise<ExportOutcome>;
  importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef>;
  tools: ToolLibraryAccess;           // list, add, import (see §5)
}

type ImportOutcome =
  | { status: 'imported'; kind: ModelKind; size: Vec3; units: LengthUnit; warnings: string[] }
  | { status: 'needsUnits'; suggested: LengthUnit; size: Vec3 }        // STL/DXF with no detected units and no `units` given
  | { status: 'needsBody'; bodies: CadBodySummary[]; suggested: number } // multi-body STEP with no `body` given
  | { status: 'error'; error: string };

type ExportOutcome =
  | { ok: true; files: { name: string; text: string }[]; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };
```

- **`apply`** folds the commands over the job with `applyCommand`. If one throws `CommandError`, the job is unchanged and the error names the command: `commands[2] updateOperation: stepoverPct must be in (0, 100]`.
- **`importModel` never prompts.** It returns `needsUnits` or `needsBody` and the caller (Claude) calls again with the missing choice. STEP and IGES carry units, so they never return `needsUnits`, as in the web app. Importing a model replaces the current one with an identity orientation, as `setModel` does in the web app. Existing operations are kept; their geometry references no longer match and `generate` reports them as `ref-missing`. The `imported` outcome lists how many operations were affected, in its warnings.
- **`run` in a file session** caches the `CamRun` per job object identity, and keeps one `GenerationCache` for the session's lifetime.

### 3.1 `FileSession`
- Holds the `Job`, the blob map (model and program bytes), the `ModelGeometry`, a `GenerationCache`, the file path (null until first save) and a `dirty` flag.
- `new(options)` builds a job with the core defaults (machine preset and dialect optional). It starts dirty, with no path.
- `open(path)` reads the `.spon` with `readSpon`, re-imports the model bytes with the stored format and body (STEP/IGES through the Node reader), and builds the `ModelGeometry`. This is the same as the web app's open.
- `save(path?)` writes with `writeSpon`. Without a path it uses the current one, or fails with "This job has not been saved yet — give a path". A path without the `.spon` extension gets one added.
- There is no undo. Claude can reopen the file or issue new commands.

### 3.2 Current session
- The server holds at most one current session. It starts with none.
- `new_job` and `open_job` switch to a new file session. `use_live_tab` switches to the live tab (phase 2).
- Switching away from a dirty session is refused with "The current job has unsaved changes — save_job first, or pass discard: true". A live tab is never discarded by this: switching away from it just stops driving it.
- Any job tool with no current session returns "No job open. Use new_job, open_job or use_live_tab."

### 3.3 Paths
Tools accept absolute paths or paths relative to the server's working directory (Claude Code starts the server in the project directory). The server does not sandbox paths: it runs locally as the user. Error messages always include the resolved absolute path.

## 4. Tools

Every tool returns a short text summary plus `structuredContent` (JSON) described by an output schema. All lengths are in mm. All coordinates are in program coordinates (relative to the WCS origin), matching `describeGeometry`.

### 4.1 Geometry handles
Raw `GeometryRef`s are long and easy to mistype, so `describe_geometry` gives each catalog item a short handle:
- `F1`, `F2`, … faces, top down (catalog order);
- `F1.L0`, `F1.L1`, … loops of a face (`L0` is the outer loop);
- `H1`, … holes;
- `C1`, … DXF contours.

The session keeps a handle → `GeometryRef` map from the latest `describe_geometry` call. Tools that take geometry accept handles or full refs. `GeometryRef`s are defined in raw model coordinates, so a handle keeps pointing at the same feature after reorienting; `describe_geometry` must be called again to see the new catalog. A handle that is not in the map gives "Unknown handle F9 — call describe_geometry for the current list". Importing a model or opening a job clears the map.

### 4.2 Catalogue

| Tool | Input | Result |
|---|---|---|
| `status` | — | Session kind, path or tab title, dirty flag, model summary, operation count, whether a live tab is connected, bridge state |
| `new_job` | `{ name?, machinePreset?, dialect?, discard? }` | New file session |
| `open_job` | `{ path, discard? }` | Loaded job summary |
| `use_live_tab` | `{ discard? }` | Tab summary, or an error when no tab is connected (phase 2) |
| `save_job` | `{ path? }` | Absolute path written |
| `import_model` | `{ path, units?, body? }` | An `ImportOutcome` (§3) |
| `get_job` | `{ section?: 'operations' \| 'tools' \| 'stock' \| 'wcs' \| 'machine' \| 'post' \| 'model' }` | The whole `Job`, or one section |
| `describe_geometry` | `{ filter?: 'faces' \| 'holes' \| 'contours' }` | Catalog with handles, plus the model bounding box and stock box |
| `apply_commands` | `{ commands: JobCommand[], label? }` | Atomic batch; a summary of which job sections changed |
| `add_operation` | `{ type, tool, geometry, params?, name? }` | The new operation (one `apply` batch: `addOperation` + `updateOperation`). `tool` is a job tool id, a T number, or a library tool id (the library tool is copied into the job first with `addTool`). `geometry` is handles or refs. `params` is an `OperationPatch` |
| `generate` | — | Per operation: status, diagnostics, resolved heights. Per file: name, line count. Total cycle time, XYZ extents compared with the stock and machine travel, and the export verdict (errors and warnings) |
| `render_preview` | `{ view?: 'top' \| 'iso' \| 'front', operations?: string[], size? }` | PNG image content and a one-line caption (§5) |
| `get_gcode` | `{ file?, lines?: [from, to] }` | Posted text, at most 400 lines per call, with the total line count |
| `export_gcode` | `{ dir }` | Paths written. Refused while there are errors (listed); warnings are returned alongside the paths |
| `import_program` | `{ path }` | Adds an existing G-code file to the job's program list |
| `list_tools` | `{ query?, type?, diameter? }` | Library tools and job tools, marked by source |
| `add_library_tool` | `{ tool }` | Adds or replaces a tool in the library |
| `import_tool_library` | `{ path }` | Imports a Spon library `.json` or Fusion `.json`/`.tools` into the library; lists skipped tools |

- **`JobCommand` schema.** A hand-written zod union lives next to the `JobCommand` type in the MCP package. A type-level test checks that `z.infer` of the schema equals `JobCommand`, so the two cannot drift. Semantic validation stays in `applyCommand`.
- **Resources** (read-only): `spon://job`, `spon://catalog`, `spon://gcode/{file}`.
- **Prompt** `spon-cam-basics`: a short guide covering units and program coordinates, handles, the typical flow (import → orient → stock/WCS → describe → operations → generate → preview → export → save), and that export warnings must be relayed to the user. The same text is sent as the server's `instructions`.

### 4.3 Tool library (headless)
- The library is a file at `~/.spon/tools.json`, in the format of `exportToolLibrary` (the web app's library export). `SPON_TOOL_LIBRARY` overrides the path.
- On first use, a missing file is created from `starterLibrary`.
- Writes go to a temporary file first and are then renamed over the original.
- The user can move their browser library across once, with the web app's library export and `import_tool_library`.
- In live mode the tools act on the tab's IndexedDB library instead.

## 5. Preview rendering

### 5.1 Renderer: `core/src/preview/`
`renderPreviewSvg(input: PreviewInput, options: PreviewOptions): string`. Pure, with no DOM, so it runs in Node, in the web worker and in tests.

- **Input:** placed model (mesh or drawing), stock box, WCS origin and work offset, the `CamRun` toolpaths, operation names and statuses, and the unmachined-area overlays. Everything in program coordinates.
- **Views:** `top` (XY, default), `front` (XZ), and `iso` (fixed orthographic, 30° elevation and 45° azimuth). Plain affine projection, no hidden-line removal. Items are drawn back to front by depth.
- **Drawn:**
  - Stock: a light outline. In `iso` a wireframe box with the top face lightly filled.
  - Model: for meshes, the boundaries of planar regions plus silhouette edges, not triangles. For drawings, the paths.
  - WCS origin: a small XYZ triad with its work offset label (e.g. `G54`).
  - Toolpaths: one colour per operation from a fixed palette. Feed moves solid, rapids thin and dashed. Arcs as SVG arcs in `top` and tessellated elsewhere. Drill cycles as circles with a cross.
  - Problems: unmachined areas as red hatch. Operations with errors have a red outline in the legend.
  - A legend (operation name and colour), a scale bar, and bounding dimensions in display units.
- **Size:** 1024 px on the long edge by default, at most 2048. Line widths are in pixels, so any part size stays readable.
- **Performance:** consecutive collinear feed moves are merged, and paths are decimated to about 0.5 px. Target: under 500 ms and a PNG under about 300 KB for a job with 100,000 moves.

### 5.2 Rasterising: `packages/mcp/src/raster.ts`
- Loads `@resvg/resvg-wasm` once and converts the SVG to PNG.
- resvg-wasm has no system fonts, so the Geist font (`@fontsource-variable/geist`, OFL-1.1, already shipped by the web app) is passed in as the only font.
- Returned as MCP `image` content (`image/png`).
- In live mode the tab's worker renders the SVG and the server rasterises it, so Claude sees the same picture in both modes.

## 6. Live bridge (phase 2)

### 6.1 Server side: `packages/mcp/src/live/`
- When the MCP process starts, it also listens on `ws://127.0.0.1:5197`, loopback only. `--port` or `SPON_BRIDGE_PORT` changes the port.
- If the port is in use (for example a second Claude session), the server runs file-only. `status` reports "live bridge unavailable: port 5197 in use".
- **Origin allow-list:** `http://localhost` and `http://127.0.0.1` on ports 5173, 4173, 5198 and 5199, plus any origins in `SPON_ALLOWED_ORIGINS` (comma-separated). Other origins, and connections without an `Origin` header, are refused. No token is used: browsers always send a truthful `Origin`, and anything that can forge one is already a local process with the user's access.

### 6.2 Protocol
- JSON-RPC 2.0 over the socket.
- On connect the tab sends `hello { protocol: 1, app: <version>, title: <job name> }`. A protocol mismatch closes the connection with a clear message on both sides.
- One method per `JobSession` operation: `job`, `apply`, `importModel`, `run`, `catalog`, `previewSvg`, `save`, `exportGcode`, `importProgram`, `tools.list`, `tools.add`, `tools.import`. The tab also sends a `jobChanged` notification with the new title and dirty flag when they change.
- Bytes travel as base64 strings.
- Timeouts: 60 s per request, 300 s for `importModel` (large STEP files). On timeout the tool fails with "The tab did not answer within 60 s".
- If the socket closes during a request, that request fails with "Tab disconnected". If the live tab was the current session, the current session becomes none.

### 6.3 One tab at a time
- A tab reconnecting automatically only takes the slot when it is free.
- An explicit Connect click takes over. The previous tab is told and shows "Disconnected — another tab took over".

### 6.4 Tab side: `packages/web/src/bridge/`
- **Client:** connects with backoff (1 s up to 10 s) while enabled. "Enabled" is remembered in `localStorage` (read and written in try/catch). Requests are handled one at a time, in order. The bridge module is loaded lazily and does nothing until enabled, so the app is unchanged for anyone who never connects.
- **Handlers:**
  - `apply` → a new store action, `dispatchBatch(commands, label)`: one `commit` folding every command, so one undo step. `CommandError` leaves the job unchanged.
  - `importModel` → `importModelBytes` with the given units and body, skipping the units and body dialogs; returns the same `ImportOutcome` shape.
  - `run` → waits until `camStatus` is `idle` for the current job, then returns the current output as a `CamRun`.
  - `catalog`, `previewSvg` → computed in the worker from the current job and geometry.
  - `save` → without a path, writes through the tab's file handle, or fails with "This tab has no file yet — give a path". With a path, the tab returns `writeSpon` bytes, the server writes them, and the tab marks itself saved (without a file handle).
  - `exportGcode` → the core `exportProblems` / `exportFiles` on the current output; the server writes the files.
  - `tools.*` → the IndexedDB library functions in `web/src/state/toolLibrary.ts`.
- **Status bar:** a "Claude" item showing off, connecting or connected. Clicking toggles it.
- **Toasts:** each applied batch shows a short toast, "Claude: <label>". The label is the one passed to `apply_commands`, or generated by the tool (for example "Add Pocket on F3").
- **Simultaneous edits:** no locking. Commands apply to the job as it is when they arrive; stale ids fail with `CommandError`, which Claude sees; the user can undo anything. Importing a model starts a new undo history, as it already does in the app, and the `import_model` result says so.

## 7. Errors

- Tool failures are MCP results with `isError: true` and a message Claude can act on. They are never thrown as protocol errors.
- `CommandError` messages carry the command index and type (§3).
- Import failures pass on the core message ("Could not load the STEP reader: …", "Not a Spon job file (invalid zip)", "No solid bodies found").
- Unknown handles, missing sessions, dirty-session switches and missing tabs have the fixed messages given in §3–§6.
- Filesystem errors include the resolved absolute path.
- Export uses the web app's rules: errors block and are listed; warnings do not block, are returned, and the server instructions tell Claude to relay them to the user.
- Logging goes to stderr only, because stdout carries the stdio protocol. `SPON_MCP_LOG=debug` turns on request-level logging.

## 8. Testing

**Core (Vitest)**
- `runPipeline`: golden results on the existing DXF, STL and STEP fixtures (operation summaries, file names, posted text).
- `exportProblems` / `exportFiles`: the existing web tests move to core.
- `importModel` with a Node reader: the recorded STEP/IGES fixtures give the same face ids as the web recordings.
- `renderPreviewSvg`: structural checks (legend has the operation names, one group per operation, rapids dashed, viewBox fits the stock, decimation caps the element count on a large synthetic job) for each view.

**MCP (Vitest)**
- `FileSession`: new → import → commands → run → save → reopen gives an equal job and identical posted G-code.
- Every tool, through the SDK's in-memory client/server transport: happy paths and the main error paths (unknown handle, atomic rollback, `needsUnits`, `needsBody`, export refused on errors, dirty session refusing to switch, no session).
- The `JobCommand` zod schema: the type-level equality test, and every command in the core command tests round-trips through the schema.
- Rasterising: one PNG snapshot per view (resvg is deterministic).
- Tool library: first-run seeding, atomic write, Fusion import.
- End to end: spawn `dist/spon-mcp.js` over real stdio and run the Milestone 3 acceptance flow (DXF fixture → profile with tabs + pocket + drill → GRBL → export). The exported files parse with zero interpreter errors.

**Bridge (phase 2)**
- A fake tab (a Node `ws` client) against `LiveSession`: origin refusal, missing origin, takeover, timeout, disconnect during a request, protocol mismatch.
- Web unit tests for the bridge handlers against a real store: `dispatchBatch` is one undo step and all-or-nothing; `run` waits for the pipeline.
- Playwright: start the MCP server with its bridge on port 5196, enable the bridge in the tab, call `add_operation` through an MCP client, check that the operation appears in the panel, that Ctrl+Z removes it, and that `render_preview` returns a PNG.

**Licences**
- `THIRD_PARTY_NOTICES.md` lists the new runtime dependencies.
- A check confirms that no GPL licence appears in `packages/mcp`'s production dependency tree.

## 9. Acceptance criteria

1. From Claude Code, the request "take part.dxf, profile the outline with tabs, pocket the island, drill the holes, post for GRBL" produces a `.spon` and `.nc` files. The `.spon` opens in the browser and looks the same, and the browser posts identical G-code.
2. The same works for an STL model and for a multi-body STEP file (after `needsBody`).
3. Claude calls `render_preview` and can describe the toolpaths it sees, including a wrongly placed operation.
4. The headless tool library works from `~/.spon/tools.json`, including a Fusion import.
5. With the tab connected, the same requests visibly drive the open job. Each tool call is one Ctrl+Z. Closing the tab makes the tools report it cleanly, and headless use keeps working.
6. The web app's existing unit and e2e tests pass after the pipeline move, and nothing changes for users who never enable the bridge.
