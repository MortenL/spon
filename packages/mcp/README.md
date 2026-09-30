# Spon MCP server

Lets Claude (or any MCP client) create and edit Spon jobs on disk: import STL, STEP, IGES and DXF models, pick geometry,
add profile, pocket and drill operations, generate, preview, export G-code and save `.spon` files that open in the web app.

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
| `SPON_MCP_LOG` | — | `debug` logs every tool call to stderr. |

To use your browser tool library headless, export it from the web app's tool library dialog and call
`import_tool_library` with the file.

## Tools

`status`, `new_job`, `open_job`, `save_job`, `import_model`, `get_job`, `import_program`, `describe_geometry`,
`apply_commands`, `add_operation`, `generate`, `render_preview`, `get_gcode`, `export_gcode`, `list_tools`,
`add_library_tool`, `import_tool_library`. Resources: `spon://job`, `spon://catalog`, `spon://gcode/{file}`.
Prompt: `spon-cam-basics`.

## Development

    pnpm --filter @sponcam/mcp test
    pnpm --filter @sponcam/mcp typecheck
