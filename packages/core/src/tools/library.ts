import { strFromU8, unzipSync } from 'fflate';
import { TOOL_TYPES, type Tool, type ToolPreset, type ToolType } from './types';

export class ToolLibraryError extends Error {
  override name = 'ToolLibraryError';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateTool(value: unknown): value is Tool {
  const t = value as Tool;
  return (
    typeof t === 'object' && t !== null && typeof t.id === 'string' && typeof t.name === 'string' && TOOL_TYPES.includes(t.type) &&
    Number.isInteger(t.number) && t.number >= 0 && isNum(t.diameter) && t.diameter > 0 && isNum(t.cornerRadius) && t.cornerRadius >= 0 &&
    isNum(t.tipAngleDeg) && isNum(t.fluteLength) && t.fluteLength > 0 && isNum(t.stickout) && isNum(t.flutes) && Array.isArray(t.presets) &&
    t.presets.every((p) =>
      typeof p.name === 'string' && isNum(p.rpm) && isNum(p.feed) && isNum(p.plungeFeed) && isNum(p.stepdown) && p.stepdown > 0 &&
      isNum(p.stepoverPct) && p.stepoverPct > 0 && p.stepoverPct <= 100 && ['off', 'flood', 'mist'].includes(p.coolant))
  );
}

export function exportToolLibrary(tools: readonly Tool[]): string {
  return JSON.stringify({ format: 'spon-tools', version: 1, tools }, null, 2);
}

export function importToolLibrary(text: string): Tool[] {
  let data: { format?: unknown; version?: unknown; tools?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new ToolLibraryError('The file is not valid JSON');
  }
  if (data?.format !== 'spon-tools' || !Array.isArray(data.tools)) throw new ToolLibraryError('This is not a Spon tool library');
  data.tools.forEach((t, i) => {
    if (!validateTool(t)) throw new ToolLibraryError(`Tool ${i + 1} is invalid`);
  });
  return data.tools as Tool[];
}

export interface FusionImportResult { tools: Tool[]; skipped: { name: string; reason: string }[] }

function fusionType(type: string): ToolType | null {
  const t = type.toLowerCase();
  if (t === 'flat end mill' || t === 'face mill') return 'flat';
  if (t === 'ball end mill') return 'ball';
  if (t === 'bull nose end mill') return 'bull';
  if (t === 'chamfer mill') return 'chamfer';
  if (t === 'drill' || t === 'spot drill' || t === 'center drill') return 'drill';
  if (t.includes('engrav')) return 'vbit';
  return null;
}

function coolantOf(value: unknown): ToolPreset['coolant'] {
  const v = String(value ?? 'disabled').toLowerCase();
  if (v === 'disabled' || v === 'off') return 'off';
  if (v === 'mist' || v === 'air') return 'mist';
  return 'flood';
}

type FusionEntry = Record<string, unknown> & { geometry?: Record<string, unknown> };

/** Fusion 360 tool library: `.json`, or `.tools` (a zip holding the same JSON). */
export function importFusionLibrary(bytes: Uint8Array, fileName: string): FusionImportResult {
  let text: string;
  if (fileName.toLowerCase().endsWith('.tools')) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      throw new ToolLibraryError('The .tools file is not a valid archive');
    }
    const json = Object.keys(files).find((n) => n.toLowerCase().endsWith('.json'));
    if (!json) throw new ToolLibraryError('The .tools file contains no tool library');
    text = strFromU8(files[json]);
  } else text = strFromU8(bytes);
  let lib: { data?: unknown };
  try {
    lib = JSON.parse(text);
  } catch {
    throw new ToolLibraryError('The file is not valid JSON');
  }
  if (!Array.isArray(lib?.data)) throw new ToolLibraryError('This is not a Fusion 360 tool library');
  const out: FusionImportResult = { tools: [], skipped: [] };
  (lib.data as FusionEntry[]).forEach((e, index) => {
    const name = String(e.description || e['product-id'] || e.type || `Tool ${index + 1}`);
    const type = fusionType(String(e.type ?? ''));
    if (!type) return out.skipped.push({ name, reason: `Unsupported tool type "${String(e.type)}"` });
    const k = e.unit === 'inches' ? 25.4 : 1;
    const g = e.geometry ?? {};
    const n = (v: unknown) => (isNum(v) ? v : 0);
    const diameter = n(g.DC) * k;
    if (!(diameter > 0)) return out.skipped.push({ name, reason: 'No diameter' });
    const presetList = ((e['start-values'] as { presets?: Record<string, unknown>[] } | undefined)?.presets ?? []);
    const presets: ToolPreset[] = presetList.map((p) => {
      const feed = n(p.v_f) * k;
      const stepover = n(p.stepover) * k;
      return {
        name: String(p.name ?? 'Default'),
        rpm: n(p.n),
        feed,
        plungeFeed: (isNum(p.v_f_plunge) ? p.v_f_plunge * k : feed),
        stepdown: n(p.stepdown) * k || diameter / 2,
        stepoverPct: stepover > 0 ? Math.min(100, Math.max(1, (stepover / diameter) * 100)) : 40,
        coolant: coolantOf(p['tool-coolant']),
      };
    });
    const post = e['post-process'] as { number?: unknown } | undefined;
    const tool: Tool = {
      id: crypto.randomUUID(), name, type,
      number: Number.isInteger(post?.number) ? (post!.number as number) : index + 1,
      diameter, cornerRadius: n(g.RE) * k,
      tipAngleDeg: isNum(g.SIG) ? g.SIG : isNum(g.TA) ? 2 * g.TA : 0,
      fluteLength: n(g.LCF) * k || diameter * 3,
      stickout: (isNum(g.LB) ? g.LB : n(g.OAL)) * k || diameter * 5,
      flutes: n(g.NOF) || 2,
      presets,
      ...(e.vendor ? { vendor: String(e.vendor) } : {}),
      ...(e['product-id'] ? { productId: String(e['product-id']) } : {}),
    };
    out.tools.push(tool);
  });
  return out;
}
