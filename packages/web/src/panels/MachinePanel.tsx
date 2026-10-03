import {
  type AxisValues, applyMachinePreset, formatLength, MACHINE_PRESET_NAMES, type MachinePresetName, parseLength, setMachineProfile,
} from '@sponcam/core';
import { appStore, useApp } from '@/state/store';
import { NumericField } from './NumericField';

const AXES = ['x', 'y', 'z'] as const;

export function MachineSettings() {
  const machine = useApp((s) => s.job.machine);
  const units = useApp((s) => s.job.displayUnits);
  const { commit } = appStore.getState();
  const isPreset = (MACHINE_PRESET_NAMES as readonly string[]).includes(machine.name);
  // rates and accelerations are lengths per time: convert the length part only
  const lengthField = (value: number, suffix: string, testId: string, onCommit: (v: number) => void, label: string) => (
    <NumericField
      key={testId} label={label} value={value} suffix={suffix} testId={testId}
      format={(v) => formatLength(v, units)}
      parse={(t) => {
        const mm = parseLength(t, units);
        return mm !== null && mm > 0 ? mm : null;
      }}
      onCommit={onCommit}
    />
  );
  const axisPatch = (group: 'rapid' | 'accel', axis: keyof AxisValues, v: number) => commit((j) => setMachineProfile(j, { [group]: { [axis]: v } }));

  return (
    <>
      <label className="mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 text-sm">
        <span className="text-muted-foreground">Profile</span>
        <select
          data-testid="machine-preset" value={isPreset ? machine.name : 'Custom'} className="h-8 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => commit((j) => applyMachinePreset(j, e.target.value as MachinePresetName))}
        >
          {MACHINE_PRESET_NAMES.map((n) => <option key={n} value={n} className="bg-background">{n}</option>)}
          <option value="Custom" disabled className="bg-background">Custom</option>
        </select>
      </label>
      <div className="space-y-2">
        {AXES.map((a) => lengthField(machine.rapid[a], `${units}/min`, `machine-rapid-${a}`, (v) => axisPatch('rapid', a, v), `Rapid ${a.toUpperCase()}`))}
        {AXES.map((a) => lengthField(machine.accel[a], `${units}/s²`, `machine-accel-${a}`, (v) => axisPatch('accel', a, v), `Accel ${a.toUpperCase()}`))}
        {lengthField(machine.maxFeed, `${units}/min`, 'machine-max-feed', (v) => commit((j) => setMachineProfile(j, { maxFeed: v })), 'Max feed')}
        <NumericField
          label="Tool change" value={machine.toolChangeSeconds} suffix="s" testId="machine-tool-change"
          format={(v) => v.toFixed(0)}
          parse={(t) => {
            const n = Number(t.trim().replace(',', '.'));
            return t.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
          }}
          onCommit={(v) => commit((j) => setMachineProfile(j, { toolChangeSeconds: v }))}
        />
      </div>
    </>
  );
}
