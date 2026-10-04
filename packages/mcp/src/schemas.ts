import { BUNDLED_FONT_IDS, TEXT_ANCHORS } from '@sponcam/core';
import { z } from 'zod';

export const vec3Schema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const vec3Partial = vec3Schema.partial();
export const lengthUnitSchema = z.enum(['mm', 'in']);
export const operationTypeSchema = z.enum(['profile', 'pocket', 'drill', 'face', 'chamfer', 'slot', 'engrave', 'vcarve', 'vclear', 'vplug', 'thread']);
export const dialectSchema = z.enum(['grbl', 'linuxcnc', 'fanuc']);
export const machinePresetSchema = z.enum(['Hobby GRBL router', 'Generic VMC']);
const delta = z.union([z.literal(-1), z.literal(1)]);

const meshFaceRef = z.strictObject({ kind: z.literal('meshFace'), blobId: z.string(), seed: z.number().int(), normal: vec3Schema, point: vec3Schema });
export const geometryRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dxfPath'), blobId: z.string(), layer: z.number().int(), path: z.number().int(), reverse: z.literal(true).optional() }),
  meshFaceRef,
  z.strictObject({ kind: z.literal('meshLoop'), face: meshFaceRef, loop: z.number().int() }),
  z.strictObject({ kind: z.literal('meshHole'), face: meshFaceRef, loop: z.number().int() }),
  z.strictObject({ kind: z.literal('meshBoss'), face: meshFaceRef }),
  z.strictObject({ kind: z.literal('meshSlot'), face: meshFaceRef, loop: z.number().int().optional() }),
  z.strictObject({ kind: z.literal('text'), textId: z.string() }),
]);

const heightFrom = z.enum(['stockTop', 'stockBottom', 'modelTop', 'modelBottom', 'contour', 'face', 'origin', 'holeBottom', 'slotBottom', 'retract', 'feed', 'top']);
const heightSpec = z.strictObject({ from: heightFrom, offset: z.number(), face: meshFaceRef.optional() });
const coolant = z.enum(['off', 'flood', 'mist']);
const lapPosition = z.strictObject({ refIndex: z.number().int(), t: z.number() });

const nonEmpty = <T extends string>(list: readonly T[]) => list as unknown as [T, ...T[]];
export const fontRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bundled'), id: z.enum(nonEmpty(BUNDLED_FONT_IDS)) }),
  z.strictObject({ kind: z.literal('file'), blobId: z.string(), name: z.string() }),
]);
export const textPatchSchema = z.strictObject({
  name: z.string().optional(),
  text: z.string().optional(),
  font: fontRefSchema.optional(),
  size: z.number().optional(),
  letterSpacing: z.number().optional(),
  lineSpacing: z.number().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  fit: z.strictObject({ width: z.number(), height: z.number().nullable() }).nullable().optional(),
  position: z.strictObject({ x: z.number(), y: z.number() }).optional(),
  anchor: z.enum(nonEmpty(TEXT_ANCHORS)).optional(),
  angle: z.number().optional(),
  mirror: z.boolean().optional(),
  arc: z.strictObject({ radius: z.number(), side: z.enum(['outside', 'inside']) }).nullable().optional(),
  surface: z.discriminatedUnion('from', [
    z.strictObject({ from: z.literal('stockTop') }),
    z.strictObject({ from: z.literal('face'), face: meshFaceRef }),
  ]).optional(),
});

export const operationPatchSchema = z.strictObject({
  name: z.string(),
  enabled: z.boolean(),
  toolId: z.string().nullable(),
  feeds: z.strictObject({ presetName: z.string().nullable(), rpm: z.number(), feed: z.number(), plungeFeed: z.number(), coolant }).partial(),
  heights: z.strictObject({ clearance: heightSpec, retract: heightSpec, feed: heightSpec, top: heightSpec, bottom: heightSpec }).partial(),
  geometry: z.array(geometryRefSchema),
  side: z.enum(['outside', 'inside', 'on', 'auto']),
  openSide: z.enum(['left', 'on', 'right']),
  direction: z.enum(['climb', 'conventional']),
  stepdown: z.number().nullable(),
  stockRadial: z.number(),
  stockAxial: z.number(),
  finishPass: z.boolean(),
  entry: z.strictObject({ mode: z.enum(['auto', 'helix', 'ramp', 'plunge']), helixDiameterPct: z.number(), rampAngleDeg: z.number() }).partial(),
  leads: z.strictObject({ mode: z.enum(['none', 'arc', 'line']), length: z.number(), startPoint: z.union([z.literal('auto'), lapPosition]) }).partial(),
  tabs: z.strictObject({
    enabled: z.boolean(), shape: z.enum(['rect', 'triangle']), width: z.number(), height: z.number(), placement: z.enum(['count', 'spacing']),
    count: z.number(), spacing: z.number(), positions: z.array(lapPosition).nullable(),
  }).partial(),
  stepoverPct: z.number(),
  finishWalls: z.boolean(),
  finishFloor: z.boolean(),
  area: z.enum(['stock', 'picked']),
  overlap: z.number(),
  pattern: z.enum(['zigzag', 'spiral']),
  angleDeg: z.number(),
  oneWay: z.boolean(),
  finishStepoverPct: z.number(),
  width: z.number(),
  tipOffset: z.number(),
  cycle: z.enum(['drill', 'dwell', 'peck', 'chipbreak']),
  peck: z.number(),
  dwellSeconds: z.number(),
  diameterFilter: z.strictObject({ min: z.number(), max: z.number() }).nullable(),
  strategy: z.enum(['auto', 'toolWidth', 'wider', 'trochoidal']),
  trochoidal: z.strictObject({ stepPct: z.number() }).partial(),
  squareEnds: z.enum(['inside', 'endWall', 'dogbone']).nullable(),
  depth: z.number(),
  depthMode: z.enum(['depth', 'width']),
  lineWidth: z.number(),
  maxDepth: z.number().nullable(),
  sourceId: z.string(),
  kind: z.enum(['internal', 'external']),
  thread: z.strictObject({
    standard: z.enum(['iso-coarse', 'iso-fine', 'unc', 'unf', 'custom']), size: z.string().nullable(),
    majorDiameter: z.number().optional(), pitch: z.number().optional(), angle: z.number().optional(),
  }),
  hand: z.enum(['right', 'left']),
  length: z.number(),
  allowance: z.number(),
  passes: z.number(),
  springPass: z.boolean(),
  feedCompensation: z.boolean(),
  inlayDepth: z.number(),
  startDepth: z.number(),
  glueGap: z.number(),
  inlay: z.strictObject({
    startDepth: z.number(), glueGap: z.number(), margin: z.number(),
    plugBoard: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }), plugFileName: z.string(),
  }).nullable(),
}).partial();

const presetSchema = z.strictObject({
  name: z.string(), rpm: z.number(), feed: z.number(), plungeFeed: z.number(), stepdown: z.number(), stepoverPct: z.number(), coolant,
});
export const toolSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  type: z.enum(['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer', 'threadmill']),
  number: z.number().int(),
  diameter: z.number(),
  cornerRadius: z.number(),
  tipAngleDeg: z.number(),
  fluteLength: z.number(),
  stickout: z.number(),
  flutes: z.number().int(),
  presets: z.array(presetSchema),
  thread: z.strictObject({ neckDiameter: z.number(), neckLength: z.number(), pitch: z.number().nullable(), teeth: z.number().int() }).optional(),
  vendor: z.string().optional(),
  productId: z.string().optional(),
});

const stockSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('auto'), margin: z.strictObject({ xy: z.number(), zTop: z.number(), zBottom: z.number() }) }),
  z.strictObject({ mode: z.literal('fixed'), size: vec3Schema, modelOffset: vec3Schema }),
]);
const wcsPatch = z.strictObject({
  anchor: z.strictObject({ x: z.enum(['min', 'center', 'max']), y: z.enum(['min', 'center', 'max']), z: z.enum(['top', 'bottom']) }),
  offset: vec3Schema,
  workOffset: z.enum(['G54', 'G55', 'G56', 'G57', 'G58', 'G59']),
}).partial();
const machinePatch = z.strictObject({ rapid: vec3Partial, accel: vec3Partial, maxFeed: z.number(), toolChangeSeconds: z.number() }).partial();
const postPatch = z.strictObject({
  dialect: dialectSchema, splitByTool: z.boolean(), decimals: z.number().int(), arcFormat: z.enum(['ij', 'r']), lineNumbers: z.boolean(),
  lineNumberStep: z.number().int(), coolant: z.boolean(), spindleDwell: z.number(), safeStart: z.string(), programNumber: z.number().int(),
  extension: z.enum(['nc', 'gcode', 'tap']),
}).partial();

export const jobCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('renameJob'), name: z.string() }),
  z.strictObject({ type: z.literal('setDisplayUnits'), unit: lengthUnitSchema }),
  z.strictObject({ type: z.literal('setImportUnits'), unit: lengthUnitSchema }),
  z.strictObject({ type: z.literal('rotateQuarter'), axis: z.enum(['x', 'y']), direction: delta }),
  z.strictObject({ type: z.literal('layFlat'), rawNormal: vec3Schema }),
  z.strictObject({ type: z.literal('setZSpin'), degrees: z.number() }),
  z.strictObject({ type: z.literal('resetOrientation') }),
  z.strictObject({ type: z.literal('setStock'), stock: stockSchema }),
  z.strictObject({ type: z.literal('setWcs'), patch: wcsPatch }),
  z.strictObject({ type: z.literal('setMachineProfile'), patch: machinePatch }),
  z.strictObject({ type: z.literal('applyMachinePreset'), name: machinePresetSchema }),
  z.strictObject({ type: z.literal('moveProgram'), id: z.string(), delta }),
  z.strictObject({ type: z.literal('setProgramInTimeline'), id: z.string(), inTimeline: z.boolean() }),
  z.strictObject({ type: z.literal('removeProgram'), id: z.string() }),
  z.strictObject({ type: z.literal('addOperation'), opType: operationTypeSchema, toolId: z.string().nullable(), id: z.string().optional(), name: z.string().optional() }),
  z.strictObject({ type: z.literal('updateOperation'), id: z.string(), patch: operationPatchSchema }),
  z.strictObject({ type: z.literal('removeOperation'), id: z.string() }),
  z.strictObject({ type: z.literal('duplicateOperation'), id: z.string(), newId: z.string().optional() }),
  z.strictObject({ type: z.literal('moveOperation'), id: z.string(), delta }),
  z.strictObject({ type: z.literal('setOperationEnabled'), id: z.string(), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('addText'), id: z.string().optional(), patch: textPatchSchema.optional() }),
  z.strictObject({ type: z.literal('updateText'), id: z.string(), patch: textPatchSchema }),
  z.strictObject({ type: z.literal('removeText'), id: z.string() }),
  z.strictObject({ type: z.literal('moveText'), id: z.string(), delta }),
  z.strictObject({ type: z.literal('addTool'), tool: toolSchema }),
  z.strictObject({ type: z.literal('updateTool'), id: z.string(), patch: toolSchema.omit({ id: true }).partial() }),
  z.strictObject({ type: z.literal('removeTool'), id: z.string() }),
  z.strictObject({ type: z.literal('setPost'), patch: postPatch }),
  z.strictObject({ type: z.literal('setTolerance'), tolerance: z.number() }),
]);
