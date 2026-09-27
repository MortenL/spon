export interface AxisValues {
  x: number;
  y: number;
  z: number;
}

/** Rapid rates and max feed in mm/min, accelerations in mm/s². */
export interface MachineProfile {
  name: string;
  rapid: AxisValues;
  accel: AxisValues;
  maxFeed: number;
  toolChangeSeconds: number;
}

export type MachinePresetName = 'Hobby GRBL router' | 'Generic VMC';
export const MACHINE_PRESET_NAMES: readonly MachinePresetName[] = ['Hobby GRBL router', 'Generic VMC'];
export const DEFAULT_MACHINE_PRESET: MachinePresetName = 'Hobby GRBL router';
export const CUSTOM_MACHINE_NAME = 'Custom';

const PRESETS: Record<MachinePresetName, MachineProfile> = {
  'Hobby GRBL router': {
    name: 'Hobby GRBL router', rapid: { x: 5000, y: 5000, z: 1500 }, accel: { x: 500, y: 500, z: 200 }, maxFeed: 5000, toolChangeSeconds: 30,
  },
  'Generic VMC': {
    name: 'Generic VMC', rapid: { x: 30000, y: 30000, z: 24000 }, accel: { x: 3000, y: 3000, z: 2500 }, maxFeed: 12000, toolChangeSeconds: 5,
  },
};

/** A fresh, mutable copy of a preset. */
export function machinePreset(name: MachinePresetName): MachineProfile {
  return structuredClone(PRESETS[name]);
}
