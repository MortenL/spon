import { bboxSize, type ParsedProgram, type ProgramRef } from '@sponcam/core';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { splitVertex, usePlaybackCursor, useTimeline } from '@/gcode/playback';
import { buildToolpathBuffers } from '@/gcode/toolpath';
import { programOrigin } from '@/state/programContext';
import { useStockBox } from '@/state/selectors';
import { useApp } from '@/state/store';
import { noRaycast } from './SceneObjects';

export function Toolpaths() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const data = useApp((s) => s.programData);
  const showRapids = useApp((s) => s.visibility.rapids);
  const origin = useMemo(() => programOrigin(job, geometry), [job, geometry]);
  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {job.programs.map((p) => {
        const parsed = data[p.blobId]?.parsed;
        return parsed ? <ProgramToolpath key={p.id} program={p} parsed={parsed} showRapids={showRapids} /> : null;
      })}
      <ToolMarker />
    </group>
  );
}

function ProgramToolpath({ program, parsed, showRapids }: { program: ProgramRef; parsed: ParsedProgram; showRapids: boolean }) {
  const buffers = useMemo(() => buildToolpathBuffers(parsed.table, { showRapids }), [parsed.table, showRapids]);
  // two geometries share the same attributes (one GPU upload); each has its own draw range
  const [done, todo] = useMemo(() => {
    const position = new THREE.BufferAttribute(buffers.positions, 3);
    const color = new THREE.BufferAttribute(buffers.colors, 3);
    const make = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('color', color);
      g.computeBoundingSphere();
      return g;
    };
    return [make(), make()];
  }, [buffers]);
  // both are disposed together, so the shared attributes are released exactly when neither is drawn any more
  useEffect(() => () => {
    done.dispose();
    todo.dispose();
  }, [done, todo]);

  const tl = useTimeline();
  const entry = tl.entries.find((e) => e.programId === program.id);
  const split = useApp((s) => splitVertex(entry, s.playhead, parsed.table, buffers.rowVertexEnd));
  done.setDrawRange(0, split);
  todo.setDrawRange(split, Infinity);

  return (
    <>
      <lineSegments geometry={done} raycast={noRaycast}>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      <lineSegments geometry={todo} raycast={noRaycast}>
        <lineBasicMaterial vertexColors transparent opacity={program.inTimeline ? 0.35 : 0.15} depthWrite={false} />
      </lineSegments>
    </>
  );
}

function ToolMarker() {
  const cursor = usePlaybackCursor();
  const stock = useStockBox();
  if (!cursor) return null;
  const size = stock ? Math.max(4, 0.08 * Math.max(...Object.values(bboxSize(stock)))) : 6;
  const [x, y, z] = cursor.position;
  return (
    // cones point up (+Y) by default; rotate so the tip points down and sits on the tool position
    <mesh position={[x, y, z + size / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={3}>
      <coneGeometry args={[size / 4, size, 20]} />
      <meshStandardMaterial color="#f5f5f4" emissive="#57534e" />
    </mesh>
  );
}
