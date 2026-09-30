# Third-party notices

## occt-import-js 0.0.23 (LGPL-2.1)

Spon reads STEP and IGES files with [occt-import-js](https://github.com/kovacsv/occt-import-js), a WebAssembly build of
Open CASCADE Technology (LGPL-2.1 with the Open CASCADE exception). Both are distributed under the GNU Lesser General Public
License 2.1. Their license texts ship with the app and are served at `/licenses/license.occt-import-js.txt` and
`/licenses/license.occt.txt`.

The WebAssembly module (`occt-import-js.wasm`) ships unmodified, as its own file. The Emscripten JavaScript glue that
loads it is unmodified in function, but is bundled and minified by Vite into its own lazily loaded chunk, alongside the
rest of Spon's code; neither file is downloaded unless a STEP or IGES file is opened.

To relink against a different build of the library: change the `occt-import-js` dependency version in
`packages/web/package.json` and rebuild Spon, or replace the package under `node_modules/occt-import-js` with your own
build of the same interface before building. That rebuild-and-bundle step is the practical relinking route for a
library that ships bundled into a web app.

## Spon MCP server (`packages/mcp`)

The MCP server loads these packages from `node_modules` at run time; none of them is modified or bundled into
`dist/spon-mcp.js`:

- **@modelcontextprotocol/sdk** (MIT) and its dependencies (MIT/ISC/BSD-style).
- **zod** (MIT).
- **@resvg/resvg-wasm** 2.6.2 (MPL-2.0), unmodified; source at https://github.com/yisibl/resvg-js.
- **occt-import-js** 0.0.23 (LGPL-2.1), the same package the web app uses (see above), loaded unmodified with its own
  WebAssembly file. To use a different build, replace `packages/mcp/node_modules/occt-import-js` or change the
  pinned version in `packages/mcp/package.json` and reinstall.

The preview font **Geist Regular** (SIL Open Font License 1.1) is included as `packages/mcp/assets/Geist-Regular.ttf`,
with its licence in `packages/mcp/assets/OFL.txt`.
