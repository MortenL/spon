import { arcStepCount } from '../../geometry/path2d';
import { vec3, type Vec3 } from '../../geometry/vec3';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { CamDiagnostic, Toolpath } from '../types';
import { dropCutter } from './dropCutter';
import { meshIndex } from './meshIndex';
import { toolShape } from './toolShape';

const MAX_GOUGES = 200;

export interface GougeResult {
  diagnostics: CamDiagnostic[];
  gouges: { point: Vec3; depth: number }[];
}

/**
 * Tests every move of a toolpath against the model mesh with the real tool shape. Moves are sampled from the previous
 * position at spacing min(R/4, 0.5) mm (arcs are tessellated within the tolerance first). Only meshes are checked.
 */
export function gougeCheck(toolpath: Toolpath, tool: Tool, ctx: CamContext): GougeResult {
  const none: GougeResult = { diagnostics: [], gouges: [] };
  if (ctx.geometry?.kind !== 'mesh') return none;
  const shape = toolShape(tool);
  const index = meshIndex(ctx, Math.min(3, Math.max(0.5, shape.radius / 2)));
  if (!index || index.triangleCount === 0) return none;
  let maxZ = -Infinity;
  for (let t = 0; t < index.triangleCount; t++) if (index.triBox[t * 5 + 4] > maxZ) maxZ = index.triBox[t * 5 + 4];

  const step = Math.min(shape.radius / 4, 0.5);
  const gTol = Math.max(ctx.tolerance, 0.01);
  const feed = { max: 0, runs: 0, first: null as Vec3 | null, inRun: false };
  const rapid = { found: false, inRun: false };
  const found: { point: Vec3; depth: number }[] = [];

  const sample = (x: number, y: number, z: number, isRapid: boolean) => {
    const st = isRapid ? rapid : feed;
    let depth = 0;
    if (z <= maxZ) {
      const d = dropCutter(index, shape, x, y, ctx.tolerance);
      if (d !== -Infinity) depth = d - z;
    }
    if (depth > gTol) {
      const p = vec3(x, y, z);
      if (isRapid) rapid.found = true;
      else {
        if (!feed.inRun) { feed.runs++; feed.first ??= p; }
        if (depth > feed.max) feed.max = depth;
      }
      st.inRun = true;
      found.push({ point: p, depth });
    } else st.inRun = false;
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
      segment(top, vec3(m.at.x, m.at.y, m.bottom), false);
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
  if (rapid.found) diagnostics.push({ operationId: toolpath.operationId, severity: 'error', code: 'gouge', message: 'A rapid move passes through the model' });
  found.sort((p, q) => q.depth - p.depth);
  return { diagnostics, gouges: found.slice(0, MAX_GOUGES) };
}
