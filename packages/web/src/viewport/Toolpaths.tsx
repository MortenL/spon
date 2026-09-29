import { bboxSize, type MotionTable, type ParsedProgram, type ProgramRef } from '@sponcam/core';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { splitVertex, usePlaybackCursor, useTimeline } from '@/gcode/playback';
import { buildToolpathBuffers, toolpathGeometryKey } from '@/gcode/toolpath';
import type { CamFile } from '@/state/camTypes';
import { programOrigin } from '@/state/programContext';
import { allPrograms } from '@/state/programList';
import { useStockBox } from '@/state/selectors';
import { useApp } from '@/state/store';
import { noRaycast } from './SceneObjects';

export function Toolpaths() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const data = useApp((s) => s.programData);
  const showRapids = useApp((s) => s.visibility.rapids);
  const programs = useApp((s) => allPrograms(s));
  const selectedOperationId = useApp((s) => s.selectedOperationId);
  const camFiles = useApp((s) => s.camFiles);
  const camStatus = useApp((s) => s.camStatus);
  const origin = useMemo(() => programOrigin(job, geometry), [job, geometry]);
  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {programs.map((p) => {
        const parsed = data[p.blobId]?.parsed;
        return parsed ? (
          <ProgramToolpath
            key={p.id} program={p} parsed={parsed} showRapids={showRapids}
            selectedOperationId={selectedOperationId} camFiles={camFiles} camStatus={camStatus}
          />
        ) : null;
      })}
      <ToolMarker />
    </group>
  );
}

/** Vertex rows whose posted line falls inside [firstLine, lastLine], as a contiguous [r0, r1] row range (inclusive), or null if none. */
function sectionRowRange(table: MotionTable, firstLine: number, lastLine: number): [number, number] | null {
  let r0 = -1;
  let r1 = -1;
  for (let i = 0; i < table.count; i++) {
    const line = table.line[i];
    if (line >= firstLine && line <= lastLine) {
      if (r0 < 0) r0 = i;
      r1 = i;
    }
  }
  return r0 < 0 ? null : [r0, r1];
}

/** Geometries whose dashed "lineDistance" attribute has already been computed (computed once, lazily, per geometry). */
const dashedReady = new WeakSet<THREE.BufferGeometry>();
function ensureLineDistances(g: THREE.BufferGeometry): void {
  if (!dashedReady.has(g)) {
    // computeLineDistances() lives on THREE.Line, not BufferGeometry; a throwaway Line (never added to the scene)
    // is enough to compute and attach the "lineDistance" attribute this geometry needs for lineDashedMaterial.
    new THREE.Line(g).computeLineDistances();
    dashedReady.add(g);
  }
}

function ProgramToolpath({
  program, parsed, showRapids, selectedOperationId, camFiles, camStatus,
}: {
  program: ProgramRef; parsed: ParsedProgram; showRapids: boolean;
  selectedOperationId: string | null; camFiles: readonly CamFile[]; camStatus: 'idle' | 'generating';
}) {
  // keyed on the geometry buildToolpathBuffers actually reads, not on `parsed.table` itself:
  // reanalyzeAll replaces the table wrapper (a new `t` for timing) on every re-analysis while
  // reusing these arrays, so keying on `parsed.table` would rebuild and re-upload every buffer then.
  const geometryKey = toolpathGeometryKey(parsed.table);
  const buffers = useMemo(() => buildToolpathBuffers(parsed.table, { showRapids }), [...geometryKey, showRapids]);
  // three geometries share the same attributes (one GPU upload); each has its own draw range
  const [done, todo, selected] = useMemo(() => {
    const position = new THREE.BufferAttribute(buffers.positions, 3);
    const color = new THREE.BufferAttribute(buffers.colors, 3);
    const make = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('color', color);
      g.computeBoundingSphere();
      return g;
    };
    return [make(), make(), make()];
  }, [buffers]);
  // all three are disposed together, so the shared attributes are released exactly when none is drawn any more
  useEffect(() => () => {
    done.dispose();
    todo.dispose();
    selected.dispose();
  }, [done, todo, selected]);

  const tl = useTimeline();
  const entry = tl.entries.find((e) => e.programId === program.id);
  const split = useApp((s) => splitVertex(entry, s.playhead, parsed.table, buffers.rowVertexEnd));
  done.setDrawRange(0, split);
  todo.setDrawRange(split, Infinity);

  // the selected operation's own rows, drawn again on top at full strength; memoised so a playback
  // frame (which re-renders this component every frame via the playhead-keyed `split` above) doesn't
  // redo the O(table.count) row scan when none of these actually changed.
  const section = useMemo(
    () => (selectedOperationId ? camFiles.find((f) => f.blobId === program.blobId)?.sections.find((s) => s.operationId === selectedOperationId) ?? null : null),
    [selectedOperationId, camFiles, program.blobId],
  );
  const selRange = useMemo(() => {
    if (!section) return null;
    const rows = sectionRowRange(parsed.table, section.firstLine, section.lastLine);
    if (!rows) return null;
    const start = rows[0] > 0 ? buffers.rowVertexEnd[rows[0] - 1] : 0;
    return { start, count: buffers.rowVertexEnd[rows[1]] - start };
  }, [section, parsed.table, buffers.rowVertexEnd]);
  selected.setDrawRange(selRange?.start ?? 0, selRange?.count ?? 0);

  const isGenerated = program.source === 'generated';
  const dim = selectedOperationId !== null && isGenerated;
  const dashed = camStatus === 'generating' && isGenerated;
  const doneOpacity = dim ? 0.3 : 1;
  const todoOpacity = dim ? 0.3 : program.inTimeline ? 0.35 : 0.15;

  useEffect(() => {
    if (!dashed) return;
    ensureLineDistances(done);
    ensureLineDistances(todo);
    ensureLineDistances(selected);
  }, [dashed, done, todo, selected]);

  return (
    <>
      <lineSegments geometry={done} raycast={noRaycast}>
        {dashed
          ? <lineDashedMaterial vertexColors transparent={dim} opacity={doneOpacity} dashSize={2} gapSize={1.5} />
          : <lineBasicMaterial vertexColors transparent={dim} opacity={doneOpacity} />}
      </lineSegments>
      <lineSegments geometry={todo} raycast={noRaycast}>
        {dashed
          ? <lineDashedMaterial vertexColors transparent opacity={todoOpacity} depthWrite={false} dashSize={2} gapSize={1.5} />
          : <lineBasicMaterial vertexColors transparent opacity={todoOpacity} depthWrite={false} />}
      </lineSegments>
      <lineSegments geometry={selected} raycast={noRaycast} renderOrder={1}>
        <lineBasicMaterial vertexColors depthTest={false} />
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
