import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { SPON_EXTENSION } from '@sponcam/core';

/** Writes a temporary file and renames it over `file`, so a failed write never leaves half a file. Throws the fs error. */
export async function writeFileAtomic(file: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export function withSponExtension(path: string): string {
  return extname(path).toLowerCase() === SPON_EXTENSION ? path : `${path}${SPON_EXTENSION}`;
}
