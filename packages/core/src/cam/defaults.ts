import type { ModelKind } from '../import/importFile';
import type { Tool } from '../tools/types';
import type { Feeds, Heights, Operation, OperationType } from './types';

export const OPERATION_LABELS: Readonly<Record<OperationType, string>> = { profile: 'Profile', pocket: 'Pocket', drill: 'Drill' };

export function defaultHeights(type: OperationType, modelKind: ModelKind | null): Heights {
  const bottom =
    type === 'profile' ? { from: 'stockBottom' as const, offset: -0.2 }
    : type === 'drill' ? { from: 'holeBottom' as const, offset: 0 }
    : modelKind === 'drawing' ? { from: 'stockTop' as const, offset: -3 } // a drawing's contours lie at the stock top
    : { from: 'contour' as const, offset: 0 };
  return {
    clearance: { from: 'retract', offset: 10 },
    retract: { from: 'stockTop', offset: 5 },
    feed: { from: 'top', offset: 2 },
    top: { from: 'stockTop', offset: 0 },
    bottom,
  };
}

function feedsFor(tool: Tool | null): Feeds {
  const p = tool?.presets[0];
  return p
    ? { presetName: p.name, rpm: p.rpm, feed: p.feed, plungeFeed: p.plungeFeed, coolant: p.coolant }
    : { presetName: null, rpm: 10000, feed: 1000, plungeFeed: 300, coolant: 'off' };
}

export function newOperation(type: OperationType, opts: { id: string; name: string; tool: Tool | null; modelKind: ModelKind | null }): Operation {
  const { id, name, tool, modelKind } = opts;
  const d = tool?.diameter ?? 6;
  const preset = tool?.presets[0];
  const base = { id, name, enabled: true, toolId: tool?.id ?? null, feeds: feedsFor(tool), heights: defaultHeights(type, modelKind), geometry: [] };
  const stepdown = preset?.stepdown ?? Math.max(0.5, d / 2);
  const entry = { mode: 'auto' as const, helixDiameterPct: 90, rampAngleDeg: 3 };
  if (type === 'profile') {
    return {
      ...base, type, side: 'outside', direction: 'climb', stepdown, stockRadial: 0, stockAxial: 0, finishPass: false, entry,
      leads: { mode: 'arc', length: d / 2, startPoint: 'auto' },
      tabs: { enabled: false, shape: 'rect', width: Math.max(4, d), height: 2, placement: 'count', count: 4, spacing: 50, positions: null },
    };
  }
  if (type === 'pocket') {
    return {
      ...base, type, direction: 'climb', stepdown, stepoverPct: preset?.stepoverPct ?? 40, stockRadial: 0, stockAxial: 0,
      finishWalls: false, finishFloor: false, entry,
    };
  }
  return { ...base, type, cycle: 'drill', peck: tool ? Math.max(0.5, Math.round(tool.diameter * 10) / 20) : 1, dwellSeconds: 0.5, diameterFilter: null };
}
