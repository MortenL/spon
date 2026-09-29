import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatSize } from '@/panels/format';
import { cancelPendingBodies, importPendingBody } from '@/state/documents';
import { defaultBody } from '@/state/importFlow';
import { useApp } from '@/state/store';

/** Asks which body of a multi-body STEP/IGES file becomes the model. */
export function BodyDialog() {
  const pending = useApp((s) => s.pendingBodies);
  const units = useApp((s) => s.job.displayUnits);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (pending) setSelected(defaultBody(pending.bodies));
  }, [pending]);

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancelPendingBodies()}>
      <DialogContent data-testid="body-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a body from {pending?.fileName}</DialogTitle>
          <DialogDescription>This file contains {pending?.bodies.length} bodies. Spon machines one body per job.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 gap-1 overflow-y-auto" role="radiogroup" aria-label="Bodies">
          {pending?.bodies.map((b, i) => {
            const checked = i === selected;
            return (
              <Button
                key={i} role="radio" aria-checked={checked} data-state={checked ? 'checked' : 'unchecked'} data-testid={`body-row-${i}`}
                variant={checked ? 'default' : 'outline'} className="h-auto justify-between gap-3 py-2"
                onClick={() => setSelected(i)} onDoubleClick={() => void importPendingBody(i)}
              >
                <span className="truncate">{b.name}</span>
                <span className="shrink-0 font-mono text-xs opacity-80">
                  {formatSize(b.size, units)} · {b.triangles.toLocaleString()} triangles
                </span>
              </Button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="body-cancel" onClick={cancelPendingBodies}>Cancel</Button>
          <Button data-testid="body-import" onClick={() => void importPendingBody(selected)}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
