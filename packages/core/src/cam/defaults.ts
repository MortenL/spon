import type { ModelKind } from '../import/importFile';
import { threadRow } from '../thread/table';
import type { Tool } from '../tools/types';
import type { Feeds, Heights, Operation, OperationType } from './types';

export const OPERATION_LABELS: Readonly<Record<OperationType, string>> = { profile: 'Profile', pocket: 'Pocket', drill: 'Drill', face: 'Face', chamfer: 'Chamfer', slot: 'Slot', engrave: 'Engrave', vcarve: 'V-carve', vclear: 'V-carve clearing', vplug: 'V-carve plug', thread: 'Thread' };

/** The length of a new Thread operation until a hole or boss is picked (then it follows the feature). */
export const THREAD_DEFAULT_LENGTH = 10;

export function defaultHeights(type: OperationType, modelKind: ModelKind | null): Heights {
  if (type === 'chamfer') {
    return {
      clearance: { from: 'retract', offset: 10 },
      retract: { from: 'stockTop', offset: 5 },
      feed: { from: 'top', offset: 2 },
      top: { from: 'contour', offset: 0 },
      bottom: { from: 'contour', offset: 0 }, // unused: the depth is computed
    };
  }
  const bottom =
    type === 'engrave' || type === 'vcarve' || type === 'vclear' || type === 'vplug' ? { from: 'contour' as const, offset: -1 } // unused: only `top` counts
    : type === 'face' ? (modelKind === 'mesh' ? { from: 'modelTop' as const, offset: 0 } : { from: 'stockTop' as const, offset: 0 })
    : type === 'profile' ? { from: 'stockBottom' as const, offset: -0.2 }
    : type === 'drill' ? { from: 'holeBottom' as const, offset: 0 }
    : type === 'slot' && modelKind === 'mesh' ? { from: 'slotBottom' as const, offset: 0 }
    : modelKind === 'drawing' ? { from: 'stockTop' as const, offset: -3 } // a drawing's contours lie at the stock top
    : { from: 'contour' as const, offset: 0 };
  const top = type === 'engrave' || type === 'vcarve' || type === 'vclear' || type === 'vplug'
    ? { from: 'contour' as const, offset: 0 } // mesh contours and shapes sit at their face's Z
    : { from: 'stockTop' as const, offset: 0 };
  return {
    clearance: { from: 'retract', offset: 10 },
    retract: { from: 'stockTop', offset: 5 },
    feed: { from: 'top', offset: 2 },
    top,
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
      ...base, type, side: 'outside', openSide: 'on', direction: 'climb', stepdown, stockRadial: 0, stockAxial: 0, finishPass: false, entry,
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
  if (type === 'face') {
    return {
      ...base, type, area: 'stock', overlap: d / 2, pattern: 'zigzag', angleDeg: 0, stepoverPct: 70, oneWay: true, direction: 'climb',
      stepdown: preset?.stepdown ?? 1, finishPass: false, finishStepoverPct: 40,
    };
  }
  if (type === 'chamfer') {
    return { ...base, type, side: 'auto', openSide: 'left', direction: 'climb', width: 1, tipOffset: 0.2, stepdown: 0 };
  }
  if (type === 'slot') {
    return {
      ...base, type, strategy: 'auto', width: d, direction: 'climb', stepdown, stepoverPct: preset?.stepoverPct ?? 40, stockRadial: 0, stockAxial: 0,
      finishWalls: false, entry, trochoidal: { stepPct: 10 }, squareEnds: null,
    };
  }
  if (type === 'engrave') {
    return { ...base, type, depthMode: tool?.type === 'vbit' ? 'width' : 'depth', depth: 0.2, lineWidth: 0.5, stepdown: preset?.stepdown ?? 0.5 };
  }
  if (type === 'vcarve') return { ...base, type, maxDepth: null, stepdown: null };
  if (type === 'vplug') return { ...base, type, inlayDepth: 4, startDepth: 2, glueGap: 0.5, stepdown: null };
  if (type === 'thread') {
    const m8 = threadRow('iso-coarse', 'M8')!;
    return {
      ...base, type, kind: 'internal', thread: { standard: m8.standard, size: m8.size, majorDiameter: m8.majorDiameter, pitch: m8.pitch, angle: m8.angle },
      hand: 'right', length: THREAD_DEFAULT_LENGTH, allowance: 0, passes: 1, springPass: false, direction: 'climb', feedCompensation: true,
    };
  }
  if (type === 'vclear') {
    return { ...base, type, sourceId: '', stepoverPct: preset?.stepoverPct ?? 40, stepdown, direction: 'climb', entry };
  }
  return { ...base, type, cycle: 'drill', peck: tool ? Math.max(0.5, Math.round(tool.diameter * 10) / 20) : 1, dwellSeconds: 0.5, diameterFilter: null };
}
