import DxfParser from 'dxf-parser';
import type {
  IArcEntity, IDxf, IEntity, IInsertEntity, ILineEntity, ILwpolylineEntity, IPoint, IPolylineEntity,
} from 'dxf-parser';
import type { Path2D } from '../../geometry/path2d';
import type { LengthUnit } from '../../units/units';
import {
  AFFINE_IDENTITY, type Affine2D, affineMaxStretch, affineMultiply, affineRotate, affineScale, affineTranslate,
} from './affine2d';
import { ellipseToPath, splineToPath } from './curves';
import { arcToPath, circleToPath, lineToPath, polylineToPath, transformPath } from './entities';
import { type CircleData, type EllipseData, registerSponHandlers, type SplineData } from './handlers';

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
/** Upper bound on emitted segments plus expanded block entities, against INSERT fan-out ("billion laughs"). */
export const MAX_DXF_SEGMENTS = 2_000_000;

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
  /** Entities skipped for non-finite or non-positive values. */
  invalid: number;
  /** Work spent against MAX_DXF_SEGMENTS. */
  budgetUsed: number;
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

  const ctx: Context = { dxf, chordTol, layers: new Map(), nonZeroZ: 0, paperSpace: 0, invalid: 0, budgetUsed: 0, notes: new Set() };
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
  if (ctx.invalid) {
    warnings.push(`Skipped ${plural(ctx.invalid, 'entity', 'entities')} with invalid geometry (non-finite or non-positive values)`);
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
  ctx.notes.add(TILTED_NOTE);
  return AFFINE_IDENTITY;
}

const TILTED_NOTE = 'Some entities have a tilted extrusion direction and were projected to XY';

const hasZ = (...values: (number | undefined)[]) => values.some((v) => v !== undefined && Math.abs(v) > 1e-9);

/** True when every value is a finite number (missing values count as invalid). */
const finite = (...values: (number | undefined)[]) => values.every((v) => typeof v === 'number' && Number.isFinite(v));
const finitePoints = (points: readonly { x: number; y: number; z?: number }[]) => points.every((p) => finite(p.x, p.y) && (p.z === undefined || finite(p.z)));
const positive = (v: number | undefined) => finite(v) && (v as number) > 0;

function skipInvalid(ctx: Context): void {
  ctx.invalid++;
}

const budgetError = () => new DxfParseError(`DXF expands to more than ${MAX_DXF_SEGMENTS} segments (possibly malformed block references)`);

/** Spends `amount` of the MAX_DXF_SEGMENTS budget, throwing once it is exceeded. */
function spend(ctx: Context, amount: number): void {
  ctx.budgetUsed += amount;
  if (ctx.budgetUsed > MAX_DXF_SEGMENTS) throw budgetError();
}

function emit(ctx: Context, layerName: string, path: Path2D, m: Affine2D): void {
  if (path.segments.length === 0) return;
  const transformed = transformPath(path, m, ctx.chordTol);
  spend(ctx, transformed.segments.length);
  layerFor(ctx, layerName).paths.push(transformed);
}

function processEntity(ctx: Context, entity: IEntity, m: Affine2D, inheritedLayer: string | null, depth: number): void {
  const layer = effectiveLayer(entity, inheritedLayer);
  switch (entity.type) {
    case 'LINE': {
      const e = entity as ILineEntity;
      if (!e.vertices || e.vertices.length < 2) return;
      if (!finitePoints(e.vertices.slice(0, 2))) return skipInvalid(ctx);
      if (hasZ(e.vertices[0].z, e.vertices[1].z)) ctx.nonZeroZ++;
      emit(ctx, layer, lineToPath(e.vertices[0], e.vertices[1]), m);
      return;
    }
    case 'ARC': {
      const e = entity as IArcEntity;
      if (!e.center || !finitePoints([e.center]) || !positive(e.radius) || !finite(e.startAngle, e.endAngle)) return skipInvalid(ctx);
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, arcToPath(e.center, e.radius, e.startAngle, e.endAngle), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'CIRCLE': {
      const e = entity as unknown as CircleData; // produced by our handler in handlers.ts
      if (!finitePoints([e.center]) || !positive(e.radius)) return skipInvalid(ctx);
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, circleToPath(e.center, e.radius), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'LWPOLYLINE': {
      const e = entity as ILwpolylineEntity;
      if (!e.vertices || e.vertices.length < 2) return;
      if (!finitePoints(e.vertices) || !e.vertices.every((v) => v.bulge === undefined || finite(v.bulge))) return skipInvalid(ctx);
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
      if (!finitePoints(vertices) || !vertices.every((v) => v.bulge === undefined || finite(v.bulge))) return skipInvalid(ctx);
      if (hasZ(...vertices.map((v) => v.z))) ctx.nonZeroZ++;
      const transform = e.is3dPolyline ? m : affineMultiply(m, ocsTransform(ctx, e));
      emit(ctx, layer, polylineToPath(vertices, !!e.shape), transform);
      return;
    }
    case 'ELLIPSE': {
      const e = entity as unknown as EllipseData; // produced by our handler in handlers.ts
      const major = e.majorAxisEndPoint;
      if (!finitePoints([e.center, major]) || !positive(e.axisRatio) || !finite(e.startAngle, e.endAngle) || Math.hypot(major.x, major.y) === 0) {
        return skipInvalid(ctx);
      }
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      // centre and major axis are WCS; only the minor axis (extrusion × major) depends on the extrusion
      const ex = e.extrusionDirection;
      const alongZ = Math.abs(ex.x) < 1e-9 && Math.abs(ex.y) < 1e-9;
      if (!alongZ) ctx.notes.add(TILTED_NOTE);
      const tol = ctx.chordTol / affineMaxStretch(m);
      emit(ctx, layer, ellipseToPath(e.center, major, e.axisRatio, e.startAngle, e.endAngle, tol, alongZ && ex.z < 0), m);
      return;
    }
    case 'SPLINE': {
      const e = entity as unknown as SplineData; // produced by our handler in handlers.ts
      if (!finitePoints(e.controlPoints) || !finitePoints(e.fitPoints) || !finite(...e.knots, ...e.weights)) return skipInvalid(ctx);
      if (hasZ(...e.controlPoints.map((p) => p.z), ...e.fitPoints.map((p) => p.z))) ctx.nonZeroZ++;
      let weights: number[] | null = e.weights.length ? e.weights : null;
      if (weights && weights.length !== e.controlPoints.length) {
        ctx.notes.add('Some SPLINE weights did not match their control points and were ignored');
        weights = null;
      }
      const tol = ctx.chordTol / affineMaxStretch(m);
      const { path, note } = splineToPath(e.degree, e.knots, e.controlPoints, e.fitPoints, tol, weights);
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
      const numbers = [e.xScale, e.yScale, e.rotation, e.rowCount, e.columnCount, e.rowSpacing, e.columnSpacing];
      if ((e.position && !finitePoints([e.position])) || !finite(...numbers.filter((v) => v !== undefined))) return skipInvalid(ctx);
      if (hasZ(e.position?.z)) ctx.nonZeroZ++;
      const base = block.position ?? { x: 0, y: 0, z: 0 };
      const outer = affineMultiply(m, ocsTransform(ctx, e));
      const rotation = ((e.rotation ?? 0) * Math.PI) / 180;
      const rows = Math.max(1, e.rowCount ?? 1);
      const cols = Math.max(1, e.columnCount ?? 1);
      const children = block.entities ?? [];
      // every expanded child costs at least one unit, so empty or unsupported leaves cannot fan out for free
      spend(ctx, rows * cols * children.length);
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
          for (const child of children) processEntity(ctx, child, world, layer, depth + 1);
        }
      }
      return;
    }
    default:
      return; // unsupported types are reported from the raw entity counts
  }
}
