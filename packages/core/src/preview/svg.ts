import { camContext, type CamContext, type CamGeometry, drawingPathToProgram, toProgram } from '../cam/context';
import type { OpOverlays } from '../cam/ops/output';
import type { Move, Toolpath } from '../cam/types';
import type { BBox } from '../geometry/bbox';
import { flattenPath } from '../geometry/offset/pathOps';
import type { Vec2 } from '../geometry/path2d';
import type { Vec3 } from '../geometry/vec3';
import type { Job } from '../job/types';
import type { PipelineResult } from '../pipeline/run';
import { formatLength, fromDisplay, toDisplay } from '../units/units';
import { type PreviewView, projector } from './project';
import { simplifyPolyline } from './simplify';

export interface PreviewOperation { id: string; name: string; toolpath: Toolpath | null; hasErrors: boolean; unmachined: OpOverlays['unmachined'] }
export interface PreviewInput { job: Job; geometry: CamGeometry | null; operations: PreviewOperation[] }
export interface PreviewOptions { view?: PreviewView; size?: number; operations?: readonly string[] }

export const PREVIEW_PALETTE: readonly string[] = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#4f46e5'];
const ERROR = '#dc2626';
const INK = '#111827';
const MARGIN = 32;
const ARC_STEP = (5 * Math.PI) / 180;
const COS_FEATURE = Math.cos(Math.PI / 6);

type ArcMove = Extract<Move, { kind: 'arc' }>;
type Polyline = Vec3[];
interface Runs { feed: Polyline[]; rapid: Polyline[]; drills: Vec3[] }

/** The enabled operations of a job with their toolpaths, errors and unmachined areas from a pipeline run. */
export function previewInput(job: Job, geometry: CamGeometry | null, pipeline: PipelineResult): PreviewInput {
  const summaries = new Map(pipeline.run.results.map((r) => [r.operationId, r]));
  const toolpaths = new Map(pipeline.toolpaths.map((t) => [t.operationId, t]));
  const operations = job.operations.filter((op) => op.enabled).map((op) => {
    const summary = summaries.get(op.id);
    return {
      id: op.id, name: op.name, toolpath: toolpaths.get(op.id) ?? null,
      hasErrors: !!summary?.diagnostics.some((d) => d.severity === 'error'),
      unmachined: summary?.overlays.unmachined ?? [],
    };
  });
  return { job, geometry, operations };
}

/** The largest 1, 2 or 5 × 10^k that is not above `value`. */
export function niceLength(value: number): number {
  const p = 10 ** Math.floor(Math.log10(value));
  const m = value / p;
  return Number(((m >= 5 ? 5 : m >= 2 ? 2 : 1) * p).toPrecision(3));
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
const f1 = (v: number) => v.toFixed(1);

function arcPoints(from: Vec3, m: ArcMove): Vec3[] {
  const c = m.center;
  const r = Math.hypot(from.x - c.x, from.y - c.y);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(m.to.y - c.y, m.to.x - c.x);
  let sweep = m.ccw ? a1 - a0 : a0 - a1;
  while (sweep <= 1e-9) sweep += 2 * Math.PI; // equal start and end: a full circle
  const n = Math.max(2, Math.ceil(sweep / ARC_STEP));
  const pts: Vec3[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const a = a0 + (m.ccw ? 1 : -1) * sweep * t;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), z: from.z + (m.to.z - from.z) * t });
  }
  pts.push(m.to);
  return pts;
}

/** Splits a toolpath into runs of feed moves and runs of rapids; drill cycles become a feed down and a rapid up. */
function toolpathRuns(tp: Toolpath): Runs {
  const runs: Runs = { feed: [], rapid: [], drills: [] };
  let pos: Vec3 | null = null;
  let kind: 'feed' | 'rapid' | null = null;
  let run: Polyline = [];
  const add = (k: 'feed' | 'rapid', pts: Vec3[]) => {
    if (!pos) return;
    if (k !== kind) {
      run = [pos];
      runs[k].push(run);
      kind = k;
    }
    for (const p of pts) run.push(p);
  };
  for (const m of tp.moves) {
    if (m.kind === 'cycle') {
      const at = (z: number): Vec3 => ({ x: m.at.x, y: m.at.y, z });
      add('rapid', [at(m.r)]);
      pos = at(m.r);
      add('feed', [at(m.bottom)]);
      pos = at(m.bottom);
      add('rapid', [at(m.retract)]);
      pos = at(m.retract);
      runs.drills.push(at(m.top));
      continue;
    }
    add(m.kind === 'rapid' ? 'rapid' : 'feed', m.kind === 'arc' && pos ? arcPoints(pos, m) : [m.to]);
    pos = m.to;
  }
  return runs;
}

function boxCorner(b: BBox, i: number): Vec3 {
  return { x: i & 1 ? b.max.x : b.min.x, y: i & 2 ? b.max.y : b.min.y, z: i & 4 ? b.max.z : b.min.z };
}
const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const boxEdges = (b: BBox): Polyline[] => BOX_EDGES.map(([a, c]) => [boxCorner(b, a), boxCorner(b, c)]);

/** Mesh: open edges and edges between faces more than 30° apart. Drawing: every path. In program coordinates. */
function modelLines(ctx: CamContext): Polyline[] {
  const g = ctx.geometry;
  if (!g || !ctx.placement) return [];
  if (g.kind === 'drawing') {
    const z = ctx.model?.max.z ?? 0;
    return g.drawing.layers.flatMap((l) => l.paths.map((p) => {
      const pts = flattenPath(drawingPathToProgram(ctx, p), 0.02).map((v): Vec3 => ({ x: v.x, y: v.y, z }));
      return p.closed && pts.length ? [...pts, pts[0]] : pts;
    }));
  }
  const { mesh, adjacency } = g;
  const pos = mesh.positions;
  const placed: Vec3[] = [];
  for (let i = 0; i < pos.length / 3; i++) placed.push(toProgram(ctx, { x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] }));
  const nm = mesh.normals;
  const lines: Polyline[] = [];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const o = adjacency.neighbors[t * 3 + e];
      if (o !== -1 && (o < t || nm[t * 3] * nm[o * 3] + nm[t * 3 + 1] * nm[o * 3 + 1] + nm[t * 3 + 2] * nm[o * 3 + 2] >= COS_FEATURE)) continue;
      lines.push([placed[mesh.indices[t * 3 + e]], placed[mesh.indices[t * 3 + ((e + 1) % 3)]]]);
    }
  }
  return lines;
}

function emptySvg(text: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120" viewBox="0 0 480 120" font-family="Geist, sans-serif">'
    + `<rect width="480" height="120" fill="#ffffff"/><text x="240" y="64" text-anchor="middle" font-size="14" fill="#374151">${esc(text)}</text></svg>`;
}

function pathCommands(pts: readonly number[], close = false): string {
  if (pts.length < 4) return '';
  let out = `M${f1(pts[0])} ${f1(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) out += `L${f1(pts[i])} ${f1(pts[i + 1])}`;
  return close ? `${out}Z` : out;
}

/** An orthographic line drawing of the job: stock, model, toolpaths (feeds solid, rapids dashed), WCS, legend and scale. */
export function renderPreviewSvg(input: PreviewInput, options: PreviewOptions = {}): string {
  const view = options.view ?? 'top';
  const size = Math.min(2048, Math.max(256, Math.round(options.size ?? 1024)));
  const job = input.job;
  const ctx = camContext(job, input.geometry);
  const project = projector(view);
  const ops = input.operations.filter((op) => !options.operations || options.operations.includes(op.id));
  const stock = ctx.stock;
  const model = modelLines(ctx);
  const opRuns = ops.map((op): Runs => (op.toolpath ? toolpathRuns(op.toolpath) : { feed: [], rapid: [], drills: [] }));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const growAll = (lines: Polyline[]) => {
    for (const l of lines) {
      for (const p of l) {
        const q = project(p);
        if (q.x < minX) minX = q.x;
        if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.y > maxY) maxY = q.y;
      }
    }
  };
  if (stock) growAll(boxEdges(stock));
  growAll(model);
  for (const r of opRuns) {
    growAll(r.feed);
    growAll(r.rapid);
  }
  if (!Number.isFinite(minX)) return emptySvg('Nothing to preview: import a model first');

  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const s = (size - 2 * MARGIN) / Math.max(w, h);
  const W = Math.max(320, Math.ceil(w * s + 2 * MARGIN));
  const H = Math.max(240, Math.ceil(h * s + 2 * MARGIN));
  const ox = (W - w * s) / 2;
  const oy = (H - h * s) / 2;
  const screen = (p: Vec3): [number, number] => {
    const q = project(p);
    return [ox + (q.x - minX) * s, H - (oy + (q.y - minY) * s)];
  };
  const flat = (line: Polyline): number[] => {
    const out: number[] = [];
    for (const p of line) {
      const [x, y] = screen(p);
      out.push(x, y);
    }
    return out;
  };
  const d = (lines: Polyline[], simplify: boolean) => lines.map((l) => pathCommands(simplify ? simplifyPolyline(flat(l)) : flat(l))).join('');
  const at = (v: Vec2, z: number): Vec3 => ({ x: v.x, y: v.y, z });

  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#dc2626" stroke-width="1.5"/></pattern></defs>',
  ];
  if (stock) {
    const top = view === 'front' ? '' : `<polygon points="${[4, 5, 7, 6].map((i) => screen(boxCorner(stock, i)).map(f1).join(',')).join(' ')}" fill="#f3f4f6"/>`;
    parts.push(`<g id="stock" stroke="#9ca3af" stroke-width="1" fill="none">${top}<path d="${d(boxEdges(stock), false)}"/></g>`);
  }
  parts.push(`<g id="model" stroke="#4b5563" stroke-width="1" fill="none"><path d="${d(model, input.geometry?.kind === 'drawing')}"/></g>`);

  const regions = ops.flatMap((op) => op.unmachined.flatMap((u) => u.regions.map((r) =>
    [r.outer, ...r.holes].map((ring) => pathCommands(ring.flatMap((v) => screen(at(v, u.z))), true)).join(''))));
  if (regions.length) parts.push(`<g class="unmachined" fill="url(#hatch)" stroke="${ERROR}" stroke-width="1" fill-rule="evenodd"><path d="${regions.join('')}"/></g>`);

  ops.forEach((op, i) => {
    const color = PREVIEW_PALETTE[i % PREVIEW_PALETTE.length];
    const r = opRuns[i];
    const drills = r.drills.map((p) => {
      const [x, y] = screen(p);
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="4"/><path d="M${f1(x - 4)} ${f1(y)}L${f1(x + 4)} ${f1(y)}M${f1(x)} ${f1(y - 4)}L${f1(x)} ${f1(y + 4)}"/>`;
    }).join('');
    parts.push(
      `<g id="op-${i}" data-name="${esc(op.name)}" stroke="${color}" fill="none">`
      + `<path class="rapid" d="${d(r.rapid, true)}" stroke-width="0.75" stroke-dasharray="4 3" opacity="0.7"/>`
      + `<path class="feed" d="${d(r.feed, true)}" stroke-width="1.5"/>${drills}</g>`,
    );
  });

  const [cx, cy] = screen({ x: 0, y: 0, z: 0 });
  const axisMm = 28 / s;
  const axisEnds: [string, Vec3][] = [[ERROR, { x: axisMm, y: 0, z: 0 }], ['#16a34a', { x: 0, y: axisMm, z: 0 }], ['#2563eb', { x: 0, y: 0, z: axisMm }]];
  const axes = axisEnds.map(([color, p]) => {
    const [x, y] = screen(p);
    return Math.hypot(x - cx, y - cy) < 1 ? '' : `<path d="M${f1(cx)} ${f1(cy)}L${f1(x)} ${f1(y)}" stroke="${color}"/>`;
  }).join('');
  parts.push(`<g id="wcs" stroke-width="2">${axes}<text x="${f1(cx + 6)}" y="${f1(cy - 6)}" font-size="12" fill="${INK}">${job.wcs.workOffset}</text></g>`);

  if (ops.length) {
    const label = (op: PreviewOperation) => `${op.name}${op.hasErrors ? ' — error' : ''}`;
    const width = Math.min(W - 24, 48 + 7.5 * Math.max(...ops.map((op) => label(op).length)));
    const rows = ops.map((op, i) => {
      const y = 32 + 20 * i;
      const outline = op.hasErrors ? ` stroke="${ERROR}" stroke-width="2"` : '';
      return `<rect x="20" y="${y - 8}" width="16" height="6" fill="${PREVIEW_PALETTE[i % PREVIEW_PALETTE.length]}"${outline}/>`
        + `<text x="42" y="${y}" font-size="13" fill="${op.hasErrors ? ERROR : INK}">${esc(label(op))}</text>`;
    });
    parts.push(`<g id="legend"><rect x="12" y="12" width="${f1(width)}" height="${rows.length * 20 + 12}" fill="#ffffff" fill-opacity="0.85" stroke="#e5e7eb"/>${rows.join('')}</g>`);
  }

  const unit = job.displayUnits;
  const nice = niceLength(toDisplay(100 / s, unit));
  const px = fromDisplay(nice, unit) * s;
  parts.push(
    `<g id="scale" stroke="${INK}" stroke-width="2"><path d="M12 ${H - 14}L${f1(12 + px)} ${H - 14}M12 ${H - 19}L12 ${H - 9}M${f1(12 + px)} ${H - 19}L${f1(12 + px)} ${H - 9}"/>`
    + `<text x="12" y="${H - 24}" font-size="12" fill="${INK}" stroke="none">${nice} ${unit}</text></g>`,
  );
  if (stock) {
    const fmt = (mm: number) => formatLength(mm, unit, { withUnit: false });
    parts.push(`<text id="dims" x="${W - 12}" y="${H - 14}" text-anchor="end" font-size="12" fill="#374151">Stock ${fmt(stock.max.x - stock.min.x)} × ${fmt(stock.max.y - stock.min.y)} × ${fmt(stock.max.z - stock.min.z)} ${unit}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Geist, sans-serif">${parts.join('')}</svg>`;
}
