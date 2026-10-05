import type { JobCommand, OpOverlays } from '@sponcam/core';
import type { AppState } from './store';

/** One contour's tab positions as shown (its overlay `t`s, in index order): the `current` a tab command freezes from. */
export function contourTabTs(overlays: OpOverlays, refIndex: number): number[] {
  return overlays.tabs.filter((tab) => tab.refIndex === refIndex).sort((a, b) => a.index - b.index).map((tab) => tab.t);
}

/** The command removing the selected tab of the selected operation, or null when there is none on show. */
export function removeSelectedTabCommand(s: Pick<AppState, 'job' | 'selectedOperationId' | 'selectedTab' | 'camResults'>): JobCommand | null {
  const sel = s.selectedTab;
  const opId = s.selectedOperationId;
  if (!sel || !opId || !s.job.operations.some((o) => o.id === opId)) return null;
  const overlays = s.camResults[opId]?.overlays;
  if (!overlays || !overlays.tabs.some((tab) => tab.refIndex === sel.refIndex && tab.index === sel.index)) return null;
  return { type: 'removeTab', opId, refIndex: sel.refIndex, index: sel.index, current: contourTabTs(overlays, sel.refIndex) };
}
