# Spon MCP server

Lets Claude (or any MCP client) create and edit Spon jobs on disk: import STL, STEP, IGES, DXF and SVG models, pick geometry,
add profile, pocket, drill, face, chamfer, slot, engrave, V-carve and V-carve clearing operations, generate, preview, export G-code and save `.spon` files that open in the web app.

## Build and register

From the repo root:

    pnpm install
    pnpm mcp:build
    claude mcp add spon -- node <repo>/packages/mcp/dist/spon-mcp.js

The server runs from inside this checkout: its npm dependencies (including the unmodified LGPL `occt-import-js`
reader) load from `packages/mcp/node_modules`. Relative paths in tool calls resolve against the directory Claude Code
starts the server in.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SPON_TOOL_LIBRARY` | `~/.spon/tools.json` | The tool library file (the web app's library export format). Created with the starter tools on first use. |
| `SPON_BRIDGE_PORT` | `5197` | The live bridge port (also `--port <n>`). |
| `SPON_ALLOWED_ORIGINS` | — | Extra comma-separated origins allowed to connect to the live bridge. |
| `SPON_MCP_LOG` | — | `debug` logs every tool call to stderr. |

To use your browser tool library headless, export it from the web app's tool library dialog and call
`import_tool_library` with the file. It also reads LinuxCNC `tool.tbl` files (pass `units: "mm"` or `"in"`).
Geometry handles take a trailing `!` (`C3!`): a `!` on any of an open line's handles reverses the whole line (it otherwise runs in its first handle's drawn direction), which swaps its left and right for `openSide`.

Facing and chamfers: `add_operation` with `type: "face"` takes an empty `geometry` list to face the whole stock, which also works with no model:
`setStock { mode: "fixed", size }` puts a spoilboard at the origin with its top at Z 0 (`size.z` is the board thickness, not 0). Facing also takes
`stepdown`, `finishPass` and `direction`; a picked mesh face defaults its bottom to the model top, so set the bottom to the face height.
`type: "chamfer"` takes a contour and a `width` (for example 0.3 to deburr) with a V-bit or chamfer tool, plus `openSide` (`left` or `right`)
for open lines, `stepdown` and `direction`; a hole handle is chamfered as a countersink. `generate` tests every toolpath against the model: a gouge is an error
("Cuts into the model by up to ...") and `export_gcode` refuses until you fix the heights or geometry.

Engrave and V-carve: `engrave` cuts along lines and outlines (with a V-bit, `depthMode: "width"` plus `lineWidth` sets the width instead of a depth). `vcarve` needs closed outlines and a V-bit; `maxDepth` stops it and leaves the floor of wide areas. `vclear` clears that floor: `add_operation` with `type: "vclear"`, a flat end mill, empty `geometry` and `params: { sourceId: <the V-carve's id> }`; it fails while the V-carve has no `maxDepth`.

Slots: `describe_geometry` lists recognised slots as `S1…` (`filter: "slots"`). `add_operation` with `type: "slot"` cuts an `S` handle or drawn
centrelines (each line end is the centre of a round end; set `width`). `strategy` is `auto`, `toolWidth`, `wider` or `trochoidal`. A square-ended slot needs
`squareEnds` (`inside`, `endWall` or `dogbone`); `export_gcode` refuses until it is set, and `endWall`/`dogbone` overcuts give a `slot-overcut` warning.

Text: `add_text` puts a text in the job (stock coordinates, mm from the stock's min corner); give an operation `geometry: [{ "kind": "text", "textId": ... }]`. Outline fonts serve profile, pocket, engrave and V-carve; single-line Hershey fonts serve engrave only. `load_font { path }` checks a .ttf, .otf or .woff outline font (.woff2 is refused) and returns a font ref for `add_text` / `update_text` (it is refused while connected live: load fonts in the Spon window).

## Tools

`status`, `new_job`, `open_job`, `use_live_tab`, `save_job`, `import_model`, `get_job`, `import_program`, `describe_geometry`,
`apply_commands`, `add_operation`, `generate`, `render_preview`, `get_gcode`, `export_gcode`, `list_tools`,
`add_library_tool`, `import_tool_library`, and for text `list_fonts`, `load_font`, `add_text`, `update_text`, `remove_text`. Resources: `spon://job`, `spon://catalog`, `spon://gcode/{file}`.
Prompt: `spon-cam-basics`.

## Live mode

The server also listens on `ws://127.0.0.1:5197` (loopback only). In the Spon web app, click **Claude** in the status
bar: the tab connects, and `use_live_tab` lets Claude drive the job open there. Every tool call is one undo step in the
tab, and each change shows a short "Claude: …" toast. Only pages served from localhost on the dev, preview and test
ports (5173, 4173, 5198, 5199) may connect, plus any origin in `SPON_ALLOWED_ORIGINS`. One tab at a time: clicking
Claude in another tab takes over. If the port is taken (a second Claude session), the server runs file-only and
`status` says so.

## Development

    pnpm --filter @sponcam/mcp test
    pnpm --filter @sponcam/mcp typecheck
