# Third-party notices

## occt-import-js 0.0.23 (LGPL-2.1)

Spon reads STEP and IGES files with [occt-import-js](https://github.com/kovacsv/occt-import-js), a WebAssembly build of
Open CASCADE Technology (LGPL-2.1 with the Open CASCADE exception). Both are distributed under the GNU Lesser General Public
License 2.1; see `packages/web/node_modules/occt-import-js/dist/license.occt-import-js.txt` and `license.occt.txt`.

Spon ships the library unmodified, as a separate module (`occt-import-js.js` plus `occt-import-js.wasm`) that is only
downloaded when a STEP or IGES file is opened. You may replace those two files with your own build of the same interface.
