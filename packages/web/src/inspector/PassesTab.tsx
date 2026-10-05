import { camContext, type ChamferOp, type DrillCycle, type DrillOp, CommandError, type EngraveOp, type EntrySettings, type FaceOp, formatLength, type Operation, type PocketOp, type ProfileOp, resolveGeometry, type SlotOp, type ThreadOp, type ThreadStandard, threadRow, type VCarveOp, type VClearOp, type VPlugOp } from '@sponcam/core';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LengthField, NumericField } from '@/panels/NumericField';
import { toast } from 'sonner';
import { runCommand } from '@/state/camView';
import { appStore, useApp } from '@/state/store';
import { toolLibraryStore } from '@/state/toolLibrary';
import { addClearingBatch, clearingFor, engraveModeUi } from './vcarveInfo';
import { chamferInfo } from './chamferInfo';
import { TabsBlock } from './TabsBlock';
import { slotView } from './slotInfo';
import { contourKinds } from './openChains';
import { kindSwitchPatch, pitchFromTpi, pitchToTpi, sizeOptions, THREAD_STANDARD_OPTIONS, parseToothAngle, threadReadouts } from './threadInfo';

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
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const kinds = useMemo(() => contourKinds(op, camContext(job, geometry)), [op, job, geometry]);
  const selectedTab = useApp((s) => s.selectedTab);

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

      <TabsBlock op={op} selectedTab={selectedTab} />
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
  const { info, fields } = useMemo(() => slotView(op, ctx, tool), [op, ctx, tool]);
  const selectedTab = useApp((s) => s.selectedTab);

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
      {fields.width && <LengthField label="Width" valueMm={op.width} testId="pass-slot-width" min={0.01} onCommit={(v) => patch({ width: v })} />}
      {fields.stepdown && (
        <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      )}
      {fields.stepover && pctField('Stepover', op.stepoverPct, 'pass-stepover', (v) => patch({ stepoverPct: v }))}
      {fields.step && pctField('Step', op.trochoidal.stepPct, 'pass-slot-step', (v) => patch({ trochoidal: { stepPct: v } }))}
      {fields.direction && directionField(op.direction, (v) => patch({ direction: v }))}
      {fields.layers && (
        <p data-testid="slot-layers" className="text-xs text-muted-foreground">Layers: {info.trochoidalLayers}</p>
      )}
      {fields.radialStock && <LengthField label="Radial stock" valueMm={op.stockRadial} testId="pass-stock-radial" min={0} onCommit={(v) => patch({ stockRadial: v })} />}
      <LengthField label="Axial stock" valueMm={op.stockAxial} testId="pass-stock-axial" min={0} onCommit={(v) => patch({ stockAxial: v })} />
      {fields.finishWalls && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="pass-finish-walls" className="accent-primary" checked={op.finishWalls} onChange={(e) => patch({ finishWalls: e.target.checked })} />
          Finish walls
        </label>
      )}
      {fields.squareEnds && (
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

      <TabsBlock op={op} selectedTab={selectedTab} />
    </div>
  );
}

function ThreadPasses({ op }: { op: ThreadOp }) {
  const patch = (p: Partial<ThreadOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const units = useApp((s) => s.job.displayUnits);
  const [tpi, setTpi] = useState(false);
  const { thread } = op;
  const custom = thread.standard === 'custom';
  const readouts = threadReadouts(thread, op.kind, units);
  const select = (testId: string, label: string, value: string, options: readonly { value: string; label: string }[], onChange: (v: string) => void) => (
    <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select data-testid={testId} value={value} className="h-8 rounded-md border bg-transparent px-2 text-sm" onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value} className="bg-background">{o.label}</option>)}
      </select>
    </label>
  );
  const toggle = (testId: string, label: string, value: string, options: readonly [string, string][], onChange: (v: string) => void) => (
    <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <ToggleGroup type="single" variant="outline" size="sm" data-testid={testId} value={value} onValueChange={(v) => v && onChange(v)}>
        {options.map(([v, text]) => <ToggleGroupItem key={v} value={v}>{text}</ToggleGroupItem>)}
      </ToggleGroup>
    </label>
  );
  const setStandard = (standard: ThreadStandard) => {
    if (standard === 'custom') {
      patch({ thread: { standard, size: null, majorDiameter: thread.majorDiameter, pitch: thread.pitch, angle: thread.angle } });
      return;
    }
    const row = threadRow(standard, sizeOptions(standard)[0]);
    if (row) patch({ thread: { standard, size: row.size, majorDiameter: row.majorDiameter, pitch: row.pitch, angle: row.angle } });
  };

  return (
    <div className="space-y-3">
      {toggle('thread-kind', 'Kind', op.kind, [['internal', 'Internal'], ['external', 'External']], (v) => runCommand({ type: 'updateOperation', id: op.id, patch: kindSwitchPatch(v as ThreadOp['kind'], op.geometry) }))}
      {select('thread-standard', 'Standard', thread.standard, THREAD_STANDARD_OPTIONS, (v) => setStandard(v as ThreadStandard))}
      {!custom && select('thread-size', 'Size', thread.size ?? '', sizeOptions(thread.standard).map((s) => ({ value: s, label: s })), (size) => {
        const row = threadRow(thread.standard as Exclude<ThreadStandard, 'custom'>, size);
        if (row) patch({ thread: { standard: row.standard, size: row.size, majorDiameter: row.majorDiameter, pitch: row.pitch, angle: row.angle } });
      })}
      {custom && (
        <>
          <LengthField label="Major Ø" valueMm={thread.majorDiameter} testId="thread-major" min={0.01} onCommit={(v) => patch({ thread: { ...thread, majorDiameter: v } })} />
          <NumericField
            label="Pitch" value={tpi ? pitchToTpi(thread.pitch) : thread.pitch} testId="thread-pitch" suffix={tpi ? 'TPI' : 'mm'}
            format={(v) => (tpi ? v.toFixed(2) : v.toFixed(3))}
            parse={(t) => { const n = Number(t.trim().replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; }}
            onCommit={(v) => patch({ thread: { ...thread, pitch: tpi ? pitchFromTpi(v) : v } })}
          />
          {toggle('thread-pitch-unit', 'Pitch unit', tpi ? 'tpi' : 'mm', [['mm', 'mm'], ['tpi', 'TPI']], (v) => setTpi(v === 'tpi'))}
          <NumericField
            label="Thread angle" value={thread.angle} suffix="°" testId="thread-angle"
            format={(v) => v.toFixed(1)}
            parse={parseToothAngle}
            onCommit={(v) => patch({ thread: { ...thread, angle: v } })}
          />
        </>
      )}
      <div data-testid="thread-readouts" className="space-y-0.5 rounded-md border px-2 py-1.5 font-mono text-xs text-muted-foreground">
        <div>Minor Ø {readouts.minor}</div>
        <div>Thread depth {readouts.depth}</div>
        {readouts.tapDrill && <div>Tap drill {readouts.tapDrill}</div>}
      </div>

      {toggle('thread-hand', 'Hand', op.hand, [['right', 'Right'], ['left', 'Left']], (v) => patch({ hand: v as ThreadOp['hand'] }))}
      <LengthField label="Length" valueMm={op.length} testId="thread-length" min={0.01} onCommit={(v) => patch({ length: v })} />
      <LengthField label="Allowance" valueMm={op.allowance} testId="thread-allowance" onCommit={(v) => patch({ allowance: v })} />
      {intField('Passes', op.passes, 'thread-passes', 1, (v) => patch({ passes: v }))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="thread-spring" className="accent-primary" checked={op.springPass} onChange={(e) => patch({ springPass: e.target.checked })} />
        Spring pass
      </label>
      {toggle('thread-direction', 'Direction', op.direction, [['climb', 'Climb'], ['conventional', 'Conventional']], (v) => patch({ direction: v as ThreadOp['direction'] }))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="thread-feed-comp" className="accent-primary" checked={op.feedCompensation} onChange={(e) => patch({ feedCompensation: e.target.checked })} />
        Feed compensation
      </label>
    </div>
  );
}

function EngravePasses({ op }: { op: EngraveOp }) {
  const patch = (p: Partial<EngraveOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const job = useApp((s) => s.job);
  const tool = job.tools.find((t) => t.id === op.toolId) ?? null;
  const { widthAllowed, showWidth } = engraveModeUi(op, tool);

  return (
    <div className="space-y-3">
      {(
        <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Depth by</span>
          <select
            data-testid="pass-engrave-mode" value={op.depthMode} className="h-8 rounded-md border bg-transparent px-2 text-sm"
            onChange={(e) => patch({ depthMode: e.target.value as EngraveOp['depthMode'] })}
          >
            <option value="depth" className="bg-background">Depth</option>
            <option value="width" disabled={!widthAllowed} className="bg-background">Line width</option>
          </select>
        </label>
      )}
      {showWidth
        ? <LengthField label="Line width" valueMm={op.lineWidth} testId="pass-engrave-width" min={0.01} onCommit={(v) => patch({ lineWidth: v })} />
        : <LengthField label="Depth" valueMm={op.depth} testId="pass-engrave-depth" min={0.01} onCommit={(v) => patch({ depth: v })} />}
      <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-engrave-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
    </div>
  );
}

function VCarvePasses({ op }: { op: VCarveOp }) {
  const patch = (p: Partial<VCarveOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const job = useApp((s) => s.job);
  const clearing = clearingFor(job, op.id);

  const addClearing = () => {
    const s = appStore.getState();
    const newId = crypto.randomUUID();
    const commands = addClearingBatch(s.job, toolLibraryStore.getState().tools, op.id, newId);
    try {
      s.dispatchBatch(commands);
    } catch (err) {
      if (err instanceof CommandError) { toast.error(err.message); return; }
      throw err;
    }
    appStore.getState().selectOperation(newId);
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" data-testid="pass-vcarve-max-depth-on" className="accent-primary" checked={op.maxDepth !== null}
          onChange={(e) => patch({ maxDepth: e.target.checked ? 3 : null })}
        />
        Max depth
      </label>
      {op.maxDepth !== null && (
        <LengthField label="Max depth" valueMm={op.maxDepth} testId="pass-vcarve-max-depth" min={0.01} onCommit={(v) => patch({ maxDepth: v })} />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" data-testid="pass-vcarve-stepdown-on" className="accent-primary" checked={op.stepdown !== null}
          onChange={(e) => patch({ stepdown: e.target.checked ? 1 : null })}
        />
        Stepdown (off = one pass)
      </label>
      {op.stepdown !== null && (
        <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-vcarve-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      )}
      {op.maxDepth !== null && clearing === null && (
        <Button variant="outline" size="sm" data-testid="vcarve-add-clearing" onClick={addClearing}>
          Add clearing operation
        </Button>
      )}
    </div>
  );
}

function VPlugPasses({ op }: { op: VPlugOp }) {
  const patch = (p: Partial<VPlugOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const H = op.inlayDepth - op.glueGap + op.startDepth;
  return (
    <div className="space-y-3">
      <LengthField label="Inlay depth (D)" valueMm={op.inlayDepth} testId="pass-vplug-depth" min={0.01} onCommit={(v) => patch({ inlayDepth: v })} />
      <LengthField label="Start depth (S)" valueMm={op.startDepth} testId="pass-vplug-start" min={0.01} onCommit={(v) => patch({ startDepth: v })} />
      <LengthField label="Glue gap (g)" valueMm={op.glueGap} testId="pass-vplug-gap" min={0.01} onCommit={(v) => patch({ glueGap: v })} />
      <LengthField label="Plug height (H)" valueMm={H} testId="pass-vplug-height" disabled onCommit={() => {}} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" data-testid="pass-vplug-stepdown-on" className="accent-primary" checked={op.stepdown !== null}
          onChange={(e) => patch({ stepdown: e.target.checked ? 1 : null })}
        />
        Stepdown (off = one pass)
      </label>
      {op.stepdown !== null && (
        <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-vplug-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      )}
    </div>
  );
}

function VClearPasses({ op }: { op: VClearOp }) {
  const patch = (p: Partial<VClearOp>) => runCommand({ type: 'updateOperation', id: op.id, patch: p });
  const job = useApp((s) => s.job);
  const source = job.operations.find((o) => o.id === op.sourceId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {source
          ? <span data-testid="vclear-source" className="min-w-0 flex-1 truncate">Clears {source.name}</span>
          : <span data-testid="vclear-source" className="min-w-0 flex-1 truncate text-destructive">Source deleted</span>}
        {source && (
          <Button variant="outline" size="sm" data-testid="vclear-select-source" onClick={() => appStore.getState().selectOperation(source.id)}>Select</Button>
        )}
      </div>
      {pctField('Stepover', op.stepoverPct, 'pass-stepover', (v) => patch({ stepoverPct: v }))}
      <LengthField label="Stepdown" valueMm={op.stepdown} testId="pass-stepdown" min={0.01} onCommit={(v) => patch({ stepdown: v })} />
      {directionField(op.direction, (v) => patch({ direction: v }))}
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
  if (op.type === 'engrave') return <EngravePasses op={op} />;
  if (op.type === 'vcarve') return <VCarvePasses op={op} />;
  if (op.type === 'vclear') return <VClearPasses op={op} />;
  if (op.type === 'vplug') return <VPlugPasses op={op} />;
  if (op.type === 'thread') return <ThreadPasses op={op} />;
  return <ChamferPasses op={op} />;
}
