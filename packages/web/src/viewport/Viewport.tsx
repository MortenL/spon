import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { appStore, useApp, type ViewPreset, type Visibility } from '@/state/store';
import { ModelObject } from './ModelObject';
import { BedGrid, CameraRig, CursorTracker, StockBox, WcsTriad } from './SceneObjects';
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
  return (
    <div className={cn('relative h-full w-full', pickMode !== 'none' && 'cursor-crosshair')} data-testid="viewport">
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
        <Toolpaths />
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
    </div>
  );
}
