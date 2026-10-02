export const INSTRUCTIONS = `Spon is a 2.5D CAM tool. This server creates and edits Spon jobs (.spon files) and posts G-code.

Units and coordinates
- All lengths are millimetres. Coordinates in results are program coordinates: relative to the job's work origin (WCS), Z up.
- Paths may be absolute or relative to the server's working directory.

Typical flow
1. new_job (or open_job for an existing .spon).
2. import_model with an STL, STEP, IGES, DXF or SVG file. If it answers needsUnits or needsBody, call it again with units or body. An SVG without real-world units answers needsScale: call it again with svgDpi (96 for CSS/Inkscape/Affinity, 72 for Illustrator) or svgWidth (mm).
3. Set up with apply_commands: rotateQuarter / layFlat / setZSpin to orient, setStock, setWcs, applyMachinePreset, setPost { dialect: "grbl" | "linuxcnc" | "fanuc" }. A drawing (DXF or SVG) is flat: give the stock its material thickness with setStock (auto stock margin zBottom = thickness).
4. describe_geometry lists what can be machined, with short handles: faces F1, F2… (top down, horizontal and facing up), their loops F1.L0 (outer), F1.L1…, holes H1…, and drawing (DXF/SVG) contours C1…. Call it again after importing or reorienting.
5. add_operation for each operation: type profile, pocket, drill, face or chamfer (face takes an empty geometry list to face the whole stock); a tool from list_tools (job tool id, T number, or library tool id); geometry handles; params.
6. generate: read each operation's status and diagnostics and fix errors with apply_commands (updateOperation).
7. render_preview (top, then iso) to check the toolpaths by eye: feeds are solid, rapids dashed, red hatching is material the tool cannot reach.
8. export_gcode into a folder, and save_job to a .spon path. The user can open the .spon in the Spon web app.

Operation parameters (add_operation params, or updateOperation patch)
- heights: { clearance, retract, feed, top, bottom }, each { from, offset }. from is one of stockTop, stockBottom, modelTop, modelBottom, contour, face, origin, holeBottom, retract, feed, top.
- profile: side (outside | inside | on, for closed contours), openSide (left | on | right, for open lines; seen along the line's direction), direction (climb | conventional), stepdown, stockRadial, finishPass, leads { mode, length }, tabs { enabled, shape, width, height, placement (count | spacing), count, spacing }.
- Open lines: profile them with openSide left or right to cut beside the line (the line is the part's edge). A line runs in the drawn direction of its first handle (open contours list from/to in describe_geometry); a trailing ! on any of an open line's handles (C3!) reverses the whole line, which swaps left and right.
- pocket: stepdown, stepoverPct, finishWalls, finishFloor, entry { mode: auto | helix | ramp | plunge }.
- drill: cycle (drill | dwell | peck | chipbreak), peck, dwellSeconds, diameterFilter { min, max }.
- face: area (stock | picked), stepoverPct, overlap, pattern (zigzag | spiral), angleDeg, oneWay, finishStepoverPct, stepdown, finishPass, direction (climb | conventional).
- chamfer: width, tipOffset, side (outside | inside | auto), openSide (left | right, for open lines), stepdown, direction (climb | conventional); the depth comes from the width and the tool's tip angle (a V-bit or chamfer mill).
- feeds: { rpm, feed, plungeFeed, coolant }.

Facing
- To surface a spoilboard or a blank with no model: apply_commands setStock { mode: "fixed", size { x, y, z }, modelOffset { x: 0, y: 0, z: 0 } } (the stock sits at the origin with its top at Z 0; size z is the board thickness, not 0), then add_operation type face with geometry [] and heights.bottom set to the depth to remove, e.g. { from: "stockTop", offset: -0.5 }.
- A picked mesh face defaults its bottom height to the model top, so set heights.bottom to the face height (for example { from: "modelTop", offset: -10 } for a face 10 mm below the top).

Chamfer
- Deburr an edge with add_operation type chamfer on its contour, a V-bit or chamfer tool and width 0.3. Open lines take openSide left or right (the chamfer is cut to that side of the line); a hole handle (H1) is chamfered as a countersink. stepdown cuts the chamfer in several levels and direction picks climb or conventional.

Gouges
- generate tests every toolpath against the model with the real tool shape. A gouge is an error ("Cuts into the model by up to ..."): export_gcode refuses until you fix it with the operation's heights or geometry (for example a bottom height that is too deep, or a tool that is too large).

Live mode
- If the user has the Spon web app open and clicked "Claude" in its status bar, use_live_tab drives that tab instead of a file. Every change appears in the tab and is one undo step there. save_job without a path saves through the tab's own file; with a path the server writes it.
- status says whether a tab is connected. If the tab closes, the job is no longer open: use new_job / open_job, or ask the user to reconnect.

Always tell the user about export warnings: they do not block the export.`;
