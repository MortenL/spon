/** Program text: UTF-8 when valid (BOM stripped), otherwise Latin-1 (older posts). */
export function decodeProgramText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}
