import { type LengthUnit, renameJob, setDisplayUnits } from '@sponcam/core';
import { FilePlus, FolderOpen, type LucideIcon, Redo2, Save, SaveAll, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { newDocument, openFile, openViaPicker, registerOpenFallback, saveDocument } from '@/state/documents';
import { appStore, useApp } from '@/state/store';
import { ToolLibraryDialog } from '@/tools/ToolLibraryDialog';

function ToolButton({ label, icon: Icon, onClick, disabled, testId }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} data-testid={testId} title={label}>
      <Icon className="size-4" />
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}

export function TopBar() {
  const name = useApp((s) => s.job.name);
  const units = useApp((s) => s.job.displayUnits);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const [draft, setDraft] = useState(name);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(name), [name]);
  useEffect(() => {
    registerOpenFallback(() => fileInput.current?.click());
    return () => registerOpenFallback(null);
  }, []);

  const { commit, undo, redo } = appStore.getState();
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <span className="mr-3 font-semibold tracking-tight">Spon</span>
      <Input
        aria-label="Job name" data-testid="job-name" className="h-8 w-56" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          commit((j) => renameJob(j, draft));
          setDraft(appStore.getState().job.name);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <Separator orientation="vertical" className="mx-2 h-6" />
      <ToolButton label="New" icon={FilePlus} onClick={() => void newDocument()} testId="new" />
      <ToolButton label="Open" icon={FolderOpen} onClick={() => void openViaPicker()} testId="open" />
      <ToolButton label="Save" icon={Save} onClick={() => void saveDocument(false)} testId="save" />
      <ToolButton label="Save As" icon={SaveAll} onClick={() => void saveDocument(true)} testId="save-as" />
      <Separator orientation="vertical" className="mx-2 h-6" />
      <ToolButton label="Undo" icon={Undo2} onClick={undo} disabled={!canUndo} testId="undo" />
      <ToolButton label="Redo" icon={Redo2} onClick={redo} disabled={!canRedo} testId="redo" />
      <Separator orientation="vertical" className="mx-2 h-6" />
      <ToolLibraryDialog />
      <div className="ml-auto" />
      <ToggleGroup type="single" size="sm" variant="outline" value={units} onValueChange={(v) => v && commit((j) => setDisplayUnits(j, v as LengthUnit))}>
        <ToggleGroupItem value="mm" data-testid="units-toggle-mm">mm</ToggleGroupItem>
        <ToggleGroupItem value="in" data-testid="units-toggle-in">in</ToggleGroupItem>
      </ToggleGroup>
      <input
        ref={fileInput} type="file" accept=".spon,.stl,.dxf,.nc,.ngc,.gcode,.tap,.cnc" hidden data-testid="open-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openFile(file, null);
        }}
      />
    </header>
  );
}
