export const INSTRUCTIONS = `Spon is a 2.5D CAM tool. This server creates and edits Spon jobs (.spon files) and posts G-code.

Units and coordinates
- All lengths are millimetres. Coordinates in results are program coordinates: relative to the job's work origin (WCS), Z up.
- Paths may be absolute or relative to the server's working directory.

Typical flow
1. new_job (or open_job for an existing .spon).
2. import_model with an STL, STEP, IGES or DXF file. If it answers needsUnits or needsBody, call it again with units or body.
3. Set up with apply_commands: rotateQuarter / layFlat / setZSpin to orient, setStock, setWcs, applyMachinePreset, setPost { dialect: "grbl" | "linuxcnc" | "fanuc" }.
4. describe_geometry lists what can be machined, with short handles: faces F1, F2… (top down, horizontal and facing up), their loops F1.L0 (outer), F1.L1…, holes H1…, and DXF contours C1…. Call it again after importing or reorienting.
5. add_operation for each operation: type profile, pocket or drill; a tool from list_tools (job tool id, T number, or library tool id); geometry handles; params.
6. generate: read each operation's status and diagnostics and fix errors with apply_commands (updateOperation).
7. render_preview (top, then iso) to check the toolpaths by eye: feeds are solid, rapids dashed, red hatching is material the tool cannot reach.
8. export_gcode into a folder, and save_job to a .spon path. The user can open the .spon in the Spon web app.

Operation parameters (add_operation params, or updateOperation patch)
- heights: { clearance, retract, feed, top, bottom }, each { from, offset }. from is one of stockTop, stockBottom, modelTop, modelBottom, contour, face, origin, holeBottom, retract, feed, top.
- profile: side (outside | inside | on), direction (climb | conventional), stepdown, stockRadial, finishPass, leads { mode, length }, tabs { enabled, shape, width, height, placement (count | spacing), count, spacing }.
- pocket: stepdown, stepoverPct, finishWalls, finishFloor, entry { mode: auto | helix | ramp | plunge }.
- drill: cycle (drill | dwell | peck | chipbreak), peck, dwellSeconds, diameterFilter { min, max }.
- feeds: { rpm, feed, plungeFeed, coolant }.

Always tell the user about export warnings: they do not block the export.`;
