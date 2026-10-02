import { camContext, type DrillCycle, type DrillOp, type EntrySettings, type Operation, type PocketOp, type ProfileOp } from '@sponcam/core';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LengthField, NumericField } from '@/panels/NumericField';
import { runCommand } from '@/state/camView';
import { useApp } from '@/state/store';
import { contourKinds } from './openChains';

const pctField = (label: string, value: number, testId: string, onCommit: (v: number) => void) => (
  <NumericField
    label={label} value={value} suffix="%" testId={testId}
    format={(v) => v.toFixed(0)}
    parse={(t) => { const n = Number(t.trim().replace(',', '.')); return Number.isFinite(n) && n > 0 && n <= 100 ? n : null; }}
    onCommit={onCommit}
  />
);

const degField = (label: string, value: number, testId: string, onCommit: (v: number) => void) => (
  <NumericField
    label={label} value={value} suffix="°" testId={testId}
    format={(v) => v.toFixed(1)}
    parse={(t) => { const n = Number(t.trim().replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; }}
    onCommit={onCommit}
  />
);

const intField = (label: string, value: number, testId: string, min: number, onCommit: (v: number) => void) => (
  <NumericField
    label={label} value={value} testId={testId}
    format={(v) => String(Math.round(v))}
    parse={(t) => { const n = Number(t.trim()); return Number.isInteger(n) && n >= min ? n : null; }}
    onCommit={onCommit}
  />
);

function EntryFields({ entry, showAngles, onPatch }: { entry: EntrySettings; showAngles: boolean; onPatch: (patch: Partial<EntrySettings>) => void }) {
  return (
    <>
      <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Entry</span>
        <select
          data-testid="pass-entry" value={entry.mode} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => onPatch({ mode: e.target.value as EntrySettings['mode'] })}
        >
          <option value="auto" className="bg-background">Auto</option>
          <option value="helix" className="bg-background">Helix</option>
          <option value="ramp" className="bg-background">Ramp</option>
          <option value="plunge" className="bg-background">Plunge</option>
        </select>
      </label>
      {showAngles && (
        <>
          {pctField('Helix diameter', entry.helixDiameterPct, 'pass-helix', (v) => onPatch({ helixDiameterPct: v }))}
          {degField('Ramp angle', entry.rampAngleDeg, 'pass-ramp', (v) => onPatch({ rampAngleDeg: v }))}
        </>
      )}
    </>
  );
}

function ProfilePasses({ op }: { op: ProfileOp }) {
  const patch = (p: Partial<ProfileOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const { tabs } = op;
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const kinds = useMemo(() => contourKinds(op, camContext(job, geometry)), [op, job, geometry]);

  return (
    <div className="space-y-3">
      {(kinds.closed || !kinds.open) && (
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Side</span>
        <ToggleGroup
          type="single" variant="outline" size="sm" data-testid="pass-side" value={op.side}
          onValueChange={(v) => v && patch({ side: v as ProfileOp['side'] })}
        >
          <ToggleGroupItem value="outside">Outside</ToggleGroupItem>
          <ToggleGroupItem value="inside">Inside</ToggleGroupItem>
          <ToggleGroupItem value="on">On</ToggleGroupItem>
        </ToggleGroup>
      </label>
      )}
      {kinds.open && (
        <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Open side</span>
          <ToggleGroup
            type="single" variant="outline" size="sm" data-testid="pass-open-side" value={op.openSide}
            onValueChange={(v) => v && patch({ openSide: v as ProfileOp['openSide'] })}
          >
            <ToggleGroupItem value="left">Left</ToggleGroupItem>
            <ToggleGroupItem value="on">On</ToggleGroupItem>
            <ToggleGroupItem value="right">Right</ToggleGroupItem>
          </ToggleGroup>
        </label>
      )}
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Direction</span>
        <ToggleGroup
          type="single" variant="outline" size="sm" data-testid="pass-direction" value={op.direction}
          onValueChange={(v) => v && patch({ direction: v as ProfileOp['direction'] })}
        >
          <ToggleGroupItem value="climb">Climb</ToggleGroupItem>
          <ToggleGroupItem value="conventional">Conventional</ToggleGroupItem>
        </ToggleGroup>
      </label>

      <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      <LengthField label="Radial stock" valueMm={op.stockRadial} testId="pass-stock-radial" min={0} onCommit={(v) => patch({ stockRadial: v })} />
      <LengthField label="Axial stock" valueMm={op.stockAxial} testId="pass-stock-axial" min={0} onCommit={(v) => patch({ stockAxial: v })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="pass-finish" className="accent-primary" checked={op.finishPass} onChange={(e) => patch({ finishPass: e.target.checked })} />
        Finish pass
      </label>

      <EntryFields entry={op.entry} showAngles onPatch={(p) => patch({ entry: { ...op.entry, ...p } })} />

      <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Leads</span>
        <select
          data-testid="pass-leads" value={op.leads.mode} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => patch({ leads: { ...op.leads, mode: e.target.value as ProfileOp['leads']['mode'] } })}
        >
          <option value="none" className="bg-background">None</option>
          <option value="arc" className="bg-background">Arc</option>
          <option value="line" className="bg-background">Line</option>
        </select>
      </label>
      <LengthField
        label="Lead length" valueMm={op.leads.length} testId="pass-lead-length" min={0}
        onCommit={(v) => patch({ leads: { ...op.leads, length: v } })}
      />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="pass-tabs" className="accent-primary" checked={tabs.enabled} onChange={(e) => patch({ tabs: { ...tabs, enabled: e.target.checked } })} />
        Tabs
      </label>
      {tabs.enabled && (
        <div className="space-y-2 pl-1">
          <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
            <span className="text-muted-foreground">Shape</span>
            <select
              data-testid="pass-tab-shape" value={tabs.shape} className="h-8 rounded-md border bg-transparent px-2 text-sm"
              onChange={(e) => patch({ tabs: { ...tabs, shape: e.target.value as ProfileOp['tabs']['shape'] } })}
            >
              <option value="rect" className="bg-background">Rectangle</option>
              <option value="triangle" className="bg-background">Triangle</option>
            </select>
          </label>
          <LengthField label="Width" valueMm={tabs.width} testId="pass-tab-width" min={0.01} onCommit={(v) => patch({ tabs: { ...tabs, width: v } })} />
          <LengthField label="Height" valueMm={tabs.height} testId="pass-tab-height" min={0.01} onCommit={(v) => patch({ tabs: { ...tabs, height: v } })} />
          <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
            <span className="text-muted-foreground">Placement</span>
            <select
              data-testid="pass-tab-placement" value={tabs.placement} className="h-8 rounded-md border bg-transparent px-2 text-sm"
              onChange={(e) => patch({ tabs: { ...tabs, placement: e.target.value as ProfileOp['tabs']['placement'] } })}
            >
              <option value="count" className="bg-background">Count</option>
              <option value="spacing" className="bg-background">Spacing</option>
            </select>
          </label>
          {tabs.placement === 'count'
            ? intField('Count', tabs.count, 'pass-tab-count', 1, (v) => patch({ tabs: { ...tabs, count: v } }))
            : <LengthField label="Spacing" valueMm={tabs.spacing} testId="pass-tab-spacing" min={0.01} onCommit={(v) => patch({ tabs: { ...tabs, spacing: v } })} />}
          <Button
            variant="outline" size="sm" data-testid="pass-tab-reset" disabled={tabs.positions === null}
            onClick={() => patch({ tabs: { ...tabs, positions: null } })}
          >
            Reset tab positions
          </Button>
        </div>
      )}
    </div>
  );
}

function PocketPasses({ op }: { op: PocketOp }) {
  const patch = (p: Partial<PocketOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });

  return (
    <div className="space-y-3">
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Direction</span>
        <ToggleGroup
          type="single" variant="outline" size="sm" data-testid="pass-direction" value={op.direction}
          onValueChange={(v) => v && patch({ direction: v as PocketOp['direction'] })}
        >
          <ToggleGroupItem value="climb">Climb</ToggleGroupItem>
          <ToggleGroupItem value="conventional">Conventional</ToggleGroupItem>
        </ToggleGroup>
      </label>

      <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      {pctField('Stepover', op.stepoverPct, 'pass-stepover', (v) => patch({ stepoverPct: v }))}
      <LengthField label="Radial stock" valueMm={op.stockRadial} testId="pass-stock-radial" min={0} onCommit={(v) => patch({ stockRadial: v })} />
      <LengthField label="Axial stock" valueMm={op.stockAxial} testId="pass-stock-axial" min={0} onCommit={(v) => patch({ stockAxial: v })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="pass-finish-walls" className="accent-primary" checked={op.finishWalls} onChange={(e) => patch({ finishWalls: e.target.checked })} />
        Finish walls
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="pass-finish-floor" className="accent-primary" checked={op.finishFloor} onChange={(e) => patch({ finishFloor: e.target.checked })} />
        Finish floor
      </label>

      <EntryFields entry={op.entry} showAngles onPatch={(p) => patch({ entry: { ...op.entry, ...p } })} />
    </div>
  );
}

const CYCLE_LABEL: Record<DrillCycle, string> = { drill: 'Drill (G81)', dwell: 'Dwell (G82)', peck: 'Peck (G83)', chipbreak: 'Chip-break (G73)' };

function DrillPasses({ op }: { op: DrillOp }) {
  const patch = (p: Partial<DrillOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });

  return (
    <div className="space-y-3">
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Cycle</span>
        <select
          data-testid="pass-cycle" value={op.cycle} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => patch({ cycle: e.target.value as DrillCycle })}
        >
          {(Object.keys(CYCLE_LABEL) as DrillCycle[]).map((c) => <option key={c} value={c} className="bg-background">{CYCLE_LABEL[c]}</option>)}
        </select>
      </label>
      {(op.cycle === 'peck' || op.cycle === 'chipbreak') && (
        <LengthField label="Peck" valueMm={op.peck} testId="pass-peck" min={0.01} onCommit={(v) => patch({ peck: v })} />
      )}
      {op.cycle === 'dwell' && (
        <NumericField
          label="Dwell" value={op.dwellSeconds} suffix="s" testId="pass-dwell"
          format={(v) => v.toFixed(2)}
          parse={(t) => { const n = Number(t.trim().replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; }}
          onCommit={(v) => patch({ dwellSeconds: v })}
        />
      )}
    </div>
  );
}

export function PassesTab({ op }: { op: Operation }) {
  if (op.type === 'profile') return <ProfilePasses op={op} />;
  if (op.type === 'pocket') return <PocketPasses op={op} />;
  return <DrillPasses op={op} />;
}
