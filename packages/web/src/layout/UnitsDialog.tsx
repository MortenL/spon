import { bboxOfPoints, bboxSize, formatLength, type LengthUnit, unitScale } from '@sponcam/core';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cancelPendingImport, finishImport } from '@/state/documents';
import { useApp } from '@/state/store';

const UNIT_LABELS: Record<LengthUnit, string> = { mm: 'Millimetres', in: 'Inches' };

export function UnitsDialog() {
  const pending = useApp((s) => s.pendingImport);
  const rawSize = useMemo(() => {
    const box = pending ? bboxOfPoints(pending.geometry.rawPoints) : null;
    return box ? bboxSize(box) : null;
  }, [pending]);

  const describe = (unit: LengthUnit) =>
    rawSize ? `${[rawSize.x, rawSize.y, rawSize.z].map((v) => formatLength(v * unitScale(unit), 'mm')).join(' × ')} mm` : '';

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancelPendingImport()}>
      <DialogContent data-testid="units-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Units for {pending?.fileName}</DialogTitle>
          <DialogDescription>This file does not say which units it uses. Pick the units it was modelled in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {(['mm', 'in'] as const).map((unit) => {
            const suggested = pending?.suggestedUnits === unit;
            return (
              <Button
                key={unit} data-testid={`units-${unit}`} variant={suggested ? 'default' : 'outline'} autoFocus={suggested}
                className="h-auto justify-between py-3" onClick={() => pending && void finishImport(pending, unit)}
              >
                <span>{UNIT_LABELS[unit]}{suggested ? ' (suggested)' : ''}</span>
                <span className="font-mono text-xs opacity-80">{describe(unit)}</span>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
