import { Edges } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { usePlacement } from '@/state/selectors';
import { type ModelGeometry, useApp } from '@/state/store';
import { layerLinePositions, lineColor, meshToGeometry, toThreeQuaternion } from './convert';

type MeshGeometry = Extract<ModelGeometry, { kind: 'mesh' }>;
type DrawingGeometry = Extract<ModelGeometry, { kind: 'drawing' }>;

export function ModelObject() {
  const geometry = useApp((s) => s.geometry);
  const placement = usePlacement();
  if (!geometry || !placement) return null;
  const t = placement.translation;
  return (
    <group position={[t.x, t.y, t.z]} quaternion={toThreeQuaternion(placement.rotation)} scale={placement.scale}>
      {geometry.kind === 'mesh'
        ? <ModelMesh geometry={geometry} />
        : <DrawingLines geometry={geometry} chordTol={0.01 / placement.scale} />}
    </group>
  );
}

function ModelMesh({ geometry }: { geometry: MeshGeometry }) {
  const showEdges = useApp((s) => s.showEdges);
  const buffer = useMemo(() => meshToGeometry(geometry.mesh), [geometry.mesh]);
  useEffect(() => () => buffer.dispose(), [buffer]);
  return (
    <mesh geometry={buffer}>
      <meshStandardMaterial
        color="#9aa6b5" metalness={0.15} roughness={0.65} flatShading side={THREE.DoubleSide}
        polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
      />
      {showEdges && <Edges threshold={20} color="#1f2328" />}
    </mesh>
  );
}

function DrawingLines({ geometry, chordTol }: { geometry: DrawingGeometry; chordTol: number }) {
  const hidden = useApp((s) => s.hiddenLayers);
  const layers = useMemo(
    () => geometry.drawing.layers.map((layer) => ({ name: layer.name, color: lineColor(layer.color), positions: layerLinePositions(layer, chordTol) })),
    [geometry.drawing, chordTol],
  );
  return (
    <>
      {layers.filter((l) => !hidden.includes(l.name)).map((layer) => (
        <lineSegments key={layer.name}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[layer.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={layer.color} />
        </lineSegments>
      ))}
    </>
  );
}
