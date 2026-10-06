import {
  alignEdgeToX, camContext, describeGeometry, faceRefFromTriangle, firstPickLength, faceRegion, type LengthUnit, layFlat, nearestTriangleEdge, regionNormal, resolveFaceRef, unitScale, type Vec3,
} from '@sponcam/core';
import { Edges, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as THREE from 'three';
import { runCommand } from '@/state/camView';
import { usePlacement } from '@/state/selectors';
import { appStore, type ModelGeometry, useApp } from '@/state/store';
import { applyPick, pickMesh } from './camPick';
import { layerLinePositions, lineColor, meshToGeometry, subsetGeometry, toThreeQuaternion } from './convert';
import { noRaycast } from './SceneObjects';
import { hitsTab } from './tabPath';

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
  const camPick = useApp((s) => s.camPick);
  const textPick = useApp((s) => s.textPick);
  const picking = camPick !== null || textPick !== null;
  const buffer = useMemo(() => meshToGeometry(geometry.mesh), [geometry.mesh]);
  useEffect(() => () => buffer.dispose(), [buffer]);

  const [region, setRegion] = useState<number[] | null>(null);
  const [edge, setEdge] = useState<[Vec3, Vec3] | null>(null);
  const highlight = useMemo(() => (region ? subsetGeometry(geometry.mesh, region) : null), [region, geometry.mesh]);
  useEffect(() => () => highlight?.dispose(), [highlight]);
  useEffect(() => {
    setRegion(null);
    setEdge(null);
  }, [pickMode, camPick, textPick]);

  // 0.01 mm plane tolerance, expressed in the mesh's raw units
  const regionAt = (tri: number) => faceRegion(geometry.mesh, geometry.adjacency, tri, { distanceTol: 0.01 / unitScale(importUnits) });
  const edgeAt = (e: ThreeEvent<PointerEvent | MouseEvent>, tri: number): [Vec3, Vec3] => {
    const local = e.object.worldToLocal(e.point.clone()); // mesh-local = raw model coordinates
    return nearestTriangleEdge(geometry.mesh, tri, { x: local.x, y: local.y, z: local.z });
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if ((pickMode === 'none' && !picking) || e.faceIndex == null) return;
    e.stopPropagation();
    if (pickMode === 'face' || (pickMode === 'none' && picking)) {
      if (!region?.includes(e.faceIndex)) setRegion(regionAt(e.faceIndex));
    } else {
      setEdge(edgeAt(e, e.faceIndex));
    }
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if ((pickMode === 'none' && !picking) || e.faceIndex == null || e.delta > 4) return; // ignore the end of an orbit drag
    if (hitsTab(e)) return; // a tab handle or path under the pointer takes the click
    e.stopPropagation();
    const { commit, setPickMode, requestView, job, setCamPick, setTextPick } = appStore.getState();
    if (pickMode === 'face') {
      const tris = region?.includes(e.faceIndex) ? region : regionAt(e.faceIndex);
      const normal = regionNormal(geometry.mesh, tris);
      commit((j) => layFlat(j, normal));
      requestView('fit');
      setPickMode('none');
    } else if (pickMode === 'edge') {
      const [a, b] = edgeAt(e, e.faceIndex);
      commit((j) => alignEdgeToX(j, a, b));
      setPickMode('none');
    } else if (textPick) {
      const model = job.model;
      if (!model) return;
      const face = faceRefFromTriangle(geometry.mesh, model.blobId, e.faceIndex);
      const res = resolveFaceRef(camContext(job, geometry), face);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (runCommand({ type: 'updateText', id: textPick, patch: { surface: { from: 'face', face } } })) setTextPick(null);
    } else if (camPick) {
      const op = job.operations.find((o) => o.id === camPick.operationId);
      if (!op) {
        setCamPick(null);
        return;
      }
      const ctx = camContext(job, geometry);
      const world = e.point; // scene coordinates
      const q = { x: world.x - ctx.origin.x, y: world.y - ctx.origin.y };
      const forHeight = camPick.target !== 'geometry';
      const res = pickMesh(op, ctx, e.faceIndex, q, !forHeight && e.altKey);
      if ('error' in res) {
        toast.error(res.error);
        return;
      }
      if (camPick.target === 'geometry') {
        const geometryRefs = applyPick(op, res.refs);
        runCommand({ type: 'updateOperation', id: op.id, patch: { geometry: geometryRefs, ...firstPickLength(op, describeGeometry(job, geometry), geometryRefs) } });
        return;
      }
      const face = res.refs[0];
      if (face.kind !== 'meshFace') return; // pickMesh always returns a face when alt is forced off
      const name = camPick.target.height;
      if (runCommand({ type: 'updateOperation', id: op.id, patch: { heights: { [name]: { from: 'face', offset: op.heights[name].offset, face } } } })) {
        setCamPick(null);
      }
    }
  };

  return (
    <>
      <mesh
        geometry={buffer} onPointerMove={onPointerMove} onClick={onClick} onPointerOut={() => { setRegion(null); setEdge(null); }}
        // a full-mesh raycast on every pointer move is only worth it while picking a face, edge or CAM reference
        raycast={pickMode === 'none' && !picking ? noRaycast : THREE.Mesh.prototype.raycast}
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
