/** Rounds to `decimals`, strips trailing zeros, never writes −0; `trailingDot` keeps "40." (Fanuc). */
export function fmtNum(v: number, decimals: number, trailingDot = false): string {
  let s = (Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v).toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = trailingDot ? s : s.slice(0, -1);
  else if (trailingDot && !s.includes('.')) s += '.';
  return s;
}

/** A job name usable in file names. */
export function sanitizeName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'job';
}

/** Text safe inside ( ) comments. */
export const commentText = (text: string): string => text.replace(/\(/g, '[').replace(/\)/g, ']');
