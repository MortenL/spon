---
name: spon-dev
description: How to build, test and verify the Spon CAM tool (pnpm monorepo with @sponcam/core, @sponcam/web and @sponcam/mcp). Use before running tests, typechecking, building, running Playwright, regenerating fixtures, or when unsure which command verifies a change.
---

# Spon development workflow

Spon is a browser-only CAM tool: `packages/core` (framework-free TypeScript: units, geometry, STL/DXF import, job model, `.spon` IO), `packages/web` (Vite + React + react-three-fiber app) and `packages/mcp` (the MCP server; Node, stdio).

Authoritative docs:
- Spec: `docs/superpowers/specs/2026-09-27-cam-foundation-import-setup-design.md`
- Plan: `docs/superpowers/plans/2026-09-27-spon-milestone-1-foundation.md`

## Commands (run from the repo root)

| Goal | Command |
|---|---|
| Install | `pnpm install` |
| Core tests | `pnpm --filter @sponcam/core test` (focused: append a file-name filter, e.g. `test dxf`) |
| Web unit tests | `pnpm --filter @sponcam/web test` |
| MCP tests | `pnpm --filter @sponcam/mcp test` (the stdio test builds the bundle first) |
| Build the MCP server | `pnpm mcp:build` → `packages/mcp/dist/spon-mcp.js` |
| Register it with Claude Code | `claude mcp add spon -- node <repo>/packages/mcp/dist/spon-mcp.js` |
| Typecheck everything | `pnpm typecheck` |
| Build the app | `pnpm build` |
| Dev server | `pnpm dev` → http://localhost:5173 |
| End-to-end (Playwright) | `pnpm e2e` (first time: `pnpm --filter @sponcam/web exec playwright install chromium`) |
| Live bridge (dev) | run the MCP server, open http://localhost:5173 and click **Claude** in the status bar (port 5197; `--port` / `SPON_BRIDGE_PORT` to change) |
| Regenerate e2e fixtures | `node packages/core/test/fixtures/make-fixtures.mjs` |

Import fixtures: STL/DXF in `packages/core/test/fixtures/`, SVG files (Inkscape mm, Illustrator px, etc.) in `packages/core/test/fixtures/svg/`, and the LinuxCNC `tool.tbl` sample in `packages/core/test/fixtures/tool.tbl`. `e2e/inputs.spec.ts` drives SVG import, open-line sides and tool.tbl import. `stepped.stl` (a 60×40×10 slab with a 20×20×10 boss, no units) is built by `make-fixtures.mjs` from `steppedData.mjs`; `e2e/face-chamfer.spec.ts` uses it for the gouge check. `slot-plate.stl` and `slot-lines.dxf` are built by `make-fixtures.mjs` from `terraced.mjs`; `e2e/slots.spec.ts` and the MCP tests use them. `vcarve-spon.svg` (letters S, P, O, N with holes, in a `LETTERS` layer, 200 × 60 mm) and `engrave-lines.dxf` (two lines and a square on layer `ENGRAVE`) are also built by `make-fixtures.mjs`; `e2e/vcarve.spec.ts` uses them. `TestSans.otf` (a tiny font with only H, O, A and V, built by `make-fixtures.mjs` from `testFontData.mjs`, which `testFont.ts` re-exports for unit tests) is the upload fixture of `e2e/text.spec.ts`. The bundled text fonts (`packages/core/src/text/bundled/*.ts`) are generated and committed: regenerate them with `pnpm --filter @sponcam/core build:fonts`.

e2e tests reach the left panels through `openPanel(page, id)` in `e2e/helpers.ts` (ids: model, orientation, stock, origin, text, operations, post, programs), and Machine settings through the `machine-open` button.

Inlays (milestone 4.4c): `packages/core/test/inlay-fit.test.ts` (3 mm clearing) and `inlay-fit-6mm.test.ts` (6 mm clearing) prove the plug fits the pocket, with the cases in `packages/core/test/fixtures/inlayFit.ts` and the sweep helpers in `fixtures/sweep.ts`; `vplug.test.ts` holds the golden G-code of a rectangle plug (`fixtures/vplug-rectangle.nc`); `packages/web/e2e/inlay.spec.ts` drives Make inlay… and Update inlay (it removes the File System Access pickers so the download and file-input fallbacks run, and accepts the discard confirmation when opening the plug job).

Before claiming a change works: run the focused tests for the files you touched, then `pnpm typecheck && pnpm test` once. UI changes also need `pnpm build`, and user flows need `pnpm e2e`.

## Rules that are easy to break

- The root `README.md` is kept current: a change that adds, removes or changes a user-visible feature, a command, a package or a milestone's status updates the README in the same branch (Features, Getting started, Development or Status and roadmap).
- `@sponcam/core` must not import React, three.js or DOM-only APIs (its tsconfig lib is `ES2022` + `WebWorker`).
- Stored lengths are mm, stored angles degrees; convert only at the UI boundary (`formatLength` / `parseLength`).
- Job changes go through pure functions in `core/src/job/update.ts` and the store's `commit()` so undo works.
- TypeScript runs with `verbatimModuleSyntax`: use `import type` for type-only imports.
- The MCP server must never write to stdout (it carries the protocol): log with `log`/`debugLog` from `packages/mcp/src/log.ts`.
- Tool failures are `isError` results thrown as `SessionError`/`CommandError` inside `guarded`, never protocol errors.
- MCP tests start bridges on port 0 and Playwright uses 5196: never bind 5197 in tests (the user's own Claude session may hold it).
- The web bridge client (bridge/client.ts, handlers.ts, controller.ts) must only be reached through import(): the main bundle stays unchanged for users who never connect.
- Bridge wire types live in core/src/bridge/protocol.ts; change them on both ends together and bump BRIDGE_PROTOCOL when a change is not backwards compatible.
- Commits end with the `Co-Authored-By:` trailer the session specifies.
- Windows dev machine: commands must work in Git Bash and PowerShell; the repo normalises to LF via `.gitattributes`.
