import {
  alignEdgeToX, type LengthUnit, layFlat, nearestTriangleEdge, planarRegion, regionNormal, unitScale, type Vec3,
} from '@sponcam/core';
import { Edges, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { usePlacement } from '@/state/selectors';
import { appStore, type ModelGeometry, useApp } from '@/state/store';
import { layerLinePositions, lineColor, meshToGeometry, subsetGeometry, toThreeQuaternion } from './convert';
import { noRaycast } from './SceneObjects';

type MeshGeometry = Extract<ModelGeometry, { kind: 'mesh' }>;
type DrawingGeometry = Extract<ModelGeometry, { kind: 'drawing' }>;

const HIGHLIGHT = '#f59e0b';

export function ModelObject() {
  const visible = useApp((s) => s.visibility.model);
  const geometry = useApp((s) => s.geometry);
  const model = useApp((s) => s.job.model);
  const placement = usePlacement();
  if (!visible || !geometry || !model || !placement) return null;
  const t = placement.translation;
  return (
    <group position={[t.x, t.y, t.z]} quaternion={toThreeQuaternion(placement.rotation)} scale={placement.scale}>
      {geometry.kind === 'mesh'
        ? <ModelMesh geometry={geometry} importUnits={model.importUnits} />
        : <DrawingLines geometry={geometry} chordTol={0.01 / placement.scale} />}
    </group>
  );
}

function ModelMesh({ geometry, importUnits }: { geometry: MeshGeometry; importUnits: LengthUnit }) {
  const showEdges = useApp((s) => s.showEdges);
  const pickMode = useApp((s) => s.pickMode);
  const buffer = useMemo(() => meshToGeometry(geometry.mesh), [geometry.mesh]);
  useEffect(() => () => buffer.dispose(), [buffer]);

  const [region, setRegion] = useState<number[] | null>(null);
  const [edge, setEdge] = useState<[Vec3, Vec3] | null>(null);
  const highlight = useMemo(() => (region ? subsetGeometry(geometry.mesh, region) : null), [region, geometry.mesh]);
  useEffect(() => () => highlight?.dispose(), [highlight]);
  useEffect(() => {
    setRegion(null);
    setEdge(null);
  }, [pickMode]);

  // 0.01 mm plane tolerance, expressed in the mesh's raw units
  const regionAt = (tri: number) => planarRegion(geometry.mesh, geometry.adjacency, tri, { distanceTol: 0.01 / unitScale(importUnits) });
  const edgeAt = (e: ThreeEvent<PointerEvent | MouseEvent>, tri: number): [Vec3, Vec3] => {
    const local = e.object.worldToLocal(e.point.clone()); // mesh-local = raw model coordinates
    return nearestTriangleEdge(geometry.mesh, tri, { x: local.x, y: local.y, z: local.z });
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (pickMode === 'none' || e.faceIndex == null) return;
    e.stopPropagation();
    if (pickMode === 'face') {
      if (!region?.includes(e.faceIndex)) setRegion(regionAt(e.faceIndex));
    } else {
      setEdge(edgeAt(e, e.faceIndex));
    }
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (pickMode === 'none' || e.faceIndex == null || e.delta > 4) return; // ignore the end of an orbit drag
    e.stopPropagation();
    const { commit, setPickMode, requestView } = appStore.getState();
    if (pickMode === 'face') {
      const tris = region?.includes(e.faceIndex) ? region : regionAt(e.faceIndex);
      const normal = regionNormal(geometry.mesh, tris);
      commit((j) => layFlat(j, normal));
      requestView('fit');
    } else {
      const [a, b] = edgeAt(e, e.faceIndex);
      commit((j) => alignEdgeToX(j, a, b));
    }
    setPickMode('none');
  };

  return (
    <>
      <mesh
        geometry={buffer} onPointerMove={onPointerMove} onClick={onClick} onPointerOut={() => { setRegion(null); setEdge(null); }}
        // a full-mesh raycast on every pointer move is only worth it while picking a face or edge
        raycast={pickMode === 'none' ? noRaycast : THREE.Mesh.prototype.raycast}
      >
        <meshStandardMaterial
          color="#9aa6b5" metalness={0.15} roughness={0.65} flatShading side={THREE.DoubleSide}
          polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
        />
        {showEdges && <Edges threshold={20} color="#1f2328" />}
      </mesh>
      {highlight && (
        <mesh geometry={highlight} raycast={noRaycast} renderOrder={2}>
          <meshBasicMaterial color={HIGHLIGHT} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {edge && (
        <Line
          points={[[edge[0].x, edge[0].y, edge[0].z], [edge[1].x, edge[1].y, edge[1].z]]}
          color={HIGHLIGHT} lineWidth={4} depthTest={false} renderOrder={3} raycast={noRaycast}
        />
      )}
    </>
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
