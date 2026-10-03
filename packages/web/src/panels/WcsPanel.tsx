import { type AxisAnchor, setWcs, WORK_OFFSETS, type WorkOffset, type ZAnchor } from '@sponcam/core';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useWcsPoint } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { formatPoint } from './format';
import { LengthField } from './NumericField';
import { PanelBody } from './PanelBody';

// Seen from above: Y points away from the viewer, so the top row is Y max.
const ROWS: AxisAnchor[] = ['max', 'center', 'min'];
const COLUMNS: AxisAnchor[] = ['min', 'center', 'max'];

export function WcsPanel() {
  const wcs = useApp((s) => s.job.wcs);
  const units = useApp((s) => s.job.displayUnits);
  const point = useWcsPoint();
  const { commit } = appStore.getState();

  return (
    <PanelBody>
      <div className="flex items-start gap-4">
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Origin position on the stock (seen from above)">
          {ROWS.map((y) => COLUMNS.map((x) => {
            const active = wcs.anchor.x === x && wcs.anchor.y === y;
            return (
              <button
                key={`${x}-${y}`} type="button" data-testid={`wcs-anchor-${x}-${y}`} aria-pressed={active} title={`X ${x}, Y ${y}`}
                onClick={() => commit((j) => setWcs(j, { anchor: { ...j.wcs.anchor, x, y } }))}
                className={cn('size-7 rounded border', active ? 'border-primary bg-primary' : 'border-border hover:bg-accent')}
              />
            );
          }))}
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={wcs.anchor.z}
          onValueChange={(v) => v && commit((j) => setWcs(j, { anchor: { ...j.wcs.anchor, z: v as ZAnchor } }))}>
          <ToggleGroupItem value="top" data-testid="wcs-z-top">Top</ToggleGroupItem>
          <ToggleGroupItem value="bottom" data-testid="wcs-z-bottom">Bottom</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="mt-3 space-y-2">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <LengthField key={axis} label={`Offset ${axis.toUpperCase()}`} valueMm={wcs.offset[axis]} testId={`wcs-offset-${axis}`}
            onCommit={(v) => commit((j) => setWcs(j, { offset: { ...j.wcs.offset, [axis]: v } }))} />
        ))}
        <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Work offset</span>
          <select
            data-testid="wcs-work-offset" value={wcs.workOffset} className="h-8 rounded-md border bg-transparent px-2 text-sm"
            onChange={(e) => commit((j) => setWcs(j, { workOffset: e.target.value as WorkOffset }))}
          >
            {WORK_OFFSETS.map((o) => <option key={o} value={o} className="bg-background">{o}</option>)}
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Origin: <span className="font-mono" data-testid="wcs-position">{point ? formatPoint(point, units) : '—'}</span>
      </p>
    </PanelBody>
  );
}
