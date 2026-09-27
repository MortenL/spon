import DxfParser from 'dxf-parser';
import type {
  IArcEntity, IDxf, IEllipseEntity, IEntity, IInsertEntity, ILineEntity, ILwpolylineEntity, IPoint, IPolylineEntity,
} from 'dxf-parser';
import type { Path2D } from '../../geometry/path2d';
import type { LengthUnit } from '../../units/units';
import {
  AFFINE_IDENTITY, type Affine2D, affineMultiply, affineRotate, affineScale, affineTranslate,
} from './affine2d';
import { ellipseToPath, splineToPath } from './curves';
import { arcToPath, circleToPath, lineToPath, polylineToPath, transformPath } from './entities';
import { type CircleData, registerSponHandlers, type SplineData } from './handlers';

export interface DrawingLayer {
  name: string;
  /** 0xRRGGBB from the layer table; 0xFFFFFF when unknown. */
  color: number;
  paths: Path2D[];
}

export interface Drawing {
  layers: DrawingLayer[];
}

export interface DxfImport {
  drawing: Drawing;
  detectedUnits: LengthUnit | null;
  warnings: string[];
}

export class DxfParseError extends Error {
  override name = 'DxfParseError';
}

export const SUPPORTED_DXF_ENTITIES: ReadonlySet<string> = new Set([
  'LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE', 'INSERT',
]);
const SUB_ENTITIES: ReadonlySet<string> = new Set(['VERTEX', 'SEQEND', 'ATTRIB']);
export const DEFAULT_CHORD_TOLERANCE = 0.01;
const MAX_BLOCK_DEPTH = 16;

/** Any entity that may carry an extrusion direction, in either of dxf-parser's two spellings. */
type ExtrudedEntity = {
  extrusionDirection?: IPoint;
  extrusionDirectionX?: number;
  extrusionDirectionY?: number;
  extrusionDirectionZ?: number;
};

interface Context {
  dxf: IDxf;
  chordTol: number;
  layers: Map<string, DrawingLayer>;
  nonZeroZ: number;
  paperSpace: number;
  notes: Set<string>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Counts top-level entity types in the ENTITIES section straight from the text (dxf-parser drops unknown types). */
export function countEntityTypes(text: string): Map<string, number> {
  const lines = text.split(/\r?\n/);
  const counts = new Map<string, number>();
  let inEntities = false;
  let sectionStart = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1].trim();
    if (code === '0') {
      sectionStart = value === 'SECTION';
      if (value === 'ENDSEC') inEntities = false;
      else if (inEntities && !SUB_ENTITIES.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
    } else if (code === '2' && sectionStart) {
      inEntities = value === 'ENTITIES';
      sectionStart = false;
    }
  }
  return counts;
}

export function parseDxf(text: string, chordTol = DEFAULT_CHORD_TOLERANCE): DxfImport {
  let dxf: IDxf | null;
  try {
    const parser = new DxfParser();
    registerSponHandlers(parser);
    dxf = parser.parseSync(text);
  } catch (err) {
    throw new DxfParseError(`Could not parse DXF: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!dxf) throw new DxfParseError('Could not parse DXF');

  const ctx: Context = { dxf, chordTol, layers: new Map(), nonZeroZ: 0, paperSpace: 0, notes: new Set() };
  for (const entity of dxf.entities ?? []) {
    if (entity.inPaperSpace) {
      ctx.paperSpace++;
      continue;
    }
    processEntity(ctx, entity, AFFINE_IDENTITY, null, 0);
  }

  const layers = [...ctx.layers.values()].filter((l) => l.paths.length > 0);
  if (layers.length === 0) {
    throw new DxfParseError('DXF contains no supported geometry (lines, arcs, circles, polylines, splines or ellipses)');
  }
  return { drawing: { layers }, detectedUnits: detectUnits(dxf), warnings: buildWarnings(ctx, countEntityTypes(text)) };
}

function detectUnits(dxf: IDxf): LengthUnit | null {
  const value = dxf.header?.['$INSUNITS'];
  return value === 1 ? 'in' : value === 4 ? 'mm' : null;
}

function buildWarnings(ctx: Context, counts: Map<string, number>): string[] {
  const warnings: string[] = [];
  const skipped = [...counts].filter(([type]) => !SUPPORTED_DXF_ENTITIES.has(type));
  if (skipped.length) {
    const total = skipped.reduce((sum, [, n]) => sum + n, 0);
    const detail = skipped.map(([type, n]) => `${type} ×${n}`).join(', ');
    warnings.push(`Skipped ${plural(total, 'unsupported entity', 'unsupported entities')}: ${detail}`);
  }
  if (ctx.paperSpace) warnings.push(`Ignored ${plural(ctx.paperSpace, 'paper-space entity', 'paper-space entities')}`);
  if (ctx.nonZeroZ) {
    warnings.push(`${plural(ctx.nonZeroZ, 'entity', 'entities')} had non-zero Z and ${ctx.nonZeroZ === 1 ? 'was' : 'were'} projected to XY`);
  }
  warnings.push(...ctx.notes);
  return warnings;
}

function layerFor(ctx: Context, name: string): DrawingLayer {
  let layer = ctx.layers.get(name);
  if (!layer) {
    layer = { name, color: ctx.dxf.tables?.layer?.layers?.[name]?.color ?? 0xffffff, paths: [] };
    ctx.layers.set(name, layer);
  }
  return layer;
}

/** Entities on layer "0" inside a block take the layer of the INSERT that placed them. */
function effectiveLayer(entity: IEntity, inherited: string | null): string {
  const own = entity.layer || '0';
  return own === '0' && inherited ? inherited : own;
}

/** Object Coordinate System handling for planar entities (ARC, CIRCLE, LWPOLYLINE, 2D POLYLINE, INSERT). */
function ocsTransform(ctx: Context, entity: ExtrudedEntity): Affine2D {
  const ex = entity.extrusionDirection
    ?? (entity.extrusionDirectionZ !== undefined
      ? { x: entity.extrusionDirectionX ?? 0, y: entity.extrusionDirectionY ?? 0, z: entity.extrusionDirectionZ }
      : null);
  if (!ex) return AFFINE_IDENTITY;
  const alongZ = Math.abs(ex.x) < 1e-9 && Math.abs(ex.y) < 1e-9;
  if (alongZ && ex.z > 0) return AFFINE_IDENTITY;
  if (alongZ && ex.z < 0) return affineScale(-1, 1);
  ctx.notes.add('Some entities have a tilted extrusion direction and were projected to XY');
  return AFFINE_IDENTITY;
}

const hasZ = (...values: (number | undefined)[]) => values.some((v) => v !== undefined && Math.abs(v) > 1e-9);

function emit(ctx: Context, layerName: string, path: Path2D, m: Affine2D): void {
  if (path.segments.length === 0) return;
  layerFor(ctx, layerName).paths.push(transformPath(path, m, ctx.chordTol));
}

function processEntity(ctx: Context, entity: IEntity, m: Affine2D, inheritedLayer: string | null, depth: number): void {
  const layer = effectiveLayer(entity, inheritedLayer);
  switch (entity.type) {
    case 'LINE': {
      const e = entity as ILineEntity;
      if (!e.vertices || e.vertices.length < 2) return;
      if (hasZ(e.vertices[0].z, e.vertices[1].z)) ctx.nonZeroZ++;
      emit(ctx, layer, lineToPath(e.vertices[0], e.vertices[1]), m);
      return;
    }
    case 'ARC': {
      const e = entity as IArcEntity;
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, arcToPath(e.center, e.radius, e.startAngle, e.endAngle), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'CIRCLE': {
      const e = entity as unknown as CircleData; // produced by our handler in handlers.ts
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, circleToPath(e.center, e.radius), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'LWPOLYLINE': {
      const e = entity as ILwpolylineEntity;
      if (!e.vertices || e.vertices.length < 2) return;
      if (hasZ(e.elevation)) ctx.nonZeroZ++;
      emit(ctx, layer, polylineToPath(e.vertices, !!e.shape), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'POLYLINE': {
      const e = entity as IPolylineEntity;
      if (e.is3dPolygonMesh || e.isPolyfaceMesh) {
        ctx.notes.add('Polygon and polyface mesh POLYLINEs are not supported and were skipped');
        return;
      }
      const vertices = (e.vertices ?? []).filter((v) => !v.splineControlPoint);
      if (vertices.length < 2) return;
      if (hasZ(...vertices.map((v) => v.z))) ctx.nonZeroZ++;
      const transform = e.is3dPolyline ? m : affineMultiply(m, ocsTransform(ctx, e));
      emit(ctx, layer, polylineToPath(vertices, !!e.shape), transform);
      return;
    }
    case 'ELLIPSE': {
      const e = entity as IEllipseEntity;
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, ellipseToPath(e.center, e.majorAxisEndPoint, e.axisRatio, e.startAngle ?? 0, e.endAngle ?? 2 * Math.PI, ctx.chordTol), m);
      return;
    }
    case 'SPLINE': {
      const e = entity as unknown as SplineData; // produced by our handler in handlers.ts
      if (hasZ(...e.controlPoints.map((p) => p.z), ...e.fitPoints.map((p) => p.z))) ctx.nonZeroZ++;
      let weights: number[] | null = e.weights.length ? e.weights : null;
      if (weights && weights.length !== e.controlPoints.length) {
        ctx.notes.add('Some SPLINE weights did not match their control points and were ignored');
        weights = null;
      }
      const { path, note } = splineToPath(e.degree, e.knots, e.controlPoints, e.fitPoints, ctx.chordTol, weights);
      if (note) ctx.notes.add(note);
      if (path) emit(ctx, layer, path, m);
      return;
    }
    case 'INSERT': {
      const e = entity as IInsertEntity;
      const block = ctx.dxf.blocks?.[e.name];
      if (!block) {
        ctx.notes.add(`Block "${e.name}" is referenced but not defined`);
        return;
      }
      if (depth >= MAX_BLOCK_DEPTH) {
        ctx.notes.add('Blocks are nested too deeply (possibly recursive); some were ignored');
        return;
      }
      if (hasZ(e.position?.z)) ctx.nonZeroZ++;
      const base = block.position ?? { x: 0, y: 0, z: 0 };
      const outer = affineMultiply(m, ocsTransform(ctx, e));
      const rotation = ((e.rotation ?? 0) * Math.PI) / 180;
      const rows = Math.max(1, e.rowCount ?? 1);
      const cols = Math.max(1, e.columnCount ?? 1);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const local = [
            affineTranslate(e.position?.x ?? 0, e.position?.y ?? 0),
            affineRotate(rotation),
            affineTranslate(col * (e.columnSpacing ?? 0), row * (e.rowSpacing ?? 0)),
            affineScale(e.xScale ?? 1, e.yScale ?? 1),
            affineTranslate(-base.x, -base.y),
          ].reduce((acc, next) => affineMultiply(acc, next));
          const world = affineMultiply(outer, local);
          for (const child of block.entities ?? []) processEntity(ctx, child, world, layer, depth + 1);
        }
      }
      return;
    }
    default:
      return; // unsupported types are reported from the raw entity counts
  }
}
