import type { Job } from '../job/types';
import { camContext, type CamContext, type CamGeometry } from './context';
import { resolveGeometry } from './features/resolve';
import { gougeCheck } from './gouge/check';
import { chamferGeometry, chamferToolpath } from './ops/chamfer';
import { drillToolpath } from './ops/drill';
import { faceToolpath } from './ops/face';
import { emptyOverlays, type OpOutput } from './ops/output';
import { pocketToolpath } from './ops/pocket';
import { profileToolpath } from './ops/profile';
import { slotToolpath } from './ops/slot';
import type { CamDiagnostic, Operation } from './types';

export interface OperationResult extends OpOutput {
  operationId: string;
  /** Everything the result depends on, except the geometry object. */
  key: string;
}

export class GenerationCache {
  private entries = new Map<string, { key: string; geometry: CamGeometry | null; result: OperationResult }>();
  get(id: string, key: string, geometry: CamGeometry | null): OperationResult | null {
    const e = this.entries.get(id);
    return e && e.key === key && e.geometry === geometry ? e.result : null;
  }
  set(id: string, geometry: CamGeometry | null, result: OperationResult): void {
    this.entries.set(id, { key: result.key, geometry, result });
  }
  /** Drops entries for operations that no longer exist. */
  retain(ids: readonly string[]): void {
    const keep = new Set(ids);
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id);
  }
}

export function operationKey(op: Operation, job: Job): string {
  return JSON.stringify([op, job.tools.find((t) => t.id === op.toolId) ?? null, job.tolerance, job.model, job.stock, job.wcs, job.machine.maxFeed]);
}

export function generateOperation(op: Operation, ctx: CamContext): OperationResult {
  const base: OperationResult = { operationId: op.id, key: '', toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  if (!op.enabled) return base;
  const err = (code: CamDiagnostic['code'], message: string): OperationResult => ({
    ...base, diagnostics: [{ operationId: op.id, severity: 'error', code, message }],
  });
  try {
    base.key = operationKey(op, ctx.job);
    const tool = ctx.job.tools.find((t) => t.id === op.toolId);
    if (!tool) return err('no-tool', 'Choose a tool for this operation');
    if (!op.geometry.length && !(op.type === 'face' && op.area === 'stock')) return err('no-geometry', 'Pick geometry for this operation');
    // facing the whole stock top needs no geometry; stale references are ignored
    const geo = resolveGeometry(op.type === 'face' && op.area === 'stock' ? { ...op, geometry: [] } : op, ctx);
    const res =
      op.type === 'profile' ? profileToolpath(op, tool, ctx, geo)
      : op.type === 'pocket' ? pocketToolpath(op, tool, ctx, geo)
      : op.type === 'drill' ? drillToolpath(op, tool, ctx, geo)
      : op.type === 'face' ? faceToolpath(op, tool, ctx, geo)
      : op.type === 'slot' ? slotToolpath(op, tool, ctx, geo)
      : chamferToolpath(op, tool, ctx, geo);
    const diagnostics: CamDiagnostic[] = [...geo.diagnostics, ...res.diagnostics];
    const warn = (code: CamDiagnostic['code'], message: string) => diagnostics.push({ operationId: op.id, severity: 'warning', code, message });
    if (op.type !== 'drill' && !(op.type === 'slot' && op.strategy === 'trochoidal') && op.stepdown > tool.fluteLength) warn('stepdown-exceeds-flute', `Stepdown ${op.stepdown} mm is deeper than the ${tool.fluteLength} mm flutes`);
    const maxFeed = op.type === 'drill' ? op.feeds.plungeFeed : op.feeds.feed;
    if (maxFeed > ctx.job.machine.maxFeed) warn('feed-exceeds-machine', `Feed ${maxFeed} mm/min is above the machine maximum of ${ctx.job.machine.maxFeed}`);
    // a gouge keeps its toolpath, so the user can see where it cuts into the model
    const failed = diagnostics.some((d) => d.severity === 'error' && d.code !== 'gouge');
    const toolpath = failed ? null : res.toolpath;
    const overlays = res.overlays;
    if (toolpath) {
      // a chamfer cone sits width / tan(half-angle) below the edge by design, and a faceted wall sitting `sagitta`
      // inside its fitted circle lets the cone ride sagitta / tan(half-angle) deeper
      const tanHalf = op.type === 'chamfer' ? Math.tan(chamferGeometry(tool, op.width, op.tipOffset).halfAngle) : 0;
      const allowance = op.type === 'chamfer' ? (op.width + geo.sagitta) / tanHalf : 0;
      // slots: straight walls fit no arcs, but a tool exactly as wide as the slot sits tangent to both walls, so allow the tolerance
      const g = gougeCheck(toolpath, tool, ctx, { allowance, sagitta: op.type === 'slot' ? Math.max(geo.sagitta, ctx.tolerance) : geo.sagitta, intended: res.intended });
      diagnostics.push(...g.diagnostics);
      return { ...base, ...res, diagnostics, toolpath, overlays: { ...overlays, gouges: g.gouges } };
    }
    return { ...base, ...res, diagnostics, toolpath };
  } catch (e) {
    return err('internal', `Generation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function generateJob(job: Job, geometry: CamGeometry | null, cache?: GenerationCache): OperationResult[] {
  let ctx: CamContext | null = null;
  const results = job.operations.map((op) => {
    try {
      const key = operationKey(op, job);
      const hit = cache?.get(op.id, key, geometry);
      if (hit) return hit;
    } catch (e) {
      // Key computation failed; fall through to generateOperation which will also fail with internal error
    }
    ctx ??= camContext(job, geometry);
    const result = generateOperation(op, ctx);
    try {
      cache?.set(op.id, geometry, result);
    } catch {
      // Cache set failed; continue without caching this result
    }
    return result;
  });
  cache?.retain(job.operations.map((o) => o.id));
  return flagDuplicateToolNumbers(job, results);
}

/**
 * Enabled operations whose distinct tools share a T number get an error (and lose their toolpath): the posted
 * program could not tell the tools apart. Jobs made through applyCommand cannot get here; older jobs can.
 */
function flagDuplicateToolNumbers(job: Job, results: OperationResult[]): OperationResult[] {
  const used = new Map<number, Set<string>>();
  for (const op of job.operations) {
    const tool = op.enabled ? job.tools.find((t) => t.id === op.toolId) : undefined;
    if (tool) used.set(tool.number, (used.get(tool.number) ?? new Set()).add(tool.id));
  }
  return results.map((r, i) => {
    const op = job.operations[i];
    const tool = op.enabled ? job.tools.find((t) => t.id === op.toolId) : undefined;
    if (!tool || (used.get(tool.number)?.size ?? 0) < 2) return r;
    const message = `T${tool.number} is shared by different tools; give each tool its own number`;
    return { ...r, toolpath: null, diagnostics: [...r.diagnostics, { operationId: op.id, severity: 'error', code: 'tool-number-duplicate', message }] };
  });
}
