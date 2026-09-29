import { interpretProgram } from '../gcode/interpreter';
import type { Diagnostic } from '../gcode/types';
import type { WorkOffset } from '../job/types';

/** Interpreter errors in posted G-code; any error here is a post-processor bug. */
export function postedErrors(text: string, workOffset: WorkOffset): Diagnostic[] {
  return interpretProgram(text, { jobWorkOffset: workOffset }).diagnostics.filter((d) => d.severity === 'error');
}
