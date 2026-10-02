import type { Poly } from '../../geometry/offset/clipper';
import type { Vec2 } from '../../geometry/path2d';
import type { Vec3 } from '../../geometry/vec3';
import type { ResolvedHeights } from '../heights';
import type { CamDiagnostic, Toolpath } from '../types';

export interface OpOverlays {
  /** Tab centres: lap index, fraction of the lap and program XY. */
  tabs: { refIndex: number; t: number; point: Vec2 }[];
  /** Tool-centre laps (flattened) that carry tabs, at the tab top Z, for dragging tabs. */
  laps: { refIndex: number; points: Vec2[]; z: number }[];
  /** Pocket material the tool cannot reach, at the pocket floor: separate regions, each an outer boundary with holes. */
  unmachined: { regions: { outer: Vec2[]; holes: Vec2[][] }[]; z: number }[];
  /** Places where the tool cuts into the model: the tool-tip point and how deep. */
  gouges: { point: Vec3; depth: number }[];
}

export interface OpOutput {
  toolpath: Toolpath | null;
  diagnostics: CamDiagnostic[];
  /** Heights of the first feature (for the heights planes in the viewport). */
  heights: ResolvedHeights | null;
  overlays: OpOverlays;
  /** Areas (tool-centre XY) where cutting into the model is intended, e.g. square slot ends cut to the wall (spec §3.8). */
  intended?: { zone: Poly[]; message: string }[];
}

export const emptyOverlays = (): OpOverlays => ({ tabs: [], laps: [], unmachined: [], gouges: [] });
