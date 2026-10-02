import { formatLength } from '@sponcam/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cancelPendingScale, importPendingScale } from '@/state/documents';
import { useApp } from '@/state/store';
import { scaleChoices, widthScale } from './svgScale';

const fmt = (v: number) => formatLength(v, 'mm');

export function SvgScaleDialog() {
  const pending = useApp((s) => s.pendingScale);
  const [width, setWidth] = useState('');
  const rawSize = pending?.rawSize;
  const choices = rawSize ? scaleChoices(rawSize) : [];
  const widthChoice = widthScale(Number(width));
  const impliedHeight = widthChoice && rawSize && rawSize.x > 0 ? (Number(width) * rawSize.y) / rawSize.x : null;

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancelPendingScale()}>
      <DialogContent data-testid="svg-scale-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Size of {pending?.fileName}</DialogTitle>
          <DialogDescription>This SVG has no real-world size. Pick how its pixels convert to millimetres.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {choices.map((choice) => {
            const isDefault = choice.id === '96';
            return (
              <Button
                key={choice.id} data-testid={`svg-scale-${choice.id}`} variant={isDefault ? 'default' : 'outline'} autoFocus={isDefault}
                className="h-auto justify-between py-3" onClick={() => void importPendingScale(choice.scale)}
              >
                <span>{choice.label}</span>
                <span className="font-mono text-xs opacity-80">{fmt(choice.size.x)} × {fmt(choice.size.y)} mm</span>
              </Button>
            );
          })}
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor="svg-scale-width" className="text-sm text-muted-foreground">Width</label>
            <Input
              id="svg-scale-width" data-testid="svg-scale-width" type="number" min={0} step="any" inputMode="decimal"
              className="h-8 flex-1 font-mono" value={width} onChange={(e) => setWidth(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && widthChoice) void importPendingScale(widthChoice); }}
            />
            <span className="text-sm text-muted-foreground">mm</span>
            <Button
              data-testid="svg-scale-width-apply" variant="outline" disabled={!widthChoice}
              onClick={() => widthChoice && void importPendingScale(widthChoice)}
            >
              Use this width
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="svg-scale-height">
            {impliedHeight !== null ? `Height ${fmt(impliedHeight)} mm` : 'Enter a width to see the height it gives.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
