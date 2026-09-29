import type React from 'react';
import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { allPrograms } from '@/state/programList';
import { appStore, type DockTab, useApp } from '@/state/store';
import { AnalysisView } from './AnalysisView';
import { GcodeList } from './GcodeList';
import { TimelineBar } from './TimelineBar';

const KEY = 'spon.dockHeight';

function initialHeight(): number {
  try {
    const stored = Number(localStorage.getItem(KEY));
    if (stored >= 120) return stored;
  } catch {
    // storage unavailable (private mode): use the default
  }
  return 260;
}

export function BottomDock() {
  const hasPrograms = useApp((s) => allPrograms(s).length > 0);
  const tab = useApp((s) => s.dockTab);
  const [height, setHeight] = useState(initialHeight);
  if (!hasPrograms) return null;

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const startHeight = height;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let latest = startHeight;
    const move = (ev: PointerEvent) => {
      latest = Math.min(Math.max(120, startHeight + (startY - ev.clientY)), window.innerHeight * 0.7);
      setHeight(latest);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(KEY, String(Math.round(latest)));
      } catch {
        // not persisted; fine
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <section data-testid="bottom-dock" className="flex shrink-0 flex-col border-t bg-background" style={{ height }}>
      <div className="h-1.5 shrink-0 cursor-row-resize bg-border/40 hover:bg-primary/40" onPointerDown={startResize} title="Drag to resize" />
      <TimelineBar />
      <div className="flex items-center gap-2 border-b px-3 py-1">
        <ToggleGroup type="single" size="sm" variant="outline" value={tab} onValueChange={(v) => v && appStore.getState().setDockTab(v as DockTab)}>
          <ToggleGroupItem value="gcode" data-testid="dock-tab-gcode">G-code</ToggleGroupItem>
          <ToggleGroupItem value="analysis" data-testid="dock-tab-analysis">Analysis</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="min-h-0 flex-1">{tab === 'gcode' ? <GcodeList /> : <AnalysisView />}</div>
    </section>
  );
}
