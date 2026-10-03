export const INSTRUCTIONS = `Spon is a 2.5D CAM tool. This server creates and edits Spon jobs (.spon files) and posts G-code.

Units and coordinates
- All lengths are millimetres. Coordinates in results are program coordinates: relative to the job's work origin (WCS), Z up.
- Paths may be absolute or relative to the server's working directory.

Typical flow
1. new_job (or open_job for an existing .spon).
2. import_model with an STL, STEP, IGES, DXF or SVG file. If it answers needsUnits or needsBody, call it again with units or body. An SVG without real-world units answers needsScale: call it again with svgDpi (96 for CSS/Inkscape/Affinity, 72 for Illustrator) or svgWidth (mm).
3. Set up with apply_commands: rotateQuarter / layFlat / setZSpin to orient, setStock, setWcs, applyMachinePreset, setPost { dialect: "grbl" | "linuxcnc" | "fanuc" }. A drawing (DXF or SVG) is flat: give the stock its material thickness with setStock (auto stock margin zBottom = thickness).
4. describe_geometry lists what can be machined, with short handles: faces F1, F2… (top down, horizontal and facing up), their loops F1.L0 (outer), F1.L1…, holes H1…, slots S1… (recognised slots), and drawing (DXF/SVG) contours C1…. Call it again after importing or reorienting.
5. add_operation for each operation: type profile, pocket, drill, face, chamfer, slot, engrave, vcarve or vclear (face and vclear take an empty geometry list); a tool from list_tools (job tool id, T number, or library tool id); geometry handles; params.
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
- slot: width (drawn centrelines), strategy (auto | toolWidth | wider | trochoidal), trochoidal { stepPct }, squareEnds (inside | endWall | dogbone), stepdown, direction, stepoverPct, stockRadial, stockAxial, finishWalls, entry.
- engrave: depthMode (depth | width), depth (mm, used in depth mode), lineWidth (mm, used in width mode with a V-bit), stepdown. vcarve: maxDepth (number or null), stepdown (number or null). vclear: sourceId, stepoverPct, stepdown, direction.
- feeds: { rpm, feed, plungeFeed, coolant }.

Facing
- To surface a spoilboard or a blank with no model: apply_commands setStock { mode: "fixed", size { x, y, z }, modelOffset { x: 0, y: 0, z: 0 } } (the stock sits at the origin with its top at Z 0; size z is the board thickness, not 0), then add_operation type face with geometry [] and heights.bottom set to the depth to remove, e.g. { from: "stockTop", offset: -0.5 }.
- A picked mesh face defaults its bottom height to the model top, so set heights.bottom to the face height (for example { from: "modelTop", offset: -10 } for a face 10 mm below the top).

Chamfer
- Deburr an edge with add_operation type chamfer on its contour, a V-bit or chamfer tool and width 0.3. Open lines take openSide left or right (the chamfer is cut to that side of the line); a hole handle (H1) is chamfered as a countersink. stepdown cuts the chamfer in several levels and direction picks climb or conventional.

Slots
- Slots: add_operation type slot on drawn centrelines (lines or arcs; each line end is the centre of a round end, so a 6.5 × 20 slot is a 13.5 mm line; set width) or on recognised slots S1….
- strategy auto picks toolWidth when the width matches the tool diameter (0.02 mm narrower to 0.05 mm wider; narrower than that is refused), else wider; trochoidal is used only when set (trochoidal.stepPct, default 10).
- Square-ended slots need squareEnds: inside (corners keep the tool radius), endWall (overcuts the end by the tool radius) or dogbone (corner reliefs); export is refused until it is set.
- endWall and dogbone overcuts give a slot-overcut warning, not a gouge error.

Engrave and V-carve
- engrave cuts along lines and outlines with the tool centre on the line; with a V-bit, depthMode width sets the line width (lineWidth) instead of a depth.
- vcarve needs closed outlines and a V-bit; the depth follows the shape's width. maxDepth stops it at a depth and leaves the floor of wide areas.
- vclear clears that floor: add_operation type vclear with a flat end mill and params { sourceId: <the vcarve's operation id> }; it fails while its vcarve has no maxDepth.

Text
- A text is a job item (add_text; update_text, remove_text, list_fonts), not part of the model. Its position is in stock coordinates: mm from the stock's min corner. Surface is stockTop (default) or a picked face (surface { from: "face", face }).
- A text needs a fixed stock when the job has no model: apply_commands setStock { mode: "fixed", ... } first.
- Machine a text by giving an operation geometry [{ kind: "text", textId }] (add_operation geometry, or a full ref in updateOperation). Outline fonts (sans, sansBold, serif and uploaded TTF/OTF) work for profile, pocket, engrave and vcarve; single-line Hershey fonts (hersheySans, hersheyDuplex, hersheyScript) work for engrave only.
- To use your own font, load_font { path } first, then set the returned ref as the text's font (add_text or update_text). Uploaded fonts are saved inside the .spon file. Accepted uploads are .ttf, .otf and .woff outline fonts; .woff2 is refused.
- Defaults: font sans, size 10 mm, letterSpacing 0, lineSpacing 1.6, align center, anchor center, angle 0, no mirror, no arc, no fit; without position the text is centred on the stock (the stock's own box, so it does not depend on the work origin), or put at the stock's min corner when no stock is known yet. fit { width, height } scales the text to a box (height null keeps the proportions); arc { radius, side } sets it on a circle.

Inlays
- An inlay is a V-carved pocket in the base plus a mirrored plug cut in a second board with the same V-bit. Three numbers: D (inlayDepth) is the pocket depth in the base (default 4 mm), S (startDepth) is how far the plug is cut below its flat top before it meets the pocket (default 2 mm), g (glueGap) is the space left at the pocket floor for glue (default 0.5 mm, smaller than D). The plug board is H = D - g + S tall plus 2 mm.
- Prepare the base: a text or drawing, a vcarve with a V-bit, and a flat or bull-nose tool in the job for the clearing. make_inlay { operationId: <the vcarve>, plugPath } creates the pocket here (sets the V-carve's maxDepth to D, adds a vclear of its floor) and writes a plug job to plugPath. Save the base job with save_job; open the plug job with open_job to generate and export it.
- After editing the base text or shapes, call make_inlay again with update: true: the plug job's shapes are replaced and its tools, origin and extra operations are kept. Without update it refuses to overwrite plugPath.

Gouges
- generate tests every toolpath against the model with the real tool shape. A gouge is an error ("Cuts into the model by up to ..."): export_gcode refuses until you fix it with the operation's heights or geometry (for example a bottom height that is too deep, or a tool that is too large).

Live mode
- If the user has the Spon web app open and clicked "Claude" in its status bar, use_live_tab drives that tab instead of a file. Every change appears in the tab and is one undo step there. save_job without a path saves through the tab's own file; with a path the server writes it.
- status says whether a tab is connected. If the tab closes, the job is no longer open: use new_job / open_job, or ask the user to reconnect.

Always tell the user about export warnings: they do not block the export.`;
