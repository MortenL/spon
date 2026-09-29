import type { MachineProfile } from './machine';
import type { Quat } from '../geometry/quat';
import type { Vec3 } from '../geometry/vec3';
import type { ModelKind } from '../import/importFile';
import type { LengthUnit } from '../units/units';
import type { Operation } from '../cam/types';
import type { PostSettings } from '../post/types';
import type { Tool } from '../tools/types';

export type WorkOffset = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
export const WORK_OFFSETS: readonly WorkOffset[] = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'];
export type AxisAnchor = 'min' | 'center' | 'max';
export type ZAnchor = 'top' | 'bottom';

export interface ModelTransform {
  /** Orientation deciding which side faces down. */
  base: Quat;
  /** Spin about machine Z, applied after `base`. */
  zDeg: number;
}

export interface ModelRef {
  sourceName: string;
  blobId: string;
  kind: ModelKind;
  importUnits: LengthUnit;
  transform: ModelTransform;
  /** Source format when it is not implied by `kind` (missing: STL for meshes, DXF for drawings). */
  format?: 'stl' | 'step' | 'iges';
  /** STEP/IGES: which body of the file (0-based) is the model. */
  body?: number;
}

export interface AutoStock {
  mode: 'auto';
  margin: { xy: number; zTop: number; zBottom: number };
}

export interface FixedStock {
  mode: 'fixed';
  size: Vec3;
  /** Model position inside the stock, measured from the stock's min corner. */
  modelOffset: Vec3;
}

export type Stock = AutoStock | FixedStock;

export interface Wcs {
  anchor: { x: AxisAnchor; y: AxisAnchor; z: ZAnchor };
  offset: Vec3;
  workOffset: WorkOffset;
}

export interface ProgramRef {
  id: string;
  /** Original file name (or generated file name). */
  name: string;
  /** Key of the program bytes (programs/<blobId>.nc in .spon, IndexedDB blobs). */
  blobId: string;
  /** Included in the combined back-to-back timeline. */
  inTimeline: boolean;
  /** Stored programs are always 'imported'; generated programs exist only in the web store. */
  source: 'imported' | 'generated';
  /** Generated programs: the operations that produced them. */
  operationIds?: string[];
}

/** All lengths in mm, angles in degrees. */
export interface Job {
  schemaVersion: 3;
  id: string;
  name: string;
  displayUnits: LengthUnit;
  model: ModelRef | null;
  stock: Stock;
  wcs: Wcs;
  machine: MachineProfile;
  /** List order is playback order. */
  programs: ProgramRef[];
  /** Copies of the library tools this job uses. */
  tools: Tool[];
  /** List order is machining order. */
  operations: Operation[];
  post: PostSettings;
  /** Chord / arc-fit tolerance in mm. */
  tolerance: number;
}
