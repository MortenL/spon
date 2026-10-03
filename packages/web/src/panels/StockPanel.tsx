import { type AutoStock, bboxSize, DEFAULT_AUTO_STOCK, fixedStockFromBox, setStock } from '@sponcam/core';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePlacement, useStockBox } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { formatSize } from './format';
import { LengthField } from './NumericField';
import { PanelBody } from './PanelBody';
import { fixedStockPatch } from './stockNoModel';

const AXES = ['x', 'y', 'z'] as const;

export function StockPanel() {
  const job = useApp((s) => s.job);
  const placement = usePlacement();
  const box = useStockBox();

  if (!job.model) {
    const { commit } = appStore.getState();
    const size = job.stock.mode === 'fixed' ? job.stock.size : { x: 0, y: 0, z: 0 };
    return (
      <PanelBody>
        <p className="mb-3 text-sm text-muted-foreground">No model: set fixed stock for a spoilboard or blank</p>
        <div className="space-y-2">
          {AXES.map((axis) => (
            <LengthField key={`size-${axis}`} label={`Size ${axis.toUpperCase()}`} valueMm={size[axis]} min={0} testId={`stock-size-${axis}`}
              onCommit={(v) => commit((j) => setStock(j, fixedStockPatch(j.stock, axis, v)))} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Stock: <span className="font-mono" data-testid="stock-size">{formatSize(box ? bboxSize(box) : size, job.displayUnits)}</span>
        </p>
      </PanelBody>
    );
  }
  if (!placement || !box) {
    return (
      <PanelBody>
        <p className="text-sm text-muted-foreground">Load a model to set up stock.</p>
      </PanelBody>
    );
  }

  const { commit } = appStore.getState();
  const stock = job.stock;
  const drawing = job.model.kind === 'drawing';

  const switchMode = (mode: string) => {
    // Switching keeps the current stock box so nothing jumps in the viewport.
    if (mode === 'fixed' && stock.mode === 'auto') commit((j) => setStock(j, fixedStockFromBox(box, placement.bbox)));
    if (mode === 'auto' && stock.mode === 'fixed') commit((j) => setStock(j, structuredClone(DEFAULT_AUTO_STOCK) as AutoStock));
  };

  return (
    <PanelBody>
      <ToggleGroup type="single" variant="outline" size="sm" value={stock.mode} onValueChange={(v) => v && switchMode(v)} className="mb-3 w-full">
        <ToggleGroupItem value="auto" data-testid="stock-mode-auto" className="flex-1">Auto</ToggleGroupItem>
        <ToggleGroupItem value="fixed" data-testid="stock-mode-fixed" className="flex-1">Fixed</ToggleGroupItem>
      </ToggleGroup>

      <div className="space-y-2">
        {stock.mode === 'auto' ? (
          <>
            <LengthField label="Side margin" valueMm={stock.margin.xy} min={0} testId="stock-margin-xy"
              onCommit={(v) => commit((j) => setStock(j, { ...stock, margin: { ...stock.margin, xy: v } }))} />
            {!drawing && (
              <LengthField label="Above model" valueMm={stock.margin.zTop} min={0} testId="stock-margin-top"
                onCommit={(v) => commit((j) => setStock(j, { ...stock, margin: { ...stock.margin, zTop: v } }))} />
            )}
            <LengthField label={drawing ? 'Thickness' : 'Below model'} valueMm={stock.margin.zBottom} min={0} testId="stock-margin-bottom"
              onCommit={(v) => commit((j) => setStock(j, { ...stock, margin: { ...stock.margin, zBottom: v } }))} />
          </>
        ) : (
          <>
            {AXES.map((axis) => (
              <LengthField key={`size-${axis}`} label={`Size ${axis.toUpperCase()}`} valueMm={stock.size[axis]} min={0.001} testId={`stock-size-${axis}`}
                onCommit={(v) => commit((j) => setStock(j, { ...stock, size: { ...stock.size, [axis]: v } }))} />
            ))}
            {AXES.filter((axis) => !(drawing && axis === 'z')).map((axis) => (
              <LengthField key={`offset-${axis}`} label={`Model offset ${axis.toUpperCase()}`} valueMm={stock.modelOffset[axis]} testId={`stock-offset-${axis}`}
                onCommit={(v) => commit((j) => setStock(j, { ...stock, modelOffset: { ...stock.modelOffset, [axis]: v } }))} />
            ))}
          </>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Stock: <span className="font-mono" data-testid="stock-size">{formatSize(bboxSize(box), job.displayUnits)}</span>
      </p>
    </PanelBody>
  );
}
