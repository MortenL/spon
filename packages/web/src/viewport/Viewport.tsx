import { bboxCenter, bboxSize, camContext, describeGeometry, firstPickLength } from '@sponcam/core';
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { runCommand } from '@/state/camView';
import { useStockBox } from '@/state/selectors';
import { appStore, useApp, type ViewPreset, type Visibility } from '@/state/store';
import { applyPick, pickDxf } from './camPick';
import { CamOverlays } from './CamOverlays';
import { ModelObject } from './ModelObject';
import { BedGrid, CameraRig, CursorTracker, StockBox, WcsTriad } from './SceneObjects';
import { TextObjects } from './TextObjects';
import { Toolpaths } from './Toolpaths';

const PRESETS: { preset: ViewPreset; label: string }[] = [
  { preset: 'top', label: 'Top' },
  { preset: 'front', label: 'Front' },
  { preset: 'right', label: 'Right' },
  { preset: 'iso', label: 'Iso' },
  { preset: 'fit', label: 'Fit' },
];

const TOGGLES: { key: Visibility; label: string }[] = [
  { key: 'rapids', label: 'Rapids' },
  { key: 'model', label: 'Model' },
  { key: 'stock', label: 'Stock' },
];

export function Viewport() {
  const pickMode = useApp((s) => s.pickMode);
  const visibility = useApp((s) => s.visibility);
  const camPick = useApp((s) => s.camPick);
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const hiddenLayers = useApp((s) => s.hiddenLayers);
  const stock = useStockBox();
  const pickOp = camPick ? job.operations.find((o) => o.id === camPick.operationId) : null;

  const onDxfPlaneClick = (e: ThreeEvent<MouseEvent>) => {
    if (!camPick || !pickOp || e.delta > 4) return;
    e.stopPropagation();
    if (camPick.target !== 'geometry') {
      // a drawing has no mesh face for a height pick
      toast.info('Heights can only be picked from faces of a 3D model');
      return;
    }
    const ctx = camContext(job, geometry);
    const q = { x: e.point.x - ctx.origin.x, y: e.point.y - ctx.origin.y };
    const res = pickDxf(pickOp, ctx, q, new Set(hiddenLayers));
    if ('error' in res) {
      toast.error(res.error);
      return;
    }
    const geometryRefs = applyPick(pickOp, res.refs);
    runCommand({ type: 'updateOperation', id: pickOp.id, patch: { geometry: geometryRefs, ...(geometry ? firstPickLength(pickOp, describeGeometry(job, geometry), geometryRefs) : {}) } });
  };

  return (
    <div className={cn('relative h-full w-full', (pickMode !== 'none' || camPick) && 'cursor-crosshair')} data-testid="viewport">
      {/* up = +Z must be set before OrbitControls is created: the whole scene is Z-up like the machine. */}
      <Canvas camera={{ position: [150, -200, 150], up: [0, 0, 1], fov: 45, near: 0.1, far: 100000 }} dpr={[1, 2]}>
        <color attach="background" args={['#1c1d21']} />
        <hemisphereLight args={['#ffffff', '#3a3d44', 0.9]} position={[0, 0, 1]} />
        <directionalLight position={[150, -200, 300]} intensity={1.5} />
        <directionalLight position={[-150, 200, -100]} intensity={0.4} />
        <OrbitControls makeDefault />
        <BedGrid />
        <StockBox />
        <ModelObject />
        {camPick && geometry?.kind === 'drawing' && stock && (
          <mesh position={[bboxCenter(stock).x, bboxCenter(stock).y, 0]} visible={false} onClick={onDxfPlaneClick}>
            <planeGeometry args={[Math.max(bboxSize(stock).x, 1e-3), Math.max(bboxSize(stock).y, 1e-3)]} />
          </mesh>
        )}
        <Toolpaths />
        <CamOverlays />
        <TextObjects />
        <WcsTriad />
        <CameraRig />
        <CursorTracker />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport />
        </GizmoHelper>
      </Canvas>
      <div className="absolute left-3 top-3 flex gap-1">
        {TOGGLES.map(({ key, label }) => (
          <Toggle
            key={key} size="sm" variant="outline" data-testid={`toggle-${key}`}
            pressed={visibility[key]} onPressedChange={() => appStore.getState().toggleVisibility(key)}
            className="bg-background/80"
          >
            {label}
          </Toggle>
        ))}
      </div>
      <div className="absolute right-3 top-3 flex gap-1">
        {PRESETS.map(({ preset, label }) => (
          <Button key={preset} size="sm" variant="secondary" data-testid={`view-${preset}`} onClick={() => appStore.getState().requestView(preset)}>
            {label}
          </Button>
        ))}
      </div>
      {pickMode !== 'none' && (
        <div data-testid="pick-hint" className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-amber-500/90 px-3 py-1 text-xs font-medium text-black">
          {pickMode === 'face' ? 'Click a face to put it on the bed' : 'Click an edge to line it up with X'} · Esc to cancel
        </div>
      )}
      {camPick && (
        <div data-testid="cam-pick-hint" className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-amber-500/90 px-3 py-1 text-xs font-medium text-black">
          Click geometry for {pickOp?.name ?? 'the operation'} · Alt-click for a single loop · Esc to finish
        </div>
      )}
    </div>
  );
}
