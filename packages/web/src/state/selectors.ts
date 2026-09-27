import { type BBox, type Placement, stockBox, type Vec3, wcsPoint } from '@sponcam/core';
import { useMemo } from 'react';
import { placementFor } from './placement';
import { useApp } from './store';

export function usePlacement(): Placement | null {
  const model = useApp((s) => s.job.model);
  const geometry = useApp((s) => s.geometry);
  return model && geometry ? placementFor(model, geometry) : null;
}

export function useStockBox(): BBox | null {
  const job = useApp((s) => s.job);
  const placement = usePlacement();
  return useMemo(() => stockBox(job, placement), [job, placement]);
}

export function useWcsPoint(): Vec3 | null {
  const wcs = useApp((s) => s.job.wcs);
  const stock = useStockBox();
  return useMemo(() => (stock ? wcsPoint(wcs, stock) : null), [wcs, stock]);
}
