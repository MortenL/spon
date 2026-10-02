import { arcStepCount } from '../../geometry/path2d';
import { vec3, type Vec3 } from '../../geometry/vec3';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { CamDiagnostic, Toolpath } from '../types';
import { dropCutter } from './dropCutter';
import { meshIndex } from './meshIndex';
import { toolShape } from './toolShape';

const MAX_GOUGES = 200;
const CELL_BUCKETS = [3, 2, 1, 0.5];

export interface GougeOptions {
  /**
   * Chamfers: a cone legitimately sits this far (mm) below the mesh edge it cuts, so a sample gouges only when it is
   * deeper than allowance + tolerance. Applies to every sample of the operation, feed and rapid.
   */
  allowance?: number;
  /**
   * The largest chord sagitta (mm) of the arcs fitted to the mesh loops the operation uses. The real mesh walls sit
   * inside the fitted circles by that much, so a sample gouges only if it also gouges with the tool radius reduced by
   * tolerance + sagitta.
   */
  sagitta?: number;
}

/** Cell size for a tool radius: clamp(R / 3, 0.5, 3) rounded down to a bucket, so a placement holds at most four indexes. */
function cellFor(radius: number): number {
  const want = Math.min(3, Math.max(0.5, radius / 3));
  return CELL_BUCKETS.find((b) => b <= want + 1e-9) ?? 0.5;
}

export interface GougeResult {
  diagnostics: CamDiagnostic[];
  gouges: { point: Vec3; depth: number }[];
}

/**
 * Tests every move of a toolpath against the model mesh with the real tool shape. Moves are sampled from the previous
 * position at spacing min(R/4, 0.5) mm (arcs are tessellated within the tolerance first). Only meshes are checked.
 */
export function gougeCheck(toolpath: Toolpath, tool: Tool, ctx: CamContext, options: GougeOptions = {}): GougeResult {
  const none: GougeResult = { diagnostics: [], gouges: [] };
  if (ctx.geometry?.kind !== 'mesh') return none;
  const shape = toolShape(tool);
  const index = meshIndex(ctx, cellFor(shape.radius));
  if (!index || index.triangleCount === 0) return none;
  let maxZ = -Infinity;
  for (let t = 0; t < index.triangleCount; t++) if (index.triBox[t * 5 + 4] > maxZ) maxZ = index.triBox[t * 5 + 4];

  const step = Math.min(shape.radius / 4, 0.5);
  const gTol = Math.max(ctx.tolerance, 0.01);
  const feed = { max: 0, runs: 0, first: null as Vec3 | null };
  let rapidFound = false;
  /** Which kind of move the previous sample gouged in; a clean sample or a change of kind ends a run. */
  let prev: 'feed' | 'rapid' | null = null;
  let found: { point: Vec3; depth: number }[] = [];
  const compact = () => { found.sort((p, q) => q.depth - p.depth); found = found.slice(0, MAX_GOUGES); };
  // Hole walls in a mesh are inscribed polygons, so a drill column is checked with a slightly smaller tool.
  const allowance = Math.max(0, options.allowance ?? 0);
  const sagitta = Math.max(0, options.sagitta ?? 0);
  const rAllow = gTol + sagitta;
  const shrink = (by: number) => {
    const radius = Math.max(0, shape.radius - by);
    return { ...shape, radius, cornerRadius: Math.min(shape.cornerRadius, radius) };
  };
  // A sample that gouges at full radius is tested again with the reduced one: faceted round walls sit inside their fitted
  // circles. Without fitted arcs (sagitta 0) the retest would only shrink the tool by gTol, so it is skipped (it costs ~50% on paths that gouge everywhere).
  const reduced = shrink(rAllow);
  const cycleShape = shrink(Math.max(gTol + ctx.tolerance + 0.02 * shape.radius, rAllow));
  let active = shape;

  const sample = (x: number, y: number, z: number, isRapid: boolean) => {
    let depth = 0;
    if (z <= maxZ) {
      const lim = z + allowance + gTol;
      let d = dropCutter(index, active, x, y, ctx.tolerance, lim); // only depths beyond the allowance matter
      if (d > lim && active === shape && sagitta > 0) d = dropCutter(index, reduced, x, y, ctx.tolerance, lim);
      if (d > lim) depth = d - z;
    }
    if (depth > 0) {
      const p = vec3(x, y, z);
      const kind = isRapid ? 'rapid' : 'feed';
      if (isRapid) rapidFound = true;
      else {
        if (prev !== 'feed') { feed.runs++; feed.first ??= p; }
        if (depth > feed.max) feed.max = depth;
      }
      prev = kind;
      found.push({ point: p, depth });
      if (found.length >= 4 * MAX_GOUGES) compact();
    } else prev = null;
  };
  const segment = (a: Vec3, b: Vec3, isRapid: boolean) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      sample(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, isRapid);
    }
  };

  let pos: Vec3 | null = null;
  for (const m of toolpath.moves) {
    if (m.kind === 'cycle') {
      const top = vec3(m.at.x, m.at.y, m.retract);
      if (pos) segment(pos, top, true); else sample(top.x, top.y, top.z, true);
      active = cycleShape;
      segment(top, vec3(m.at.x, m.at.y, m.bottom), false);
      active = shape;
      pos = top;
      continue;
    }
    const isRapid = m.kind === 'rapid';
    if (!pos) { sample(m.to.x, m.to.y, m.to.z, isRapid); pos = m.to; continue; }
    if (m.kind === 'arc') {
      const r = Math.hypot(pos.x - m.center.x, pos.y - m.center.y);
      const a0 = Math.atan2(pos.y - m.center.y, pos.x - m.center.x);
      const a1 = Math.atan2(m.to.y - m.center.y, m.to.x - m.center.x);
      let sweep = m.ccw ? a1 - a0 : a0 - a1;
      sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (sweep < 1e-9 && Math.hypot(m.to.x - pos.x, m.to.y - pos.y) < 1e-6) sweep = 2 * Math.PI; // full circle
      const n = arcStepCount(r, sweep, ctx.tolerance);
      let prev = pos;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const ang = a0 + (m.ccw ? sweep : -sweep) * t;
        const q = i === n ? m.to : vec3(m.center.x + r * Math.cos(ang), m.center.y + r * Math.sin(ang), pos.z + (m.to.z - pos.z) * t);
        segment(prev, q, false);
        prev = q;
      }
    } else segment(pos, m.to, isRapid);
    pos = m.to;
  }

  const diagnostics: CamDiagnostic[] = [];
  if (feed.runs > 0 && feed.first) {
    const f = feed.first;
    diagnostics.push({
      operationId: toolpath.operationId, severity: 'error', code: 'gouge',
      message: `Cuts into the model by up to ${feed.max.toFixed(2)} mm (${feed.runs} ${feed.runs === 1 ? 'place' : 'places'}, first at X ${f.x.toFixed(2)} Y ${f.y.toFixed(2)} Z ${f.z.toFixed(2)})`,
    });
  }
  if (rapidFound) diagnostics.push({ operationId: toolpath.operationId, severity: 'error', code: 'gouge', message: 'A rapid move passes through the model' });
  compact();
  return { diagnostics, gouges: found };
}
