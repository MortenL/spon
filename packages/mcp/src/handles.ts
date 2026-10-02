import type { CatalogContour, CatalogFace, CatalogHole, CatalogSlot, GeometryCatalog, GeometryRef } from '@sponcam/core';
import { SessionError } from './session';

export type HandledLoop = CatalogFace['loops'][number] & { handle: string };
export type HandledFace = Omit<CatalogFace, 'loops'> & { handle: string; loops: HandledLoop[] };
export type HandledHole = CatalogHole & { handle: string };
export type HandledContour = CatalogContour & { handle: string };
export type HandledSlot = CatalogSlot & { handle: string };
export interface HandledCatalog { faces: HandledFace[]; holes: HandledHole[]; contours: HandledContour[]; slots: HandledSlot[] }

/** Short names (F1, F1.L0, H1, C1, S1) for the latest describe_geometry catalog. Refs are raw-model based, so they survive reorienting. */
export class HandleMap {
  private refs = new Map<string, GeometryRef>();

  assign(catalog: GeometryCatalog): HandledCatalog {
    this.refs.clear();
    const name = <T>(handle: string, ref: GeometryRef, item: T): T & { handle: string } => {
      this.refs.set(handle, ref);
      return { ...item, handle };
    };
    const faces = catalog.faces.map((f, i) => {
      const handle = `F${i + 1}`;
      this.refs.set(handle, f.ref);
      const loops = f.loops.map((l) => name(`${handle}.L${l.index}`, { kind: 'meshLoop', face: f.ref, loop: l.index }, l));
      return { ...f, handle, loops };
    });
    const holes = catalog.holes.map((h, i) => name(`H${i + 1}`, h.ref, h));
    const contours = catalog.contours.map((c, i) => name(`C${i + 1}`, c.ref, c));
    const slots = catalog.slots.map((s, i) => name(`S${i + 1}`, s.ref, s));
    return { faces, holes, contours, slots };
  }

  resolve(item: string | GeometryRef): GeometryRef {
    if (typeof item !== 'string') return item;
    const raw = item.trim().toUpperCase();
    const reverse = raw.endsWith('!');
    const ref = this.refs.get(reverse ? raw.slice(0, -1) : raw);
    if (!ref) throw new SessionError(`Unknown handle ${item.trim()} — call describe_geometry for the current list`);
    if (!reverse) return ref;
    if (ref.kind !== 'dxfPath') throw new SessionError('Only drawing contours (C…) can be reversed');
    return { ...ref, reverse: true };
  }

  clear(): void {
    this.refs.clear();
  }

  get size(): number {
    return this.refs.size;
  }
}

const mm = (v: number) => v.toFixed(3);
/** A slot's width or length to 0.1 mm without trailing zeros (6.5, 13.5, 8); faceted models give 13.482 for a 13.5 mm slot. */
const dim = (v: number) => String(+v.toFixed(1));
const at = (c: { x: number; y: number }) => `(${mm(c.x)}, ${mm(c.y)})`;

/** One line per face, hole and contour, in program coordinates (mm). */
export function catalogText(c: HandledCatalog): string {
  const lines: string[] = [];
  for (const f of c.faces) {
    const loops = f.loops.map((l) => `${l.handle} ${l.kind}${l.circle ? ` ⌀${mm(l.circle.diameter)} at ${at(l.circle.center)}` : ` length ${l.length.toFixed(1)}`}`);
    lines.push(`${f.handle} face z ${mm(f.z)}, area ${f.area.toFixed(1)} mm²; loops: ${loops.join(', ')}`);
  }
  for (const h of c.holes) lines.push(`${h.handle} ⌀${mm(h.diameter)} at ${at(h.center)}, z ${mm(h.bottom)} to ${mm(h.top)}, ${h.through ? 'through' : 'blind'}`);
  for (const s of c.slots) {
    const arc = s.kind === 'arc' && s.center && s.radius !== undefined ? `, radius ${dim(s.radius)} about ${at(s.center)}` : '';
    lines.push(`${s.handle} slot ${dim(s.width)} × ${dim(s.length)} (${s.kind}, ${s.ends[0]}/${s.ends[1]}) at ${at(s.start)} → ${at(s.end)}${arc}, z ${mm(s.bottom)} to ${mm(s.top)}, ${s.through ? 'through' : 'blind'}`);
  }
  for (const k of c.contours) {
    const shape = k.circle ? `circle ⌀${mm(k.circle.diameter)} at ${at(k.circle.center)}` : `box ${at(k.bbox.min)} to ${at(k.bbox.max)}`;
    lines.push(`${k.handle} contour on layer ${k.layer}, ${k.closed ? 'closed' : 'open'}, length ${k.length.toFixed(1)}, ${shape}${k.closed ? '' : `, from ${at(k.start)} to ${at(k.end)}`}`);
  }
  return lines.join('\n');
}
