import type { Job } from '../job/types';
import { camContext, type CamContext, type CamGeometry } from './context';
import { resolveGeometry } from './features/resolve';
import { drillToolpath } from './ops/drill';
import { emptyOverlays, type OpOutput } from './ops/output';
import { pocketToolpath } from './ops/pocket';
import { profileToolpath } from './ops/profile';
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
  const base: OperationResult = { operationId: op.id, key: operationKey(op, ctx.job), toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  if (!op.enabled) return base;
  const err = (code: CamDiagnostic['code'], message: string): OperationResult => ({
    ...base, diagnostics: [{ operationId: op.id, severity: 'error', code, message }],
  });
  try {
    const tool = ctx.job.tools.find((t) => t.id === op.toolId);
    if (!tool) return err('no-tool', 'Choose a tool for this operation');
    if (!op.geometry.length) return err('no-geometry', 'Pick geometry for this operation');
    const geo = resolveGeometry(op, ctx);
    const res = op.type === 'profile' ? profileToolpath(op, tool, ctx, geo) : op.type === 'pocket' ? pocketToolpath(op, tool, ctx, geo) : drillToolpath(op, tool, ctx, geo);
    const diagnostics: CamDiagnostic[] = [...geo.diagnostics, ...res.diagnostics];
    const warn = (code: CamDiagnostic['code'], message: string) => diagnostics.push({ operationId: op.id, severity: 'warning', code, message });
    if (op.type !== 'drill' && op.stepdown > tool.fluteLength) warn('stepdown-exceeds-flute', `Stepdown ${op.stepdown} mm is deeper than the ${tool.fluteLength} mm flutes`);
    if (op.feeds.feed > ctx.job.machine.maxFeed) warn('feed-exceeds-machine', `Feed ${op.feeds.feed} mm/min is above the machine maximum of ${ctx.job.machine.maxFeed}`);
    const failed = diagnostics.some((d) => d.severity === 'error');
    return { ...base, ...res, diagnostics, toolpath: failed ? null : res.toolpath };
  } catch (e) {
    return err('internal', `Generation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function generateJob(job: Job, geometry: CamGeometry | null, cache?: GenerationCache): OperationResult[] {
  let ctx: CamContext | null = null;
  const results = job.operations.map((op) => {
    const key = operationKey(op, job);
    const hit = cache?.get(op.id, key, geometry);
    if (hit) return hit;
    ctx ??= camContext(job, geometry);
    const result = generateOperation(op, ctx);
    cache?.set(op.id, geometry, result);
    return result;
  });
  cache?.retain(job.operations.map((o) => o.id));
  return results;
}
