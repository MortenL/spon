import { CommandError } from '@sponcam/core';
import { Plus } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { appStore, useApp } from '@/state/store';
import { addTextCentred, duplicateText, moveText, removeText } from '@/state/texts';
import { shouldHandle } from './listShortcuts';
import { PanelBody } from './PanelBody';
import { SortableList } from './SortableList';
import { TextRow } from './TextRow';

export function TextPanel() {
  const texts = useApp((s) => s.job.texts);
  const selectedId = useApp((s) => s.selectedTextId);

  // Mounted only while the Text panel is open, so these shortcuts act only then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogOpen = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
      const action = shouldHandle({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, target: e.target as HTMLElement | null }, dialogOpen);
      const id = appStore.getState().selectedTextId;
      if (!action || !id) return;
      e.preventDefault(); // also stops the browser's Ctrl+D bookmark
      if (action === 'duplicate') duplicateText(id);
      else if (action === 'delete') removeText(id);
      else moveText(id, action === 'up' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <PanelBody>
      <div data-testid="text-panel">
        <Button size="sm" variant="outline" className="mb-2 w-full" data-testid="text-add" onClick={() => addTextCentred()}>
          <Plus className="size-3.5" data-icon="inline-start" />
          Add text
        </Button>
        {texts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No text. Add a text to V-carve, engrave or cut lettering.</p>
        ) : (
          <SortableList
            items={texts} label={(t) => t.name} handleTestId="text-drag"
            onMove={(id, steps) => {
              const one = { type: 'moveText' as const, id, delta: (steps > 0 ? 1 : -1) as 1 | -1 };
              try { appStore.getState().dispatchBatch(Array.from({ length: Math.abs(steps) }, () => one)); }
              catch (err) { if (err instanceof CommandError) toast.error(err.message); else throw err; }
            }}
          >
            {(t, handle, index) => <TextRow text={t} index={index} count={texts.length} selected={t.id === selectedId} dragHandle={handle} />}
          </SortableList>
        )}
      </div>
    </PanelBody>
  );
}
