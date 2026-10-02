import { DEFAULT_MACHINE_PRESET, machinePreset } from './machine';
import { QUAT_IDENTITY } from '../geometry/quat';
import type { AutoStock, Job, ModelTransform, Wcs } from './types';
import { defaultPostSettings } from '../post/types';

export const DEFAULT_AUTO_STOCK: Readonly<AutoStock> = Object.freeze({ mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 0 } }) as Readonly<AutoStock>;

export const DEFAULT_TOLERANCE = 0.002;

export const DEFAULT_WCS: Readonly<Wcs> = Object.freeze({
  anchor: { x: 'min', y: 'min', z: 'top' },
  offset: { x: 0, y: 0, z: 0 },
  workOffset: 'G54',
} as Wcs) as Readonly<Wcs>;

export function identityTransform(): ModelTransform {
  return { base: { ...QUAT_IDENTITY }, zDeg: 0 };
}

export function createJob(name = 'Untitled'): Job {
  return {
    schemaVersion: 5,
    id: crypto.randomUUID(),
    name,
    displayUnits: 'mm',
    model: null,
    stock: structuredClone(DEFAULT_AUTO_STOCK) as AutoStock,
    wcs: structuredClone(DEFAULT_WCS) as Wcs,
    machine: machinePreset(DEFAULT_MACHINE_PRESET),
    programs: [],
    tools: [],
    operations: [],
    post: defaultPostSettings('grbl'),
    tolerance: DEFAULT_TOLERANCE,
  };
}
