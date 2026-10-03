import { resetOrientation, rotateQuarter, setZSpin } from '@sponcam/core';
import { ArrowDownToLine, MoveHorizontal, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { appStore, useApp } from '@/state/store';
import { NumericField } from './NumericField';
import { PanelBody } from './PanelBody';

const QUARTER_TURNS = [
  { axis: 'x', direction: 1, label: '+90° X', testId: 'rotate-x-pos' },
  { axis: 'x', direction: -1, label: '−90° X', testId: 'rotate-x-neg' },
  { axis: 'y', direction: 1, label: '+90° Y', testId: 'rotate-y-pos' },
  { axis: 'y', direction: -1, label: '−90° Y', testId: 'rotate-y-neg' },
] as const;

function parseDegrees(text: string): number | null {
  const cleaned = text.trim().replace('°', '').replace(',', '.');
  const value = Number(cleaned);
  return cleaned !== '' && Number.isFinite(value) ? value : null;
}

export function OrientationPanel() {
  const model = useApp((s) => s.job.model);
  const pickMode = useApp((s) => s.pickMode);

  if (!model) {
    return (
      <PanelBody>
        <p className="text-sm text-muted-foreground">Load a model to orient it.</p>
      </PanelBody>
    );
  }

  const isMesh = model.kind === 'mesh';
  const { commit, setPickMode } = appStore.getState();
  const toggle = (mode: 'face' | 'edge') => setPickMode(pickMode === mode ? 'none' : mode);

  return (
    <PanelBody>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="col-span-2" variant={pickMode === 'face' ? 'default' : 'outline'} disabled={!isMesh}
          onClick={() => toggle('face')} data-testid="pick-face">
          <ArrowDownToLine className="size-4" /> Pick bottom face
        </Button>
        {QUARTER_TURNS.map(({ axis, direction, label, testId }) => (
          <Button key={testId} size="sm" variant="outline" disabled={!isMesh} data-testid={testId}
            onClick={() => commit((j) => rotateQuarter(j, axis, direction))}>
            {label}
          </Button>
        ))}
        <Button size="sm" className="col-span-2" variant={pickMode === 'edge' ? 'default' : 'outline'} disabled={!isMesh}
          onClick={() => toggle('edge')} data-testid="align-edge">
          <MoveHorizontal className="size-4" /> Align edge to X
        </Button>
      </div>
      <div className="mt-3">
        <NumericField label="Spin about Z" value={model.transform.zDeg} suffix="°" testId="z-spin"
          format={(v) => v.toFixed(1)} parse={parseDegrees} onCommit={(v) => commit((j) => setZSpin(j, v))} />
      </div>
      <Button size="sm" variant="ghost" className="mt-2 w-full" data-testid="reset-orientation" onClick={() => commit(resetOrientation)}>
        <RotateCcw className="size-4" /> Reset orientation
      </Button>
    </PanelBody>
  );
}
