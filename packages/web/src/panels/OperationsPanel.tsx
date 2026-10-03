import { CommandError, OPERATION_LABELS } from '@sponcam/core';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addOperation } from '@/state/camView';
import { appStore, useApp } from '@/state/store';
import { duplicateOperation, moveOperation, OP_TYPES, OperationRow, removeOperation, TYPE_ICON } from './OperationRow';
import { shouldHandle } from './listShortcuts';
import { PanelBody } from './PanelBody';
import { SortableList } from './SortableList';

export function OperationsPanel() {
  const operations = useApp((s) => s.job.operations);
  const selectedId = useApp((s) => s.selectedOperationId);
  const [addOpen, setAddOpen] = useState(false);

  // Mounted only while the Operations panel is open, so these shortcuts act only then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogOpen = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
      const action = shouldHandle({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, target: e.target as HTMLElement | null }, dialogOpen);
      const id = appStore.getState().selectedOperationId;
      if (!action || !id) return;
      e.preventDefault(); // also stops the browser's Ctrl+D bookmark
      if (action === 'duplicate') duplicateOperation(id);
      else if (action === 'delete') removeOperation(id);
      else moveOperation(id, action === 'up' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <PanelBody>
      <div data-testid="operations-panel">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="mb-2 w-full" data-testid="add-op">
              <Plus className="size-3.5" data-icon="inline-start" />
              Add operation
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48">
            {OP_TYPES.map((type) => (
              <Button
                key={type} variant="ghost" className="justify-start" data-testid={`add-op-${type}`}
                onClick={() => {
                  setAddOpen(false);
                  addOperation(type);
                }}
              >
                {(() => { const Icon = TYPE_ICON[type]; return <Icon className="size-3.5" data-icon="inline-start" />; })()}
                {OPERATION_LABELS[type]}
              </Button>
            ))}
          </PopoverContent>
        </Popover>

        {operations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operations. Add a profile, pocket, drill, face, chamfer or slot operation.</p>
        ) : (
          <SortableList
            items={operations} label={(op) => op.name} handleTestId="op-drag"
            onMove={(id, steps) => {
              const one = { type: 'moveOperation' as const, id, delta: (steps > 0 ? 1 : -1) as 1 | -1 };
              try { appStore.getState().dispatchBatch(Array.from({ length: Math.abs(steps) }, () => one)); }
              catch (err) { if (err instanceof CommandError) toast.error(err.message); else throw err; }
            }}
          >
            {(op, handle, index) => (
              <OperationRow
                op={op} index={index} count={operations.length}
                selected={op.id === selectedId} dragHandle={handle}
              />
            )}
          </SortableList>
        )}
      </div>
    </PanelBody>
  );
}
