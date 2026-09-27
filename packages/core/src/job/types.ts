import type { Quat } from '../geometry/quat';
import type { Vec3 } from '../geometry/vec3';
import type { ModelKind } from '../import/importFile';
import type { LengthUnit } from '../units/units';

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

/** All lengths in mm, angles in degrees. */
export interface Job {
  schemaVersion: 1;
  id: string;
  name: string;
  displayUnits: LengthUnit;
  model: ModelRef | null;
  stock: Stock;
  wcs: Wcs;
}
