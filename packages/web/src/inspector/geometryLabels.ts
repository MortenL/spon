import { formatLength, type GeometryCatalog, type GeometryRef, type LengthUnit, type MeshFaceRef } from '@sponcam/core';

const sameFace = (a: MeshFaceRef, b: MeshFaceRef) => a.blobId === b.blobId && a.seed === b.seed;

export function sameRef(a: GeometryRef, b: GeometryRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'dxfPath' && b.kind === 'dxfPath') return a.blobId === b.blobId && a.layer === b.layer && a.path === b.path;
  if (a.kind === 'meshFace' && b.kind === 'meshFace') return sameFace(a, b);
  if ((a.kind === 'meshLoop' || a.kind === 'meshHole') && (b.kind === 'meshLoop' || b.kind === 'meshHole')) return sameFace(a.face, b.face) && a.loop === b.loop;
  if (a.kind === 'text' && b.kind === 'text') return a.textId === b.textId;
  if (a.kind === 'meshSlot' && b.kind === 'meshSlot') return sameFace(a.face, b.face) && a.loop === b.loop;
  return false;
}

export function toggleRef(list: readonly GeometryRef[], ref: GeometryRef): GeometryRef[] {
  return list.some((r) => sameRef(r, ref)) ? list.filter((r) => !sameRef(r, ref)) : [...list, ref];
}

/** Human-readable label for a geometry reference, resolved against the describeGeometry catalog. */
export function refLabel(ref: GeometryRef, catalog: GeometryCatalog | null, layers: string[] | null, units: LengthUnit, texts: readonly { id: string; name: string }[] = []): string {
  const L = (mm: number) => formatLength(mm, units);
  if (ref.kind === 'dxfPath') return `${layers?.[ref.layer] ?? `Layer ${ref.layer + 1}`} · path ${ref.path + 1}`;
  if (ref.kind === 'text') {
    const t = texts.find((x) => x.id === ref.textId);
    return t ? `Text: ${t.name}` : 'Text (deleted)';
  }
  if (ref.kind === 'meshSlot') {
    const slot = catalog?.slots.find((s) => sameRef(s.ref, ref));
    return slot ? `Slot ${L(slot.width)} × ${L(slot.length)}` : 'Slot (not found)';
  }
  const faceRef = ref.kind === 'meshFace' ? ref : ref.face;
  const face = catalog?.faces.find((f) => sameFace(f.ref, faceRef));
  if (!face) return ref.kind === 'meshFace' ? 'Face (not found)' : ref.kind === 'meshHole' ? 'Hole (not found)' : 'Edge loop (not found)';
  if (ref.kind === 'meshFace') return `Face at Z ${L(face.z)}`;
  const circle = face.loops[ref.loop]?.circle;
  if (ref.kind === 'meshHole' && circle) return `Hole Ø${L(circle.diameter)} at (${L(circle.center.x)}, ${L(circle.center.y)})`;
  return `Edge loop ${ref.loop + 1} of face at Z ${L(face.z)}`;
}
