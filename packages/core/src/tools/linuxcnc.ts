import type { LengthUnit } from '../units/units';
import { mergeToolLibrary, parseToolLibraryFile, sortTools, type ToolLibraryMerge } from './library';
import type { Tool, ToolType } from './types';

export interface ToolTableImport { tools: Tool[]; skipped: { line: number; reason: string }[]; guesses: string[] }
export interface ToolFileImport extends ToolLibraryMerge { skipped: { name: string; reason: string }[] }

export const isToolTableFile = (fileName: string): boolean => fileName.toLowerCase().endsWith('.tbl');

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const trimNumber = (n: number) => String(Number(n.toFixed(4)));

function words(body: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of body.matchAll(new RegExp(String.raw`([A-Za-z])\s*(${NUM})`, 'g'))) {
    const letter = m[1].toUpperCase();
    if (!out.has(letter)) out.set(letter, Number(m[2]));
  }
  return out;
}

/** Tool type from comment keywords; `scale` converts lengths written in the comment (R…) to mm. */
function guessType(comment: string, diameter: number, scale: number): { type: ToolType; cornerRadius: number; tipAngleDeg: number; matched: boolean } {
  // Whitespace runs collapse to one space and numbers only start after a non-digit, so the patterns below run in linear time.
  const c = comment.toLowerCase().replace(/\s+/g, ' ');
  const angle = (fallback: number) => {
    const m = /(?<![\d.])(\d+(?:\.\d+)?) ?(?:°|deg)/.exec(c) ?? /\bv ?-? ?(\d+(?:\.\d+)?)\b/.exec(c);
    return m ? Number(m[1]) : fallback;
  };
  if (/drill|bohr/.test(c)) return { type: 'drill', cornerRadius: 0, tipAngleDeg: 118, matched: true };
  if (/chamfer|fase/.test(c)) return { type: 'chamfer', cornerRadius: 0, tipAngleDeg: angle(90), matched: true };
  if (/v-?bit|engrav/.test(c) || /\bv ?-? ?\d/.test(c) || /\d ?°/.test(c)) return { type: 'vbit', cornerRadius: 0, tipAngleDeg: angle(60), matched: true };
  if (/ball/.test(c)) return { type: 'ball', cornerRadius: diameter / 2, tipAngleDeg: 0, matched: true };
  const r = /\br ?(\d+(?:\.\d+)?)\b/.exec(c);
  if (/bull/.test(c) || r) {
    const radius = r ? Math.min(Number(r[1]) * scale, diameter / 2) : diameter / 10;
    return { type: 'bull', cornerRadius: radius, tipAngleDeg: 0, matched: true };
  }
  return { type: 'flat', cornerRadius: 0, tipAngleDeg: 0, matched: false };
}

/** Parses a LinuxCNC tool table (T, P, D, offsets, ;comment per line). `units` is the machine's length unit. */
export function parseLinuxCncToolTable(text: string, units: LengthUnit): ToolTableImport {
  const scale = units === 'in' ? 25.4 : 1;
  const tools: Tool[] = [];
  const skipped: ToolTableImport['skipped'] = [];
  const guesses: string[] = [];
  const seen = new Set<number>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const semi = raw.indexOf(';');
    const body = (semi < 0 ? raw : raw.slice(0, semi)).trim();
    const comment = semi < 0 ? '' : raw.slice(semi + 1).trim();
    if (!body) return;
    const w = words(body);
    const t = w.get('T');
    const d = w.get('D');
    if (t === undefined || !Number.isInteger(t) || t < 0) return void skipped.push({ line, reason: 'no tool number (T)' });
    if (d === undefined) return void skipped.push({ line, reason: 'no diameter (D)' });
    if (!(d > 0)) return void skipped.push({ line, reason: 'the diameter must be greater than 0' });
    if (seen.has(t)) return void skipped.push({ line, reason: `T${t} appears again; the first line was used` });
    seen.add(t);
    const diameter = d * scale;
    const name = comment || `T${t} ⌀${trimNumber(d)}`;
    const g = guessType(comment, diameter, scale);
    if (g.matched) guesses.push(`T${t} ${name}: ${g.type} (from the comment)`);
    tools.push({
      id: `linuxcnc-T${t}`, name, type: g.type, number: t, diameter, cornerRadius: g.cornerRadius, tipAngleDeg: g.tipAngleDeg,
      fluteLength: 3 * diameter, stickout: 4 * diameter, flutes: 2, presets: [],
    });
  });
  if (!tools.length) throw new Error('No tools found in this tool table');
  return { tools, skipped, guesses };
}

/** Inches when every diameter is under 1 (a 1 mm tool table entry is rare; a 1 inch one is too). */
export function suggestToolTableUnits(text: string): LengthUnit {
  const ds = [...text.matchAll(new RegExp(String.raw`(?:^|\s)[dD]\s*(${NUM})`, 'gm'))].map((m) => Number(m[1])).filter((d) => d > 0);
  return ds.length && ds.every((d) => d < 1) ? 'in' : 'mm';
}

/** The table's T numbers win (they must match the machine); a different library tool holding one moves to the next free number. */
export function mergeToolTable(existing: readonly Tool[], imported: readonly Tool[]): ToolLibraryMerge {
  const importedIds = new Set(imported.map((t) => t.id));
  const existingIds = new Set(existing.map((t) => t.id));
  const tableNumbers = new Set(imported.map((t) => t.number));
  const others = existing.filter((t) => !importedIds.has(t.id));
  const taken = new Set([...tableNumbers, ...others.map((t) => t.number)]);
  const notes: string[] = [];
  const moved: Tool[] = [];
  for (const t of others) {
    if (!tableNumbers.has(t.number)) continue;
    let n = t.number;
    while (taken.has(n)) n++;
    taken.add(n);
    notes.push(`${t.name} moved from T${t.number} to T${n}`);
    moved.push({ ...t, number: n });
  }
  const incoming = [...imported, ...moved];
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  const updated = imported.filter((t) => existingIds.has(t.id)).length;
  return { incoming, library: sortTools([...byId.values()]), added: imported.length - updated, updated, notes };
}

/** One entry point for every tool library file: Spon/Fusion libraries, or a LinuxCNC tool table (needs units). */
export function importToolFile(existing: readonly Tool[], bytes: Uint8Array, fileName: string, units?: LengthUnit): ToolFileImport {
  if (isToolTableFile(fileName)) {
    if (!units) throw new Error('A LinuxCNC tool table has no units');
    const table = parseLinuxCncToolTable(new TextDecoder().decode(bytes), units);
    const merge = mergeToolTable(existing, table.tools);
    return { ...merge, notes: [...merge.notes, ...table.guesses], skipped: table.skipped.map((s) => ({ name: `line ${s.line}`, reason: s.reason })) };
  }
  const parsed = parseToolLibraryFile(bytes, fileName);
  return { ...mergeToolLibrary(existing, parsed.tools), skipped: parsed.skipped };
}
