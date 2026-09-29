import { useEffect } from 'react';
import { allPrograms } from '../state/programList';
import { appStore, useApp } from '../state/store';
import { movePlayhead } from './playback';
import { buildTimeline } from './timeline';

/** Advances the playhead while playing; the active program follows the playhead. */
export function usePlaybackLoop(): void {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = appStore.getState();
      const tl = buildTimeline(allPrograms(s), s.programData);
      // rAF is throttled in background tabs; on refocus one tick can carry a huge dt, so cap it.
      const dt = Math.min(now - last, 100);
      const next = s.playhead + (dt / 1000) * s.speed;
      last = now;
      if (tl.total <= 0 || next >= tl.total) {
        movePlayhead(tl.total);
        s.setPlaying(false);
        return;
      }
      movePlayhead(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
