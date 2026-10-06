import type { Poly } from '../../geometry/offset/clipper';
import type { Vec2 } from '../../geometry/path2d';
import type { Vec3 } from '../../geometry/vec3';
import type { ResolvedHeights } from '../heights';
import type { CamDiagnostic, Toolpath } from '../types';

export interface OpOverlays {
  /** Tab centres: contour index, the tab's index within its contour, fraction of the lap, program XY, and whether it is a manual tab. */
  tabs: { refIndex: number; index: number; t: number; point: Vec2; manual: boolean }[];
  /** Tool-centre path (flattened) of every contour of an op with tabs enabled, at the tab top Z, for placing and dragging tabs. */
  tabPaths: { refIndex: number; points: Vec2[]; z: number; closed: boolean }[];
  /** Footprints of the tab bridges left in the material, at the tab top Z (filled in once bridges are drawn). */
  tabBridges: { polygon: Vec2[]; z: number }[];
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
  /** External threads: the path the gouge check runs instead (the real path cuts into the boss on purpose). */
  gougePath?: Toolpath;
  /** Areas (tool-centre XY) where cutting into the model is intended, e.g. square slot ends cut to the wall (spec §3.8). */
  intended?: { zone: Poly[]; message: string; minZ?: number }[];
}

export const emptyOverlays = (): OpOverlays => ({ tabs: [], tabPaths: [], tabBridges: [], unmachined: [], gouges: [] });
