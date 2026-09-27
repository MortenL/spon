import type DxfParser from 'dxf-parser';

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** One group-code/value pair as delivered by dxf-parser's scanner (values are already typed by group code). */
export interface DxfGroup {
  code: number;
  value: string | number | boolean;
}

interface DxfScanner {
  next(): DxfGroup;
  isEOF(): boolean;
}

type HandlerClass = Parameters<DxfParser['registerEntityHandler']>[0];

interface CommonData {
  type: string;
  layer: string;
  inPaperSpace: boolean;
}

/** Builds a dxf-parser entity handler that passes every group of one entity to `read`. */
export function entityHandler<T extends CommonData>(name: string, create: () => T, read: (entity: T, group: DxfGroup) => void): HandlerClass {
  class Handler {
    ForEntityName = name;
    parseEntity(scanner: DxfScanner): T {
      const entity = create();
      let group = scanner.next();
      while (!scanner.isEOF() && group.code !== 0) {
        if (group.code === 8) entity.layer = String(group.value);
        else if (group.code === 67) entity.inPaperSpace = group.value !== 0;
        else read(entity, group);
        group = scanner.next();
      }
      return entity; // the scanner is left on the next code-0 group, as dxf-parser expects
    }
  }
  return Handler as unknown as HandlerClass;
}

const num = (group: DxfGroup) => Number(group.value);

export interface CircleData extends CommonData {
  type: 'CIRCLE';
  center: XYZ;
  radius: number;
  extrusionDirection: XYZ;
}

const CircleHandler = entityHandler<CircleData>(
  'CIRCLE',
  () => ({ type: 'CIRCLE', layer: '0', inPaperSpace: false, center: { x: 0, y: 0, z: 0 }, radius: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }),
  (e, g) => {
    switch (g.code) {
      case 10: e.center.x = num(g); break;
      case 20: e.center.y = num(g); break;
      case 30: e.center.z = num(g); break;
      case 40: e.radius = num(g); break;
      case 210: e.extrusionDirection.x = num(g); break;
      case 220: e.extrusionDirection.y = num(g); break;
      case 230: e.extrusionDirection.z = num(g); break;
    }
  },
);

/** Replaces dxf-parser handlers that drop data Spon needs. */
export function registerSponHandlers(parser: DxfParser): void {
  parser.registerEntityHandler(CircleHandler);
}
