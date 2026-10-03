import type { CamContext } from '../cam/context';
import type { Shape } from '../cam/features/chain';
import { resolveFaceRef } from '../cam/features/mesh';
import type { CamCode, CamDiagnostic } from '../cam/types';
import { flattenPath } from '../geometry/offset/pathOps';
import type { Path2D, Segment, Vec2 } from '../geometry/path2d';
import type { Job } from '../job/types';
import { layoutText } from './layout';
import type { TextItem } from './types';

export interface ResolvedText {
  textId: string;
  z: number | null;                       // surface Z (program coordinates); null if it doesn't resolve
  shapes: Shape[];                        // program coordinates
  strokes: Path2D[];                      // program coordinates
  kind: 'outline' | 'singleLine' | null;  // null when the font isn't available
  diagnostics: CamDiagnostic[];           // operationId '' — the text's own problems
}

export interface TextSummary { textId: string; diagnostics: CamDiagnostic[]; z: number | null; loops: { points: Vec2[]; closed: boolean }[] }

const move = (p: Vec2, dx: number, dy: number): Vec2 => ({ x: p.x + dx, y: p.y + dy });
const moveSegment = (s: Segment, dx: number, dy: number): Segment =>
  s.kind === 'line' ? { kind: 'line', from: move(s.from, dx, dy), to: move(s.to, dx, dy) } : { ...s, center: move(s.center, dx, dy) };
const movePath = (p: Path2D, dx: number, dy: number): Path2D => ({ closed: p.closed, segments: p.segments.map((s) => moveSegment(s, dx, dy)) });

/** Resolves one text to geometry in program coordinates, with the text's own diagnostics. */
export function resolveText(item: TextItem, ctx: CamContext): ResolvedText {
  const out: ResolvedText = { textId: item.id, z: null, shapes: [], strokes: [], kind: null, diagnostics: [] };
  const diag = (severity: 'error' | 'warning', code: CamCode, message: string) => out.diagnostics.push({ operationId: '', severity, code, message });

  const status = ctx.fonts.status(item.font);
  const font = status === 'ok' ? ctx.fonts.get(item.font) : null;
  if (status === 'missing') diag('error', 'font-missing', `The font file for ${item.name} is missing`);
  else if (status === 'unreadable') diag('error', 'font-unreadable', "This font file can't be read");

  let layout: ReturnType<typeof layoutText> | null = null;
  if (font) {
    out.kind = font.kind;
    layout = layoutText(item, font, ctx.tolerance);
    if (layout.error === 'text-empty') diag('error', 'text-empty', `${item.name} has no text`);
    else if (layout.error === 'text-fit') diag('error', 'text-fit', `${item.name} doesn't fit its box`);
    else if (layout.error === 'text-arc') diag('error', 'text-arc', `The arc radius of ${item.name} is smaller than its text`);
    if (layout.missing.length) diag('warning', 'text-missing-glyphs', `${font.name} has no glyph for: ${layout.missing.join('')}`);
  }

  const stock = ctx.stock;
  if (!stock) {
    if (!ctx.job.model && ctx.job.stock.mode === 'auto') diag('error', 'text-no-stock', 'Text without a model needs a fixed stock size');
    else diag('error', 'ref-missing', 'Set up the stock first');
    return out;
  }
  if (item.surface.from === 'stockTop') out.z = stock.max.z;
  else {
    const f = resolveFaceRef(ctx, item.surface.face);
    if (f.ok) out.z = f.face.z;
    else {
      diag('error', f.code, f.message);
      return out;
    }
  }

  if (layout) {
    const dx = stock.min.x, dy = stock.min.y;
    out.shapes = layout.shapes.map((s) => ({ outer: movePath(s.outer, dx, dy), islands: s.islands.map((i) => movePath(i, dx, dy)) }));
    out.strokes = layout.strokes.map((p) => movePath(p, dx, dy));
  }
  return out;
}

/** One entry per text of the job: diagnostics, surface height and the flattened loops (program coordinates) for drawing. */
export function textSummaries(job: Job, ctx: CamContext): TextSummary[] {
  const tol = Math.max(ctx.tolerance, 0.01);
  return job.texts.map((item) => {
    const r = resolveText(item, ctx);
    const loops = [
      ...r.shapes.flatMap((s) => [s.outer, ...s.islands]).map((p) => ({ points: flattenPath(p, tol), closed: true })),
      ...r.strokes.map((p) => ({ points: flattenPath(p, tol), closed: false })),
    ];
    return { textId: item.id, diagnostics: r.diagnostics, z: r.z, loops };
  });
}
