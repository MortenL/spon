import type { CatalogContour, CatalogFace, CatalogHole, GeometryCatalog, GeometryRef } from '@sponcam/core';
import { SessionError } from './session';

export type HandledLoop = CatalogFace['loops'][number] & { handle: string };
export type HandledFace = Omit<CatalogFace, 'loops'> & { handle: string; loops: HandledLoop[] };
export type HandledHole = CatalogHole & { handle: string };
export type HandledContour = CatalogContour & { handle: string };
export interface HandledCatalog { faces: HandledFace[]; holes: HandledHole[]; contours: HandledContour[] }

/** Short names (F1, F1.L0, H1, C1) for the latest describe_geometry catalog. Refs are raw-model based, so they survive reorienting. */
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
    return { faces, holes, contours };
  }

  resolve(item: string | GeometryRef): GeometryRef {
    if (typeof item !== 'string') return item;
    const ref = this.refs.get(item.trim().toUpperCase());
    if (!ref) throw new SessionError(`Unknown handle ${item.trim()} — call describe_geometry for the current list`);
    return ref;
  }

  clear(): void {
    this.refs.clear();
  }

  get size(): number {
    return this.refs.size;
  }
}

const mm = (v: number) => v.toFixed(3);
const at = (c: { x: number; y: number }) => `(${mm(c.x)}, ${mm(c.y)})`;

/** One line per face, hole and contour, in program coordinates (mm). */
export function catalogText(c: HandledCatalog): string {
  const lines: string[] = [];
  for (const f of c.faces) {
    const loops = f.loops.map((l) => `${l.handle} ${l.kind}${l.circle ? ` ⌀${mm(l.circle.diameter)} at ${at(l.circle.center)}` : ` length ${l.length.toFixed(1)}`}`);
    lines.push(`${f.handle} face z ${mm(f.z)}, area ${f.area.toFixed(1)} mm²; loops: ${loops.join(', ')}`);
  }
  for (const h of c.holes) lines.push(`${h.handle} ⌀${mm(h.diameter)} at ${at(h.center)}, z ${mm(h.bottom)} to ${mm(h.top)}, ${h.through ? 'through' : 'blind'}`);
  for (const k of c.contours) {
    const shape = k.circle ? `circle ⌀${mm(k.circle.diameter)} at ${at(k.circle.center)}` : `box ${at(k.bbox.min)} to ${at(k.bbox.max)}`;
    lines.push(`${k.handle} contour on layer ${k.layer}, ${k.closed ? 'closed' : 'open'}, length ${k.length.toFixed(1)}, ${shape}`);
  }
  return lines.join('\n');
}
