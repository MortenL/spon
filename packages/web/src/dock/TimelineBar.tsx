import { formatLength } from '@sponcam/core';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaybackCursor, useTimeline } from '@/gcode/playback';
import { formatDuration } from '@/panels/format';
import { appStore, useApp } from '@/state/store';

const SPEEDS = [1, 2, 5, 10, 25, 50, 100];
const KIND_LABEL = ['Rapid', 'Feed', 'Arc CW', 'Arc CCW', 'Dwell', 'Tool change', 'Pause', 'Home'];

export function TimelineBar() {
  const tl = useTimeline();
  const playhead = useApp((s) => s.playhead);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const units = useApp((s) => s.job.displayUnits);
  const cursor = usePlaybackCursor();
  const value = tl.total > 0 ? Math.round((Math.min(playhead, tl.total) / tl.total) * 1000) : 0;

  const togglePlay = () => {
    const s = appStore.getState();
    if (!s.playing && s.playhead >= tl.total) s.setPlayhead(0);
    s.setPlaying(!s.playing);
  };

  return (
    <div className="flex items-center gap-3 border-b px-3 py-1.5 text-xs">
      <Button size="sm" variant="secondary" data-testid="play" disabled={tl.total <= 0} onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <select
        data-testid="speed" value={speed} className="h-7 rounded-md border bg-transparent px-1"
        onChange={(e) => appStore.getState().setSpeed(Number(e.target.value))}
      >
        {SPEEDS.map((v) => <option key={v} value={v} className="bg-background">{v}×</option>)}
      </select>
      <div className="relative flex-1">
        <input
          type="range" min={0} max={1000} step={1} value={value} data-testid="timeline-scrubber" className="w-full accent-primary"
          disabled={tl.total <= 0}
          onChange={(e) => {
            const s = appStore.getState();
            s.setPlaying(false);
            s.setPlayhead((Number(e.target.value) / 1000) * tl.total);
          }}
        />
        {tl.entries.slice(1).map((e) => (
          <div key={e.programId} className="pointer-events-none absolute top-0 h-full w-px bg-amber-400" style={{ left: `${(e.start / tl.total) * 100}%` }} />
        ))}
      </div>
      <span className="w-28 text-right font-mono" data-testid="timeline-time">
        {formatDuration(Math.min(playhead, tl.total))} / {formatDuration(tl.total)}
      </span>
      <span className="w-72 truncate text-muted-foreground" data-testid="timeline-move">
        {cursor
          ? `${KIND_LABEL[cursor.kind] ?? '?'}${cursor.feed > 0 ? ` · F ${formatLength(cursor.feed, units)} ${units}/min` : ''} · line ${cursor.line + 1}`
          : '—'}
      </span>
    </div>
  );
}
