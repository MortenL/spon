import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { DropZone } from '@/layout/DropZone';
import { LeftPanel } from '@/layout/LeftPanel';
import { StatusBar } from '@/layout/StatusBar';
import { TopBar } from '@/layout/TopBar';
import { UnitsDialog } from '@/layout/UnitsDialog';
import { startAutosave } from '@/state/autosave';
import { restoreAutosave } from '@/state/documents';
import { startProgramAnalysis } from '@/state/programs';
import { appStore, useApp } from '@/state/store';
import { Viewport } from '@/viewport/Viewport';

export function App() {
  useKeyboardShortcuts();
  useDocumentTitle();
  useEffect(() => {
    void restoreAutosave();
    const stopAutosave = startAutosave(appStore);
    const stopAnalysis = startProgramAnalysis(appStore);
    return () => {
      stopAutosave();
      stopAnalysis();
    };
  }, []);
  const isEmpty = useApp((s) => s.job.model === null && s.job.programs.length === 0);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1">
          <DropZone>
            <Viewport />
            {isEmpty && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Drop an STL, DXF or G-code file here, or use Open
              </div>
            )}
          </DropZone>
        </main>
      </div>
      <StatusBar />
      <UnitsDialog />
      <Toaster position="bottom-center" richColors />
    </div>
  );
}
