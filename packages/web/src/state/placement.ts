import { computePlacement, type ModelRef, type Placement } from '@sponcam/core';
import type { ModelGeometry } from './store';

// ModelRef objects are replaced on every edit and geometry on every load, so identity caching is exact
const cache = new WeakMap<ModelRef, WeakMap<ModelGeometry, Placement | null>>();

/** The model's placement, computed once per (model, geometry) pair and shared by every caller. */
export function placementFor(model: ModelRef, geometry: ModelGeometry): Placement | null {
  let byGeometry = cache.get(model);
  if (!byGeometry) {
    byGeometry = new WeakMap();
    cache.set(model, byGeometry);
  }
  if (byGeometry.has(geometry)) return byGeometry.get(geometry) ?? null;
  const placement = computePlacement(model, geometry.rawPoints);
  byGeometry.set(geometry, placement);
  return placement;
}
