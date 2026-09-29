import { strFromU8, unzipSync } from 'fflate';
import { TOOL_TYPES, type Tool, type ToolPreset, type ToolType } from './types';

export class ToolLibraryError extends Error {
  override name = 'ToolLibraryError';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateTool(value: unknown): value is Tool {
  if (value === null || typeof value !== 'object') return false;
  const t = value as Tool;
  return (
    typeof t.id === 'string' && typeof t.name === 'string' && TOOL_TYPES.includes(t.type) &&
    Number.isInteger(t.number) && t.number >= 0 && isNum(t.diameter) && t.diameter > 0 && isNum(t.cornerRadius) && t.cornerRadius >= 0 &&
    isNum(t.tipAngleDeg) && isNum(t.fluteLength) && t.fluteLength > 0 && isNum(t.stickout) && t.stickout > 0 &&
    Number.isInteger(t.flutes) && t.flutes > 0 && Array.isArray(t.presets) &&
    t.presets.every((p) => {
      if (p === null || typeof p !== 'object') return false;
      return typeof p.name === 'string' && isNum(p.rpm) && p.rpm > 0 && isNum(p.feed) && p.feed > 0 && isNum(p.plungeFeed) && p.plungeFeed > 0 &&
        isNum(p.stepdown) && p.stepdown > 0 && isNum(p.stepoverPct) && p.stepoverPct > 0 && p.stepoverPct <= 100 &&
        ['off', 'flood', 'mist'].includes(p.coolant);
    })
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
  (lib.data as unknown[]).forEach((e, index) => {
    if (e === null || typeof e !== 'object') return out.skipped.push({ name: `Tool ${index + 1}`, reason: 'Not a tool entry' });
    const entry = e as FusionEntry;
    const name = String(entry.description || entry['product-id'] || entry.type || `Tool ${index + 1}`);
    const type = fusionType(String(entry.type ?? ''));
    if (!type) return out.skipped.push({ name, reason: `Unsupported tool type "${String(entry.type)}"` });
    const k = entry.unit === 'inches' ? 25.4 : 1;
    const g = entry.geometry ?? {};
    const n = (v: unknown) => (isNum(v) ? v : 0);
    const diameter = n(g.DC) * k;
    if (!(diameter > 0)) return out.skipped.push({ name, reason: 'No diameter' });
    const startValues = entry['start-values'] as { presets?: unknown } | undefined;
    const presetList = Array.isArray(startValues?.presets) ? startValues.presets : [];
    const presets: ToolPreset[] = presetList
      .filter((p) => p !== null && typeof p === 'object')
      .map((p) => {
        const preset = p as Record<string, unknown>;
        const feed = n(preset.v_f) * k;
        const stepover = n(preset.stepover) * k;
        return {
          name: String(preset.name ?? 'Default'),
          rpm: n(preset.n),
          feed,
          plungeFeed: (isNum(preset.v_f_plunge) ? preset.v_f_plunge * k : feed),
          stepdown: n(preset.stepdown) * k || diameter / 2,
          stepoverPct: stepover > 0 ? Math.min(100, Math.max(1, (stepover / diameter) * 100)) : 40,
          coolant: coolantOf(preset['tool-coolant']),
        };
      })
      .filter((p) => p.rpm > 0 && p.feed > 0 && p.plungeFeed > 0);
    const post = entry['post-process'] as { number?: unknown } | undefined;
    const flutes = Math.round(n(g.NOF)) || 2;
    const tool: Tool = {
      id: crypto.randomUUID(), name, type,
      number: Number.isInteger(post?.number) ? (post!.number as number) : index + 1,
      diameter, cornerRadius: n(g.RE) * k,
      tipAngleDeg: isNum(g.SIG) ? g.SIG : isNum(g.TA) ? 2 * g.TA : 0,
      fluteLength: n(g.LCF) * k || diameter * 3,
      stickout: (isNum(g.LB) ? g.LB : n(g.OAL)) * k || diameter * 5,
      flutes,
      presets,
      ...(entry.vendor ? { vendor: String(entry.vendor) } : {}),
      ...(entry['product-id'] ? { productId: String(entry['product-id']) } : {}),
    };
    if (!validateTool(tool)) return out.skipped.push({ name, reason: 'Invalid tool values' });
    out.tools.push(tool);
  });
  return out;
}
