import { camContext, type ChamferOp, type DrillCycle, type DrillOp, type EntrySettings, type FaceOp, formatLength, type Operation, type PocketOp, type ProfileOp, resolveGeometry, type SlotOp } from '@sponcam/core';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LengthField, NumericField } from '@/panels/NumericField';
import { runCommand } from '@/state/camView';
import { useApp } from '@/state/store';
import { chamferInfo } from './chamferInfo';
import { activeStrategies, slotInfo } from './slotInfo';
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

const directionField = (value: 'climb' | 'conventional', onChange: (v: 'climb' | 'conventional') => void) => (
  <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
    <span className="text-muted-foreground">Direction</span>
    <ToggleGroup
      type="single" variant="outline" size="sm" data-testid="pass-direction" value={value}
      onValueChange={(v) => v && onChange(v as 'climb' | 'conventional')}
    >
      <ToggleGroupItem value="climb">Climb</ToggleGroupItem>
      <ToggleGroupItem value="conventional">Conventional</ToggleGroupItem>
    </ToggleGroup>
  </label>
);

function FacePasses({ op }: { op: FaceOp }) {
  const patch = (p: Partial<FaceOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });

  return (
    <div className="space-y-3">
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Area</span>
        <ToggleGroup
          type="single" variant="outline" size="sm" data-testid="pass-face-area" value={op.area}
          onValueChange={(v) => v && patch({ area: v as FaceOp['area'] })}
        >
          <ToggleGroupItem value="stock">Stock</ToggleGroupItem>
          <ToggleGroupItem value="picked">Picked</ToggleGroupItem>
        </ToggleGroup>
      </label>
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Pattern</span>
        <ToggleGroup
          type="single" variant="outline" size="sm" data-testid="pass-face-pattern" value={op.pattern}
          onValueChange={(v) => v && patch({ pattern: v as FaceOp['pattern'] })}
        >
          <ToggleGroupItem value="zigzag">Zig-zag</ToggleGroupItem>
          <ToggleGroupItem value="spiral">Spiral</ToggleGroupItem>
        </ToggleGroup>
      </label>
      {op.pattern === 'zigzag' && (
        <>
          {degField('Angle', op.angleDeg, 'pass-face-angle', (v) => patch({ angleDeg: v }))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="pass-face-oneway" className="accent-primary" checked={op.oneWay} onChange={(e) => patch({ oneWay: e.target.checked })} />
            One way
          </label>
        </>
      )}
      {directionField(op.direction, (v) => patch({ direction: v }))}
      {pctField('Stepover', op.stepoverPct, 'pass-stepover', (v) => patch({ stepoverPct: v }))}
      <LengthField label="Overlap" valueMm={op.overlap} testId="pass-face-overlap" min={0} onCommit={(v) => patch({ overlap: v })} />
      <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="pass-finish" className="accent-primary" checked={op.finishPass} onChange={(e) => patch({ finishPass: e.target.checked })} />
        Finish pass
      </label>
      {op.finishPass && pctField('Finish stepover', op.finishStepoverPct, 'pass-face-finish-stepover', (v) => patch({ finishStepoverPct: v }))}
    </div>
  );
}

function ChamferPasses({ op }: { op: ChamferOp }) {
  const patch = (p: Partial<ChamferOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const units = job.displayUnits;
  const tool = job.tools.find((t) => t.id === op.toolId) ?? null;
  const ctx = useMemo(() => camContext(job, geometry), [job, geometry]);
  const kinds = useMemo(() => contourKinds(op, ctx), [op, ctx]);
  const holeDiameter = useMemo(() => resolveGeometry(op, ctx).holes[0]?.diameter ?? null, [op, ctx]);
  const info = chamferInfo(op, tool, holeDiameter);

  return (
    <div className="space-y-3">
      <LengthField label="Width" valueMm={op.width} testId="pass-chamfer-width" min={0.01} onCommit={(v) => patch({ width: v })} />
      <Button variant="outline" size="sm" data-testid="pass-chamfer-deburr" onClick={() => patch({ width: 0.3 })}>
        Deburr ({formatLength(0.3, units)})
      </Button>
      <LengthField label="Tip offset" valueMm={op.tipOffset} testId="pass-chamfer-tip" min={0} onCommit={(v) => patch({ tipOffset: v })} />
      <div className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Depth</span>
        <span data-testid="chamfer-depth" className="text-right font-mono text-xs">{info.depth === null ? '–' : formatLength(info.depth, units)}</span>
      </div>
      {holeDiameter !== null && info.topDiameter !== null && (
        <div className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Top diameter</span>
          <span data-testid="chamfer-top-diameter" className="text-right font-mono text-xs">Ø{formatLength(info.topDiameter, units)}</span>
        </div>
      )}
      {info.error && <p data-testid="chamfer-error" className="text-xs text-destructive">{info.error}</p>}
      {(kinds.closed || !kinds.open) && (
        <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Side</span>
          <ToggleGroup
            type="single" variant="outline" size="sm" data-testid="pass-side" value={op.side}
            onValueChange={(v) => v && patch({ side: v as ChamferOp['side'] })}
          >
            <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
            <ToggleGroupItem value="outside">Outside</ToggleGroupItem>
            <ToggleGroupItem value="inside">Inside</ToggleGroupItem>
          </ToggleGroup>
        </label>
      )}
      {kinds.open && (
        <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Open side</span>
          <ToggleGroup
            type="single" variant="outline" size="sm" data-testid="pass-open-side" value={op.openSide}
            onValueChange={(v) => v && patch({ openSide: v as ChamferOp['openSide'] })}
          >
            <ToggleGroupItem value="left">Left</ToggleGroupItem>
            <ToggleGroupItem value="right">Right</ToggleGroupItem>
          </ToggleGroup>
        </label>
      )}
      {directionField(op.direction, (v) => patch({ direction: v }))}
      <LengthField label="Stepdown (0 = one pass)" valueMm={op.stepdown} testId="pass-stepdown" min={0} onCommit={(v) => patch({ stepdown: v })} />
    </div>
  );
}

const STRATEGY_LABEL: Record<SlotOp['strategy'], string> = { auto: 'Auto', toolWidth: 'Tool-width', wider: 'Wider', trochoidal: 'Trochoidal' };
const END_LABEL: Record<NonNullable<SlotOp['squareEnds']>, string> = { inside: 'Inside', endWall: 'End wall', dogbone: 'Dogbone' };

function SlotPasses({ op }: { op: SlotOp }) {
  const patch = (p: Partial<SlotOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const tool = job.tools.find((t) => t.id === op.toolId) ?? null;
  const ctx = useMemo(() => camContext(job, geometry), [job, geometry]);
  const info = slotInfo(op, ctx, tool);
  const active = activeStrategies(op, ctx, tool);
  const wider = active.has('wider');
  const trochoidal = active.has('trochoidal');
  const toolWidthOnly = active.size > 0 && [...active].every((a) => a === 'toolWidth');

  return (
    <div className="space-y-3">
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Strategy</span>
        <select
          data-testid="pass-slot-strategy" value={op.strategy} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => patch({ strategy: e.target.value as SlotOp['strategy'] })}
        >
          {(Object.keys(STRATEGY_LABEL) as SlotOp['strategy'][]).map((k) => <option key={k} value={k} className="bg-background">{STRATEGY_LABEL[k]}</option>)}
        </select>
      </label>
      {info.auto.map((line) => <p key={line} data-testid="slot-auto-line" className="text-xs text-muted-foreground">{line}</p>)}
      {info.drawn && <LengthField label="Width" valueMm={op.width} testId="pass-slot-width" min={0.01} onCommit={(v) => patch({ width: v })} />}
      {op.strategy !== 'trochoidal' && (
        <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      )}
      {wider && pctField('Stepover', op.stepoverPct, 'pass-stepover', (v) => patch({ stepoverPct: v }))}
      {trochoidal && pctField('Step', op.trochoidal.stepPct, 'pass-slot-step', (v) => patch({ trochoidal: { stepPct: v } }))}
      {(wider || trochoidal) && directionField(op.direction, (v) => patch({ direction: v }))}
      {op.strategy === 'trochoidal' && info.trochoidalLayers !== null && (
        <p data-testid="slot-layers" className="text-xs text-muted-foreground">Layers: {info.trochoidalLayers}</p>
      )}
      {!toolWidthOnly && <LengthField label="Radial stock" valueMm={op.stockRadial} testId="pass-stock-radial" min={0} onCommit={(v) => patch({ stockRadial: v })} />}
      <LengthField label="Axial stock" valueMm={op.stockAxial} testId="pass-stock-axial" min={0} onCommit={(v) => patch({ stockAxial: v })} />
      {!toolWidthOnly && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="pass-finish-walls" className="accent-primary" checked={op.finishWalls} onChange={(e) => patch({ finishWalls: e.target.checked })} />
          Finish walls
        </label>
      )}
      {info.squareEnds && (
        <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Square ends</span>
          <select
            data-testid="pass-slot-ends" value={op.squareEnds ?? ''} aria-invalid={op.squareEnds === null}
            className={cn('h-8 rounded-md border bg-transparent px-2 text-sm', op.squareEnds === null && 'border-destructive')}
            onChange={(e) => patch({ squareEnds: (e.target.value || null) as SlotOp['squareEnds'] })}
          >
            <option value="" className="bg-background">Choose…</option>
            {(Object.keys(END_LABEL) as NonNullable<SlotOp['squareEnds']>[]).map((k) => <option key={k} value={k} className="bg-background">{END_LABEL[k]}</option>)}
          </select>
        </label>
      )}
      <EntryFields entry={op.entry} showAngles onPatch={(p) => patch({ entry: { ...op.entry, ...p } })} />
    </div>
  );
}

export function PassesTab({ op }: { op: Operation }) {
  if (op.type === 'profile') return <ProfilePasses op={op} />;
  if (op.type === 'pocket') return <PocketPasses op={op} />;
  if (op.type === 'drill') return <DrillPasses op={op} />;
  if (op.type === 'face') return <FacePasses op={op} />;
  if (op.type === 'slot') return <SlotPasses op={op} />;
  return <ChamferPasses op={op} />;
}
