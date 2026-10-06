import { applyCommand, createJob, type JobCommand, type OpOverlays } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { contourTabTs, removeSelectedTabCommand } from './tabEdits';

const overlays = (): OpOverlays => ({
  tabs: [
    { refIndex: 0, index: 0, t: 0.1, point: { x: 0, y: 0 }, manual: false },
    { refIndex: 1, index: 0, t: 0.3, point: { x: 0, y: 0 }, manual: true },
    { refIndex: 0, index: 1, t: 0.6, point: { x: 0, y: 0 }, manual: false },
  ],
  tabPaths: [], tabBridges: [], unmachined: [], gouges: [],
});
const job = applyCommand(createJob(), { type: 'addOperation', opType: 'profile', toolId: null, id: 'p' } as JobCommand);
const results = { p: { operationId: 'p', diagnostics: [], heights: null, overlays: overlays(), hasToolpath: true } };

describe('tab edits', () => {
  it('lists one contour\'s shown tab positions in index order', () => {
    expect(contourTabTs(overlays(), 0)).toEqual([0.1, 0.6]);
    expect(contourTabTs(overlays(), 1)).toEqual([0.3]);
    expect(contourTabTs(overlays(), 2)).toEqual([]);
  });

  it('removes the selected tab, freezing its contour from the shown positions', () => {
    const s = { job, selectedOperationId: 'p', selectedTab: { refIndex: 0, index: 1 }, camResults: results, camStatus: 'idle' as const };
    expect(removeSelectedTabCommand(s)).toEqual({ type: 'removeTab', opId: 'p', refIndex: 0, index: 1, current: [0.1, 0.6] });
  });

  it('is null without a selection, or when the selected tab is no longer shown', () => {
    const base = { job, selectedOperationId: 'p', camResults: results, camStatus: 'idle' as const };
    expect(removeSelectedTabCommand({ ...base, selectedTab: null })).toBeNull();
    expect(removeSelectedTabCommand({ ...base, selectedTab: { refIndex: 0, index: 2 } })).toBeNull();
    expect(removeSelectedTabCommand({ ...base, selectedOperationId: null, selectedTab: { refIndex: 0, index: 0 } })).toBeNull();
    expect(removeSelectedTabCommand({ ...base, camResults: {}, selectedTab: { refIndex: 0, index: 0 } })).toBeNull();
  });

  it('is null while toolpaths are regenerating: the shown tabs may be stale', () => {
    const s = { job, selectedOperationId: 'p', selectedTab: { refIndex: 0, index: 1 }, camResults: results, camStatus: 'generating' as const };
    expect(removeSelectedTabCommand(s)).toBeNull();
  });
});
