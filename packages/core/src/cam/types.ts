import type { Vec2 } from '../geometry/path2d';
import type { Vec3 } from '../geometry/vec3';
import type { ThreadSpec } from '../thread/table';

export type Coolant = 'off' | 'flood' | 'mist';
export type OperationType = 'profile' | 'pocket' | 'drill' | 'face' | 'chamfer' | 'slot' | 'engrave' | 'vcarve' | 'vclear' | 'vplug' | 'thread';

/** A planar face of the mesh, in model-local (raw, pre-orientation) coordinates. */
export interface MeshFaceRef { kind: 'meshFace'; blobId: string; seed: number; normal: Vec3; point: Vec3 }
/** One path of the DXF drawing. */
export interface DxfPathRef { kind: 'dxfPath'; blobId: string; layer: number; path: number; /** Open chains seeded by this reference run against its drawn direction. */ reverse?: true }
/** One boundary loop of a face (loop 0 = the outer loop). */
export interface MeshLoopRef { kind: 'meshLoop'; face: MeshFaceRef; loop: number }
/** An inner loop of a face that fits a circle. */
export interface MeshHoleRef { kind: 'meshHole'; face: MeshFaceRef; loop: number }
export type SlotEnd = 'round' | 'square' | 'open';
/** A recognised slot: with `loop`, inner loop `loop` of the up-facing face around it (a closed slot); without, `face` is its floor (an open slot). */
export interface MeshSlotRef { kind: 'meshSlot'; face: MeshFaceRef; loop?: number }
/** A text item of the job (outline or single-line letters). */
export interface TextRef { kind: 'text'; textId: string }
/** A round boss (outer cylinder) of the mesh, for external threads: one boundary loop of a face. */
export interface MeshBossRef { kind: 'meshBoss'; face: MeshFaceRef }
export type GeometryRef = DxfPathRef | MeshFaceRef | MeshLoopRef | MeshHoleRef | MeshSlotRef | MeshBossRef | TextRef;

export type HeightFrom =
  | 'stockTop' | 'stockBottom' | 'modelTop' | 'modelBottom' | 'contour' | 'face' | 'origin' | 'holeBottom' | 'slotBottom'
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
  bottom: ['stockTop', 'stockBottom', 'modelTop', 'modelBottom', 'contour', 'face', 'origin', 'holeBottom', 'slotBottom'],
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
  /** Open chains: which side of the line (seen along its direction) the tool runs on. */
  openSide: 'left' | 'on' | 'right';
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
export interface FaceOp extends OperationBase {
  type: 'face';
  /** `stock`: the whole stock top (no geometry needed); `picked`: the closed areas in `geometry`. */
  area: 'stock' | 'picked';
  /** How far the tool centre runs past the area's edge. */
  overlap: number;
  pattern: 'zigzag' | 'spiral';
  angleDeg: number;
  stepoverPct: number;
  oneWay: boolean;
  direction: 'climb' | 'conventional';
  stepdown: number;
  finishPass: boolean;
  finishStepoverPct: number;
}
export interface ChamferOp extends OperationBase {
  type: 'chamfer';
  /** `auto` decides per reference: outlines outside, inner loops and holes inside. */
  side: 'auto' | 'outside' | 'inside';
  /** Open chains: which side of the line (seen along its direction) the tool runs on. */
  openSide: 'left' | 'right';
  direction: 'climb' | 'conventional';
  width: number;
  tipOffset: number;
  /** 0 = one pass. */
  stepdown: number;
}
export interface SlotOp extends OperationBase {
  type: 'slot';
  strategy: 'auto' | 'toolWidth' | 'wider' | 'trochoidal';
  /** Width of slots cut along drawn centrelines; recognised slots bring their own. */
  width: number;
  /** Wider and trochoidal passes only. */
  direction: 'climb' | 'conventional';
  stepdown: number;
  /** Wider: % of the tool diameter between racetrack loops. */
  stepoverPct: number;
  stockRadial: number;
  stockAxial: number;
  finishWalls: boolean;
  entry: EntrySettings;
  /** Trochoidal: % of the tool diameter the loop centre moves per loop. */
  trochoidal: { stepPct: number };
  /** How square ends of recognised slots are cut; null = not chosen yet (an error when a picked slot has one). */
  squareEnds: 'inside' | 'endWall' | 'dogbone' | null;
}
export interface EngraveOp extends OperationBase {
  type: 'engrave';
  /** `depth`: cut to `depth`; `width`: a V-bit sinks until the groove is `lineWidth` wide. */
  depthMode: 'depth' | 'width';
  depth: number;
  lineWidth: number;
  stepdown: number;
}
/** Inlay settings stored on a base V-carve (Milestone 4.4c). */
export interface InlaySettings {
  startDepth: number;
  glueGap: number;
  margin: number;
  plugBoard: { x: number; y: number; z: number };
  plugFileName: string;
}
export interface VCarveOp extends OperationBase {
  type: 'vcarve';
  /** null = no limit (the shape's own depth). */
  maxDepth: number | null;
  /** null = one pass. */
  stepdown: number | null;
  inlay?: InlaySettings;
}
/** The V-carve plug of an inlay: cut in the mirrored plug stock. */
export interface VPlugOp extends OperationBase {
  type: 'vplug';
  inlayDepth: number;
  startDepth: number;
  glueGap: number;
  /** null = one pass. */
  stepdown: number | null;
}
export interface VClearOp extends OperationBase {
  type: 'vclear';
  /** The V-carve operation this clears; '' = not chosen yet. */
  sourceId: string;
  stepoverPct: number;
  stepdown: number;
  direction: 'climb' | 'conventional';
  entry: EntrySettings;
}
/** Thread milling of a round hole (internal) or boss (external). */
export interface ThreadOp extends OperationBase {
  type: 'thread';
  kind: 'internal' | 'external';
  thread: ThreadSpec;
  hand: 'right' | 'left';
  /** Threaded length along the axis. */
  length: number;
  /** Radial allowance: positive loosens the fit (internal larger, external smaller). */
  allowance: number;
  passes: number;
  springPass: boolean;
  direction: 'climb' | 'conventional';
  feedCompensation: boolean;
}
export type Operation = ProfileOp | PocketOp | DrillOp | FaceOp | ChamferOp | SlotOp | EngraveOp | VCarveOp | VClearOp | VPlugOp | ThreadOp;

type FieldsOf<T> = T extends unknown ? Omit<T, 'id' | 'type'> : never;
/** The type of field K over every operation type that has it (a union where the types differ). */
type FieldValue<K extends PropertyKey> = FieldsOf<Operation> extends infer F ? (F extends unknown ? (K extends keyof F ? F[K] : never) : never) : never;
type AllKeys = keyof (FieldsOf<ProfileOp> & FieldsOf<PocketOp> & FieldsOf<DrillOp> & FieldsOf<FaceOp> & FieldsOf<ChamferOp> & FieldsOf<SlotOp> & FieldsOf<EngraveOp> & FieldsOf<VCarveOp> & FieldsOf<VClearOp> & FieldsOf<VPlugOp> & FieldsOf<ThreadOp>);
/** Any operation field; object-valued fields are merged one level deep. */
export type OperationPatch = {
  [K in AllKeys]?: K extends 'heights' ? Partial<Heights> : K extends 'feeds' | 'entry' | 'leads' | 'tabs' | 'trochoidal' ? Partial<FieldValue<K>> : K extends 'inlay' ? FieldValue<K> | null : FieldValue<K>;
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
  | 'tab-skipped' | 'stepdown-exceeds-flute' | 'feed-exceeds-machine' | 'tool-number-duplicate' | 'bend-rounded' | 'gouge' | 'facing-depth' | 'wrong-tool'
  | 'slot-width-mismatch' | 'slot-too-narrow' | 'slot-ends-unset' | 'slot-overcut' | 'wrong-geometry'
  | 'flute-exceeded' | 'vcarve-uncleared' | 'source-missing' | 'source-incomplete' | 'internal'
  | 'font-unreadable' | 'font-missing' | 'text-empty' | 'text-missing-glyphs' | 'text-fit' | 'text-arc' | 'text-no-stock' | 'text-single-line'
  | 'inlay-settings' | 'plug-board-thin' | 'plug-board-small'
  | 'thread-angle' | 'thread-pitch' | 'tool-too-big' | 'thread-neck' | 'thread-reach' | 'thread-too-deep' | 'hole-small' | 'hole-large' | 'boss-size';
export interface CamDiagnostic {
  operationId: string;
  severity: CamSeverity;
  code: CamCode;
  message: string;
  /** Index into the operation's geometry list, when the problem belongs to one reference. */
  ref?: number;
}
