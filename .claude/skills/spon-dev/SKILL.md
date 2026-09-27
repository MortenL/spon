---
name: spon-dev
description: How to build, test and verify the Spon CAM tool (pnpm monorepo with @sponcam/core and @sponcam/web). Use before running tests, typechecking, building, running Playwright, regenerating fixtures, or when unsure which command verifies a change.
---

# Spon development workflow

Spon is a browser-only CAM tool: `packages/core` (framework-free TypeScript: units, geometry, STL/DXF import, job model, `.spon` IO) and `packages/web` (Vite + React + react-three-fiber app).

Authoritative docs:
- Spec: `docs/superpowers/specs/2026-09-27-cam-foundation-import-setup-design.md`
- Plan: `docs/superpowers/plans/2026-09-27-spon-milestone-1-foundation.md`

## Commands (run from the repo root)

| Goal | Command |
|---|---|
| Install | `pnpm install` |
| Core tests | `pnpm --filter @sponcam/core test` (focused: append a file-name filter, e.g. `test dxf`) |
| Web unit tests | `pnpm --filter @sponcam/web test` |
| Typecheck everything | `pnpm typecheck` |
| Build the app | `pnpm build` |
| Dev server | `pnpm dev` → http://localhost:5173 |
| End-to-end (Playwright) | `pnpm e2e` (first time: `pnpm --filter @sponcam/web exec playwright install chromium`) |
| Regenerate e2e fixtures | `node packages/core/test/fixtures/make-fixtures.mjs` |

Before claiming a change works: run the focused tests for the files you touched, then `pnpm typecheck && pnpm test` once. UI changes also need `pnpm build`, and user flows need `pnpm e2e`.

## Rules that are easy to break

- `@sponcam/core` must not import React, three.js or DOM-only APIs (its tsconfig lib is `ES2022` + `WebWorker`).
- Stored lengths are mm, stored angles degrees; convert only at the UI boundary (`formatLength` / `parseLength`).
- Job changes go through pure functions in `core/src/job/update.ts` and the store's `commit()` so undo works.
- TypeScript runs with `verbatimModuleSyntax`: use `import type` for type-only imports.
- Commits end with the `Co-Authored-By:` trailer the session specifies.
- Windows dev machine: commands must work in Git Bash and PowerShell; the repo normalises to LF via `.gitattributes`.
