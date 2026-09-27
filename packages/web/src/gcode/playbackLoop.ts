import { useEffect } from 'react';
import { appStore, useApp } from '../state/store';
import { buildTimeline, locate } from './timeline';

/** Advances the playhead while playing; the active program follows the playhead. */
export function usePlaybackLoop(): void {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = appStore.getState();
      const tl = buildTimeline(s.job.programs, s.programData);
      const next = s.playhead + ((now - last) / 1000) * s.speed;
      last = now;
      if (tl.total <= 0 || next >= tl.total) {
        s.setPlayhead(tl.total);
        s.setPlaying(false);
        return;
      }
      s.setPlayhead(next);
      const at = locate(tl, next);
      if (at && at.entry.programId !== s.activeProgramId) s.setActiveProgram(at.entry.programId);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
