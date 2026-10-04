import { formatLength, HEIGHT_FROM, HEIGHT_NAMES, type HeightFrom, type HeightName, type Operation } from '@sponcam/core';
import { Button } from '@/components/ui/button';
import { LengthField } from '@/panels/NumericField';
import { runCommand } from '@/state/camView';
import { appStore, useApp } from '@/state/store';
import { chamferInfo } from './chamferInfo';
import { refLabel } from './geometryLabels';

const COLOR: Record<HeightName, string> = { clearance: '#f97316', retract: '#84cc16', feed: '#22c55e', top: '#38bdf8', bottom: '#1d4ed8' };
const NAME_LABEL: Record<HeightName, string> = { clearance: 'Clearance', retract: 'Retract', feed: 'Feed', top: 'Top', bottom: 'Bottom' };
const FROM_LABEL: Record<HeightFrom, string> = {
  stockTop: 'Stock top', stockBottom: 'Stock bottom', modelTop: 'Model top', modelBottom: 'Model bottom',
  contour: 'Selected contour', face: 'Picked face', origin: 'WCS origin (absolute)', holeBottom: 'Hole bottom', slotBottom: 'Slot bottom',
  retract: 'Retract height', feed: 'Feed height', top: 'Top height',
};

export function HeightsTab({ op }: { op: Operation }) {
  const catalog = useApp((s) => s.catalog);
  const camResults = useApp((s) => s.camResults);
  const camPick = useApp((s) => s.camPick);
  const units = useApp((s) => s.job.displayUnits);

  const resolved = camResults[op.id]?.heights ?? null;
  const job = useApp((s) => s.job);
  const chamferDepth = op.type === 'chamfer' ? chamferInfo(op, job.tools.find((t) => t.id === op.toolId) ?? null, null).depth : null;

  return (
    <div className="space-y-4">
      {HEIGHT_NAMES.map((name) => {
        const spec = op.heights[name];
        const pickPending = camPick !== null && camPick.operationId === op.id && typeof camPick.target === 'object' && camPick.target.height === name;
        const setSpec = (patch: Partial<{ from: HeightFrom; offset: number }>) =>
          runCommand({
            type: 'updateOperation', id: op.id,
            patch: { heights: { [name]: { from: spec.from, offset: spec.offset, ...(spec.face ? { face: spec.face } : {}), ...patch } } },
          });

        if (name === 'bottom' && (op.type === 'engrave' || op.type === 'vcarve' || op.type === 'vclear' || op.type === 'vplug')) return null;
        if (name === 'top' && op.type === 'vclear') return null;

        if (op.type === 'chamfer' && name === 'bottom') {
          return (
            <div key={name} data-testid="height-bottom" className="space-y-1.5 border-b pb-3 last:border-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR[name] }} />
                {NAME_LABEL[name]}
              </div>
              <div className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
                <span className="text-muted-foreground">Chamfer depth</span>
                <span data-testid="height-bottom-computed" className="text-right font-mono text-xs">
                  Computed: {chamferDepth === null ? '–' : formatLength(chamferDepth, units)}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div key={name} data-testid={`height-${name}`} className="space-y-1.5 border-b pb-3 last:border-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR[name] }} />
              {NAME_LABEL[name]}
            </div>
            <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
              <span className="text-muted-foreground">From</span>
              <select
                data-testid={`height-${name}-from`} value={spec.from} className="h-8 rounded-md border bg-transparent px-2 text-sm"
                onChange={(e) => setSpec({ from: e.target.value as HeightFrom })}
              >
                {HEIGHT_FROM[name].filter((f) => f !== 'slotBottom' || op.type === 'slot' || spec.from === f).map((f) => <option key={f} value={f} className="bg-background">{FROM_LABEL[f]}</option>)}
              </select>
            </label>
            <LengthField label="Offset" valueMm={spec.offset} testId={`height-${name}-offset`} onCommit={(v) => setSpec({ offset: v })} />
            <div className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
              <span className="text-muted-foreground">Resolved Z</span>
              <span data-testid={`height-${name}-value`} className="text-right font-mono text-xs">
                {resolved ? formatLength(resolved[name], units) : '–'}
              </span>
            </div>
            {spec.from === 'face' && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant={pickPending ? 'default' : 'outline'} data-testid={`height-${name}-pick`}
                  onClick={() => appStore.getState().setCamPick(pickPending ? null : { operationId: op.id, target: { height: name } })}
                >
                  Pick face
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {spec.face ? refLabel(spec.face, catalog, null, units, job.texts) : 'No face picked'}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
