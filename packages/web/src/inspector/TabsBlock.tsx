import type { PocketOp, ProfileOp, SlotOp, TabSettings } from '@sponcam/core';
import { Button } from '@/components/ui/button';
import { LengthField, NumericField } from '@/panels/NumericField';
import { runCommand } from '@/state/camView';

const intField = (label: string, value: number, testId: string, min: number, onCommit: (v: number) => void, disabled: boolean) => (
  <NumericField
    label={label} value={value} testId={testId} disabled={disabled}
    format={(v) => String(Math.round(v))}
    parse={(t) => { const n = Number(t.trim()); return Number.isInteger(n) && n >= min ? n : null; }}
    onCommit={onCommit}
  />
);

/**
 * Tab settings shared by profile, pocket and slot operations. `islands` is only meaningful for pockets: a pocket
 * holds tabs on its islands, so with none the block is shown disabled with an explanation.
 */
export function TabsBlock({ op, islands }: { op: ProfileOp | PocketOp | SlotOp; islands?: number }) {
  const { tabs } = op;
  const noIslands = op.type === 'pocket' && islands === 0;
  const off = noIslands;
  const patchTabs = (p: Partial<TabSettings>) => runCommand({ type: 'updateOperation', id: op.id, patch: { tabs: { ...tabs, ...p } } });
  const manualCount = tabs.manual.length;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="pass-tabs" className="accent-primary" disabled={off} checked={tabs.enabled} onChange={(e) => patchTabs({ enabled: e.target.checked })} />
        Tabs
      </label>
      {noIslands && (
        <p data-testid="pass-tab-no-islands" className="text-xs text-muted-foreground">Tabs hold islands; this pocket has none</p>
      )}
      {(tabs.enabled || noIslands) && (
        <div className="space-y-2 pl-1">
          <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
            <span className="text-muted-foreground">Shape</span>
            <select
              data-testid="pass-tab-shape" value={tabs.shape} disabled={off} className="h-8 rounded-md border bg-transparent px-2 text-sm"
              onChange={(e) => patchTabs({ shape: e.target.value as TabSettings['shape'] })}
            >
              <option value="rect" className="bg-background">Rectangle</option>
              <option value="triangle" className="bg-background">Triangle</option>
            </select>
          </label>
          <LengthField label="Width" valueMm={tabs.width} testId="pass-tab-width" min={0.01} disabled={off} onCommit={(v) => patchTabs({ width: v })} />
          <LengthField label="Height" valueMm={tabs.height} testId="pass-tab-height" min={0.01} disabled={off} onCommit={(v) => patchTabs({ height: v })} />
          <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
            <span className="text-muted-foreground">Placement</span>
            <select
              data-testid="pass-tab-placement" value={tabs.placement} disabled={off} className="h-8 rounded-md border bg-transparent px-2 text-sm"
              onChange={(e) => patchTabs({ placement: e.target.value as TabSettings['placement'] })}
            >
              <option value="count" className="bg-background">Count</option>
              <option value="spacing" className="bg-background">Spacing</option>
            </select>
          </label>
          {tabs.placement === 'count'
            ? intField('Count', tabs.count, 'pass-tab-count', 1, (v) => patchTabs({ count: v }), off)
            : <LengthField label="Spacing" valueMm={tabs.spacing} testId="pass-tab-spacing" min={0.01} disabled={off} onCommit={(v) => patchTabs({ spacing: v })} />}
          {manualCount > 0 && (
            <p data-testid="pass-tab-manual-count" className="text-xs text-muted-foreground">
              {`${manualCount} ${manualCount === 1 ? 'contour' : 'contours'} placed by hand`}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" data-testid="pass-tab-reset" disabled={off || manualCount === 0} onClick={() => patchTabs({ manual: [] })}>
              Reset tab positions
            </Button>
            {/* Enabled by the per-contour reset task. */}
            <Button variant="outline" size="sm" data-testid="pass-tab-reset-contour" disabled>
              Reset this contour
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
