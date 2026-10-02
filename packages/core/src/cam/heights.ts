import type { CamContext } from './context';
import { HEIGHT_FROM, type HeightName, type Heights, type HeightSpec, type MeshFaceRef } from './types';

export interface ResolvedHeights { clearance: number; retract: number; feed: number; top: number; bottom: number }
export interface HeightInputs {
  /** Z of the contour, hole top or face being machined. */
  contourZ: number | null;
  holeBottom: number | null;
  faceZ?: (ref: MeshFaceRef) => number | null;
  /** Facing: an empty depth reads "Set the facing depth" rather than a generic order error. */
  facing?: boolean;
}

const LABEL: Record<HeightName, string> = { clearance: 'Clearance', retract: 'Retract', feed: 'Feed', top: 'Top', bottom: 'Bottom' };
/** Order of evaluation: every height only refers to heights resolved before it. */
const ORDER: readonly HeightName[] = ['top', 'bottom', 'feed', 'retract', 'clearance'];

export function resolveHeights(h: Heights, ctx: CamContext, inputs: HeightInputs): { values: ResolvedHeights | null; errors: string[] } {
  const errors: string[] = [];
  const v: Partial<ResolvedHeights> = {};
  const need = (name: HeightName, what: string): null => {
    errors.push(`${LABEL[name]} height needs ${what}`);
    return null;
  };
  const base = (name: HeightName, spec: HeightSpec): number | null => {
    if (!HEIGHT_FROM[name].includes(spec.from)) {
      errors.push(`${LABEL[name]} height cannot be measured from ${spec.from}`);
      return null;
    }
    switch (spec.from) {
      case 'stockTop': return ctx.stock ? ctx.stock.max.z : need(name, 'stock');
      case 'stockBottom': return ctx.stock ? ctx.stock.min.z : need(name, 'stock');
      case 'modelTop': return ctx.model ? ctx.model.max.z : need(name, 'a model');
      case 'modelBottom': return ctx.model ? ctx.model.min.z : need(name, 'a model');
      case 'contour': return inputs.contourZ ?? need(name, 'a contour');
      case 'face': {
        const z = spec.face && inputs.faceZ ? inputs.faceZ(spec.face) : null;
        return z ?? need(name, 'a picked face');
      }
      case 'origin': return 0;
      case 'holeBottom': return inputs.holeBottom ?? need(name, 'a hole');
      case 'top': return v.top ?? null;
      case 'feed': return v.feed ?? null;
      case 'retract': return v.retract ?? null;
    }
  };
  for (const name of ORDER) {
    const b = base(name, h[name]);
    if (b !== null) v[name] = b + h[name].offset;
  }
  if (errors.length) return { values: null, errors };
  const r = v as ResolvedHeights;
  if (r.bottom >= r.top) errors.push(inputs.facing ? 'Set the facing depth (Heights → Bottom)' : 'Bottom height must be below top height');
  if (r.feed < r.top) errors.push('Feed height must not be below top height');
  if (r.retract < r.feed) errors.push('Retract height must not be below feed height');
  if (r.clearance < r.retract) errors.push('Clearance height must not be below retract height');
  return errors.length ? { values: null, errors } : { values: r, errors };
}
