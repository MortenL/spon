import { useEffect } from 'react';
import { resumeBridge } from '@/bridge/status';
import { Toaster } from '@/components/ui/sonner';
import { BottomDock } from '@/dock/BottomDock';
import { usePlaybackLoop } from '@/gcode/playbackLoop';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { Inspector } from '@/inspector/Inspector';
import { BodyDialog } from '@/layout/BodyDialog';
import { DropZone } from '@/layout/DropZone';
import { LeftPanel } from '@/layout/LeftPanel';
import { StatusBar } from '@/layout/StatusBar';
import { TopBar } from '@/layout/TopBar';
import { UnitsDialog } from '@/layout/UnitsDialog';
import { startAutosave } from '@/state/autosave';
import { startCamPipeline } from '@/state/cam';
import { restoreAutosave } from '@/state/documents';
import { allPrograms } from '@/state/programList';
import { startProgramAnalysis } from '@/state/programs';
import { appStore, useApp } from '@/state/store';
import { loadToolLibrary } from '@/state/toolLibrary';
import { Viewport } from '@/viewport/Viewport';

export function App() {
  useKeyboardShortcuts();
  useDocumentTitle();
  usePlaybackLoop();
  useEffect(() => {
    void restoreAutosave();
    void loadToolLibrary().catch((e) => console.error('Could not load the tool library', e));
    resumeBridge();
    const stopAutosave = startAutosave(appStore);
    const stopAnalysis = startProgramAnalysis(appStore);
    const stopCam = startCamPipeline(appStore);
    return () => {
      stopAutosave();
      stopAnalysis();
      stopCam();
    };
  }, []);
  const isEmpty = useApp((s) => s.job.model === null && allPrograms(s).length === 0);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <DropZone>
              <Viewport />
              {isEmpty && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Drop an STL, DXF or G-code file here, or use Open
                </div>
              )}
            </DropZone>
          </div>
          <BottomDock />
        </main>
        <Inspector />
      </div>
      <StatusBar />
      <UnitsDialog />
      <BodyDialog />
      <Toaster position="bottom-center" richColors />
    </div>
  );
}
