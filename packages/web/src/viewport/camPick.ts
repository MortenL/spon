import {
  type CamContext, circleOf, drawingPath, drawingPathToProgram, type DxfPathRef, dist2, faceRefFromTriangle, type GeometryRef,
  nearestDxfPath, nearestS, type Operation, pathEnd, pathStart, resolveFaceRef, type Vec2,
} from '@sponcam/core';
import { sameRef } from '@/inspector/geometryLabels';

const PICK_DISTANCE = 2; // mm

export function connectedDxfRefs(ctx: CamContext, ref: DxfPathRef, hidden: ReadonlySet<string>): DxfPathRef[] {
  const g = ctx.geometry;
  if (!g || g.kind !== 'drawing') return [ref];
  const all: { ref: DxfPathRef; a: Vec2; b: Vec2 }[] = [];
  g.drawing.layers.forEach((l, layer) => {
    if (hidden.has(l.name)) return;
    l.paths.forEach((p, path) => {
      if (p.closed || !p.segments.length) return;
      const q = drawingPathToProgram(ctx, p);
      all.push({ ref: { kind: 'dxfPath', blobId: ref.blobId, layer, path }, a: pathStart(q), b: pathEnd(q) });
    });
  });
  const start = all.find((x) => sameRef(x.ref, ref));
  if (!start) return [ref];
  const tol = Math.max(ctx.tolerance, 1e-3);
  const chain = [start];
  for (let grown = true; grown; ) {
    grown = false;
    for (const x of all) {
      if (chain.includes(x)) continue;
      if (chain.some((c) => [c.a, c.b].some((p) => dist2(p, x.a) <= tol || dist2(p, x.b) <= tol))) {
        chain.push(x);
        grown = true;
      }
    }
  }
  return chain.map((c) => c.ref);
}

const STOCK_FACING = 'Facing the stock needs no geometry; switch the area to Picked to pick';

export function pickDxf(op: Operation, ctx: CamContext, q: Vec2, hidden: ReadonlySet<string>): { refs: DxfPathRef[] } | { error: string } {
  if (op.type === 'face' && op.area === 'stock') return { error: STOCK_FACING };
  const g = ctx.geometry;
  if (!g || g.kind !== 'drawing') return { error: 'Nothing to pick here' };
  if (op.type === 'drill') {
    let best = null as DxfPathRef | null;
    let bestD = PICK_DISTANCE;
    g.drawing.layers.forEach((l, layer) => {
      if (hidden.has(l.name)) return;
      l.paths.forEach((p, path) => {
        const prog = drawingPathToProgram(ctx, p);
        if (!circleOf(prog)) return;
        const d = nearestS(prog, q).distance;
        if (d <= bestD) { bestD = d; best = { kind: 'dxfPath', blobId: ctx.job.model!.blobId, layer, path }; }
      });
    });
    if (best) return { refs: [best] };
    return nearestDxfPath(ctx, q, PICK_DISTANCE, hidden) ? { error: 'Only circles can be drilled' } : { error: 'Nothing to pick here' };
  }
  const ref = nearestDxfPath(ctx, q, PICK_DISTANCE, hidden);
  if (!ref) return { error: 'Nothing to pick here' };
  const raw = drawingPath(g.drawing, ref.layer, ref.path);
  return { refs: raw?.closed ? [ref] : connectedDxfRefs(ctx, ref, hidden) };
}

export function pickMesh(op: Operation, ctx: CamContext, tri: number, q: Vec2, alt: boolean): { refs: GeometryRef[] } | { error: string } {
  if (op.type === 'face' && op.area === 'stock') return { error: STOCK_FACING };
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh' || !ctx.job.model) return { error: 'Nothing to pick here' };
  const face = faceRefFromTriangle(g.mesh, ctx.job.model.blobId, tri);
  const res = resolveFaceRef(ctx, face);
  if (!res.ok) return { error: res.message };
  if (!alt || op.type === 'pocket' || op.type === 'face') return { refs: [face] };
  let best = -1;
  let bestD = Infinity;
  res.face.loops.forEach((loop, i) => {
    if (op.type === 'drill' && (i === 0 || !circleOf(loop))) return;
    const d = nearestS(loop, q).distance;
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0) return { error: 'This face has no round holes' };
  // a chamfer treats a round inner loop as a hole (a countersink) and any other loop as an edge
  const asHole = op.type === 'drill' || (op.type === 'chamfer' && best > 0 && circleOf(res.face.loops[best]) !== null);
  return { refs: [asHole ? { kind: 'meshHole', face, loop: best } : { kind: 'meshLoop', face, loop: best }] };
}

export function applyPick(op: Operation, refs: readonly GeometryRef[]): GeometryRef[] {
  const all = refs.every((r) => op.geometry.some((g) => sameRef(g, r)));
  return all ? op.geometry.filter((g) => !refs.some((r) => sameRef(g, r))) : [...op.geometry, ...refs.filter((r) => !op.geometry.some((g) => sameRef(g, r)))];
}
