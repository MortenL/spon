import type { Vec2 } from '../geometry/path2d';
import type { Vec3 } from '../geometry/vec3';

export type Coolant = 'off' | 'flood' | 'mist';
export type OperationType = 'profile' | 'pocket' | 'drill';

/** A planar face of the mesh, in model-local (raw, pre-orientation) coordinates. */
export interface MeshFaceRef { kind: 'meshFace'; blobId: string; seed: number; normal: Vec3; point: Vec3 }
/** One path of the DXF drawing. */
export interface DxfPathRef { kind: 'dxfPath'; blobId: string; layer: number; path: number }
/** One boundary loop of a face (loop 0 = the outer loop). */
export interface MeshLoopRef { kind: 'meshLoop'; face: MeshFaceRef; loop: number }
/** An inner loop of a face that fits a circle. */
export interface MeshHoleRef { kind: 'meshHole'; face: MeshFaceRef; loop: number }
export type GeometryRef = DxfPathRef | MeshFaceRef | MeshLoopRef | MeshHoleRef;

export type HeightFrom =
  | 'stockTop' | 'stockBottom' | 'modelTop' | 'modelBottom' | 'contour' | 'face' | 'origin' | 'holeBottom'
  | 'retract' | 'feed' | 'top';
export interface HeightSpec { from: HeightFrom; offset: number; face?: MeshFaceRef }
export interface Heights { clearance: HeightSpec; retract: HeightSpec; feed: HeightSpec; top: HeightSpec; bottom: HeightSpec }
export type HeightName = keyof Heights;
export const HEIGHT_NAMES: readonly HeightName[] = ['clearance', 'retract', 'feed', 'top', 'bottom'];
/** Allowed references per height (spec §5). */
export const HEIGHT_FROM: Readonly<Record<HeightName, readonly HeightFrom[]>> = {
  clearance: ['stockTop', 'modelTop', 'origin', 'retract'],
  retract: ['stockTop', 'modelTop', 'origin', 'feed'],
  feed: ['stockTop', 'modelTop', 'origin', 'top'],
  top: ['stockTop', 'modelTop', 'contour', 'face', 'origin'],
  bottom: ['stockTop', 'stockBottom', 'modelTop', 'modelBottom', 'contour', 'face', 'origin', 'holeBottom'],
};

export interface Feeds { presetName: string | null; rpm: number; feed: number; plungeFeed: number; coolant: Coolant }
export interface EntrySettings { mode: 'auto' | 'helix' | 'ramp' | 'plunge'; helixDiameterPct: number; rampAngleDeg: number }
/** Position along contour `refIndex`'s tool-centre lap, as a fraction t ∈ [0, 1) of its length. */
export interface LapPosition { refIndex: number; t: number }
export interface LeadSettings { mode: 'none' | 'arc' | 'line'; length: number; startPoint: 'auto' | LapPosition }
export interface TabSettings {
  enabled: boolean;
  shape: 'rect' | 'triangle';
  width: number;
  height: number;
  placement: 'count' | 'spacing';
  count: number;
  spacing: number;
  /** null = automatic; set once the user drags a tab. */
  positions: LapPosition[] | null;
}

export interface OperationBase {
  id: string;
  name: string;
  enabled: boolean;
  toolId: string | null;
  feeds: Feeds;
  heights: Heights;
  geometry: GeometryRef[];
}
export interface ProfileOp extends OperationBase {
  type: 'profile';
  side: 'outside' | 'inside' | 'on';
  direction: 'climb' | 'conventional';
  stepdown: number;
  stockRadial: number;
  stockAxial: number;
  finishPass: boolean;
  entry: EntrySettings;
  leads: LeadSettings;
  tabs: TabSettings;
}
export interface PocketOp extends OperationBase {
  type: 'pocket';
  direction: 'climb' | 'conventional';
  stepdown: number;
  stepoverPct: number;
  stockRadial: number;
  stockAxial: number;
  finishWalls: boolean;
  finishFloor: boolean;
  entry: EntrySettings;
}
export type DrillCycle = 'drill' | 'dwell' | 'peck' | 'chipbreak';
export interface DrillOp extends OperationBase {
  type: 'drill';
  cycle: DrillCycle;
  peck: number;
  dwellSeconds: number;
  diameterFilter: { min: number; max: number } | null;
}
export type Operation = ProfileOp | PocketOp | DrillOp;

type AllFields = Omit<ProfileOp, 'id' | 'type'> & Omit<PocketOp, 'id' | 'type'> & Omit<DrillOp, 'id' | 'type'>;
/** Any operation field; object-valued fields are merged one level deep. */
export type OperationPatch = {
  [K in keyof AllFields]?: K extends 'heights' ? Partial<Heights> : K extends 'feeds' | 'entry' | 'leads' | 'tabs' ? Partial<AllFields[K]> : AllFields[K];
};

// ── toolpaths ────────────────────────────────────────────────────────────
export type Move =
  | { kind: 'rapid'; to: Vec3 }
  | { kind: 'line'; to: Vec3; feed: number }
  /** XY-plane arc from the current position; `to.z` may differ (helix). A full circle has `to` equal to the start. */
  | { kind: 'arc'; to: Vec3; center: Vec2; ccw: boolean; feed: number }
  | {
      kind: 'cycle'; cycle: DrillCycle; at: Vec2; top: number; bottom: number;
      /** R plane (feed height). */ r: number;
      /** Initial level returned to after the hole (G98). */ retract: number;
      peck: number; dwell: number; feed: number;
    };

export interface Toolpath {
  operationId: string;
  operationName: string;
  toolId: string;
  rpm: number;
  coolant: Coolant;
  clearance: number;
  moves: Move[];
}

export type CamSeverity = 'error' | 'warning';
export type CamCode =
  | 'no-tool' | 'no-geometry' | 'ref-missing' | 'ref-changed' | 'face-not-horizontal' | 'open-contour' | 'no-stock'
  | 'heights-invalid' | 'offset-collapsed' | 'tool-too-large' | 'tool-undersize' | 'entry-plunge' | 'unmachined-area'
  | 'tab-skipped' | 'stepdown-exceeds-flute' | 'feed-exceeds-machine' | 'tool-number-duplicate' | 'internal';
export interface CamDiagnostic {
  operationId: string;
  severity: CamSeverity;
  code: CamCode;
  message: string;
  /** Index into the operation's geometry list, when the problem belongs to one reference. */
  ref?: number;
}
