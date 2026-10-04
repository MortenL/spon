import { dist2 } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import type { Vec3 } from '../../geometry/vec3';
import { threadDims } from '../../thread/derive';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights } from '../heights';
import type { CamCode, CamSeverity, ThreadOp, Toolpath } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { MoveWriter } from './writer';

/** One helical orbit around a hole or boss axis; `turns` may be fractional. */
export interface HelixPlan { center: Vec2; radius: number; zStart: number; zEnd: number; ccw: boolean; turns: number }

const EPS = 1e-9;
const p3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Spec §5.1: the spindle turns clockwise (M3); this is the orbit rotation and whether Z rises. */
export function threadDirection(kind: 'internal' | 'external', hand: 'right' | 'left', direction: 'climb' | 'conventional'): { ccw: boolean; up: boolean } {
  const climb = direction === 'climb';
  // internal climb turns counter-clockwise, external climb clockwise; a right-hand helix rises while turning counter-clockwise
  const ccw = kind === 'internal' ? climb : !climb;
  const up = ccw === (hand === 'right');
  return { ccw, up };
}

interface Feature { center: Vec2; diameter: number; top: number; bottom: number; through: boolean; ref: number }

/**
 * The orbits of one radial pass, in cutting order (Clarification 3); the thread's lowest Z is top - length.
 * Single-point mills run one long helix; multi-tooth mills run one 370 degree orbit, or several shifted by whole tooth blocks.
 */
function planOrbits(op: ThreadOp, tool: Tool, center: Vec2, radius: number, top: number): HelixPlan[] {
  const P = op.thread.pitch;
  const bottom = top - op.length;
  const { ccw, up } = threadDirection(op.kind, op.hand, op.direction);
  const spec = tool.thread!;
  const mk = (lo: number, hi: number, turns: number): HelixPlan => ({ center, radius, zStart: up ? lo : hi, zEnd: up ? hi : lo, ccw, turns });
  if (spec.pitch === null || spec.teeth <= 1) {
    const lo = bottom - P / 4;
    const hi = top + P / 4;
    return [mk(lo, hi, (hi - lo) / P)];
  }
  const L = spec.teeth * P;
  const turns = 370 / 360;
  const lo0 = bottom - P / 4;
  if (L >= op.length + P / 2 - EPS) return [mk(lo0, lo0 + P * turns, turns)];
  const k = Math.ceil((op.length + P / 2) / L - EPS); // the last orbit's teeth must still pass the P/4 above the top
  const shift = Math.floor(L / P + EPS) * P;
  return Array.from({ length: k }, (_, j) => mk(lo0 + j * shift, lo0 + j * shift + P * turns, turns));
}

/** Radii of the passes: linear from the start to the final radius, then a repeat of the final one for a spring pass. */
function passRadii(start: number, final: number, passes: number, spring: boolean): number[] {
  const n = Math.max(1, Math.floor(passes));
  const radii = Array.from({ length: n }, (_, k) => Math.max(0, start + ((final - start) * (k + 1)) / n));
  if (spring) radii.push(radii[radii.length - 1]);
  return radii;
}

/** The helix as arcs of at most 90 degrees about its centre, from angle 0, Z moving linearly with the angle. */
function emitOrbit(w: MoveWriter, h: HelixPlan, feed: number): void {
  const total = h.turns * 360;
  const full = Math.floor(total / 90 + 1e-9);
  const rem = total - full * 90;
  const pieces = Array.from({ length: full }, () => 90);
  if (rem > 1e-6) pieces.push(rem);
  let done = 0;
  pieces.forEach((degrees, i) => {
    done += degrees;
    const a = ((h.ccw ? 1 : -1) * done * Math.PI) / 180;
    const z = i === pieces.length - 1 ? h.zEnd : h.zStart + ((h.zEnd - h.zStart) * done) / total;
    w.arc(p3(h.center.x + h.radius * Math.cos(a), h.center.y + h.radius * Math.sin(a), z), h.center, h.ccw, feed);
  });
}

/** Where the orbit ends: the angle (radians) and point. */
function orbitEnd(h: HelixPlan): { angle: number; point: Vec2 } {
  const angle = (h.ccw ? 1 : -1) * h.turns * 2 * Math.PI;
  return { angle, point: { x: h.center.x + h.radius * Math.cos(angle), y: h.center.y + h.radius * Math.sin(angle) } };
}

/**
 * An external orbit with its approach: plunge at `rOut` from the axis, a tangent S-curve in to the orbit radius (opposite in sense
 * to the orbit), the helix, and the mirrored exit back out to `rOut`.
 */
function externalOrbit(w: MoveWriter, h: HelixPlan, rOut: number, plungeFeed: number, feed: number, moveTo: (xy: Vec2) => void): void {
  const c = h.center;
  const rho = Math.max(0, (rOut - h.radius) / 2);
  const s: Vec2 = { x: c.x + rOut, y: c.y };
  moveTo(s);
  if (Math.abs(w.pos!.z - h.zStart) > EPS) w.line(p3(s.x, s.y, h.zStart), plungeFeed);
  const into = p3(c.x + h.radius, c.y, h.zStart);
  if (rho > 1e-6) w.arc(into, { x: c.x + h.radius + rho, y: c.y }, !h.ccw, feed);
  else w.line(into, feed);
  emitOrbit(w, h, feed);
  const e = orbitEnd(h);
  const ux = Math.cos(e.angle), uy = Math.sin(e.angle);
  const out = p3(c.x + rOut * ux, c.y + rOut * uy, h.zEnd);
  if (rho > 1e-6) w.arc(out, { x: e.point.x + rho * ux, y: e.point.y + rho * uy }, !h.ccw, feed);
  else w.line(out, feed);
}

const fmt = (x: number) => x.toFixed(2);
const angleText = (x: number) => String(Number(x.toFixed(1)));

export function threadToolpath(op: ThreadOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const internal = op.kind === 'internal';
  const dims = threadDims(op.thread);
  const P = op.thread.pitch;
  const d = tool.diameter;
  const major = op.thread.majorDiameter;

  // tool-level checks, in the order of spec §6
  if (tool.type !== 'threadmill' || !tool.thread) { diag('error', 'wrong-tool', 'Thread milling needs a thread mill'); return out; }
  const spec = tool.thread;
  if (Math.abs(tool.tipAngleDeg - op.thread.angle) > 0.5) {
    diag('error', 'thread-angle', `The cutter's ${angleText(tool.tipAngleDeg)}° tooth does not match the ${angleText(op.thread.angle)}° thread`);
    return out;
  }
  if (spec.pitch !== null && Math.abs(spec.pitch - P) > 0.01) {
    diag('error', 'thread-pitch', `This multi-tooth cutter cuts ${fmt(spec.pitch)} mm pitch; the thread needs ${fmt(P)} mm`);
    return out;
  }
  const rFinal = internal ? major / 2 + op.allowance - d / 2 : dims.minorExternal / 2 - op.allowance + d / 2;
  if (rFinal <= 0 || (internal && d >= dims.minorInternal)) { diag('error', 'tool-too-big', 'The thread mill is too big for this hole'); return out; }
  const depth = internal ? dims.depthInternal : dims.depthExternal;
  if (spec.neckDiameter > d - 2 * depth + EPS) { diag('error', 'thread-neck', 'The cutter\'s neck is too thick for this thread depth'); return out; }

  const features: Feature[] = internal
    ? geo.holes.map((h) => ({ ...h }))
    : geo.bosses.map((b) => ({ center: b.center, diameter: b.diameter, top: b.top, bottom: -Infinity, through: true, ref: b.ref }));
  if (!features.length) {
    if (!geo.diagnostics.some((x) => x.severity === 'error')) diag('error', 'no-geometry', internal ? 'There are no holes to thread' : 'There are no bosses to thread');
    return out;
  }

  const stockTop = ctx.stock?.max.z ?? ctx.model?.max.z ?? null;
  const ok: Feature[] = [];
  for (const f of features) {
    const bottom = f.top - op.length;
    const reach = op.length + (stockTop === null ? 0 : Math.max(0, stockTop - f.top));
    if (spec.neckLength < reach - EPS) { diag('error', 'thread-reach', `The thread mill cannot reach ${fmt(reach)} mm deep`, f.ref); continue; }
    if (internal && !f.through && bottom < f.bottom - EPS) { diag('error', 'thread-too-deep', 'The thread runs below the bottom of the hole', f.ref); continue; }
    if (internal) {
      if (f.diameter < dims.minorInternal - 0.01) {
        diag('warning', 'hole-small', `The hole is smaller than the thread's minor diameter (${fmt(dims.minorInternal)} mm); drill ${dims.tapDrill.toFixed(1)} mm first`, f.ref);
      } else if (f.diameter > major + 0.01) {
        diag('error', 'hole-large', `The hole is larger than the thread (${fmt(major)} mm)`, f.ref);
        continue;
      }
    } else if (Math.abs(f.diameter - major) > 0.1) {
      diag('warning', 'boss-size', `The boss is ${fmt(f.diameter)} mm; the thread's major diameter is ${fmt(major)} mm`, f.ref);
    }
    ok.push(f);
  }

  const ordered: Feature[] = [];
  let at: Vec2 = { x: 0, y: 0 };
  while (ok.length) {
    let best = 0;
    for (let i = 1; i < ok.length; i++) if (dist2(ok[i].center, at) < dist2(ok[best].center, at) - 1e-12) best = i;
    const [f] = ok.splice(best, 1);
    ordered.push(f);
    at = f.center;
  }

  const w = new MoveWriter();
  // external: a path at the boss surface for the gouge check (the real path cuts into the boss on purpose)
  const shadow = new MoveWriter();
  let clearance = -Infinity;
  const refRadius = internal ? major / 2 + op.allowance : dims.minorExternal / 2 - op.allowance;
  for (const f of ordered) {
    const hr = resolveHeights({ ...op.heights, bottom: { from: 'holeBottom', offset: 0 } }, ctx, { contourZ: f.top, holeBottom: f.top - op.length, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, f.ref);
      continue;
    }
    const v = hr.values;
    out.heights ??= v;
    clearance = Math.max(clearance, v.clearance);
    const R = f.diameter / 2;
    const start = internal ? Math.max(0, R - d / 2) : R + d / 2;
    const c = f.center;
    /** Over to `xy` at or above `safe`, then down to the retract height. */
    const moveTo = (xy: Vec2, safe: number) => {
      if (!w.pos) w.travel(xy, v.clearance, v.retract);
      else if (Math.hypot(w.pos.x - xy.x, w.pos.y - xy.y) > EPS) w.travel(xy, Math.max(w.pos.z, safe), v.retract);
    };
    const radii = passRadii(start, rFinal, op.passes, op.springPass);
    for (const r of radii) {
      const feed = op.feeds.feed * (op.feedCompensation ? r / refRadius : 1);
      for (const h of planOrbits(op, tool, c, r, f.top)) {
        if (internal) {
          moveTo(c, v.clearance);
          if (Math.abs(w.pos!.z - h.zStart) > EPS) w.line(p3(c.x, c.y, h.zStart), op.feeds.plungeFeed);
          // half circle of radius r/2 from the centre, ending tangent to the orbit start
          if (r > EPS) w.arc(p3(c.x + r, c.y, h.zStart), { x: c.x + r / 2, y: c.y }, h.ccw, feed);
          emitOrbit(w, h, feed);
          if (r > EPS) {
            const e = orbitEnd(h);
            w.arc(p3(c.x, c.y, h.zEnd), { x: (e.point.x + c.x) / 2, y: (e.point.y + c.y) / 2 }, h.ccw, feed);
          }
        } else {
          externalOrbit(w, h, r + d / 2 + 2, op.feeds.plungeFeed, feed, (xy) => moveTo(xy, v.retract));
        }
      }
    }
    if (!internal) {
      // the tool at the boss surface: the helix without the radial cut, but the real plunge and entry/exit arcs
      const rs = R + d / 2;
      const rOut = Math.max(rs, ...radii) + d / 2 + 2;
      for (const h of planOrbits(op, tool, c, rs, f.top)) {
        externalOrbit(shadow, h, rOut, op.feeds.plungeFeed, op.feeds.feed, (xy) => {
          if (!shadow.pos) shadow.travel(xy, v.clearance, v.retract);
          else if (Math.hypot(shadow.pos.x - xy.x, shadow.pos.y - xy.y) > EPS) shadow.travel(xy, Math.max(shadow.pos.z, v.retract), v.retract);
        });
      }
      shadow.up(v.clearance);
    }
    w.up(v.clearance);
  }
  if (!w.moves.length) return out;
  const make = (moves: Toolpath['moves']): Toolpath => ({
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves,
  });
  out.toolpath = make(w.moves);
  if (!internal) out.gougePath = make(shadow.moves);
  return out;
}
