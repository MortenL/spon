import { LineFlag } from './types';

/** Reusable word storage: letters as upper-case char codes, values as numbers. */
export interface WordBuffer {
  letters: Uint8Array;
  values: Float64Array;
  count: number;
}

export function createWordBuffer(capacity = 32): WordBuffer {
  return { letters: new Uint8Array(capacity), values: new Float64Array(capacity), count: 0 };
}

function push(buf: WordBuffer, letter: number, value: number): void {
  if (buf.count === buf.letters.length) {
    const letters = new Uint8Array(buf.letters.length * 2);
    const values = new Float64Array(buf.values.length * 2);
    letters.set(buf.letters);
    values.set(buf.values);
    buf.letters = letters;
    buf.values = values;
  }
  buf.letters[buf.count] = letter;
  buf.values[buf.count] = value;
  buf.count++;
}

/** Offset of the first character of every line (split on \n; a trailing \r is ignored by lexLine). */
export function computeLineStarts(text: string): Uint32Array {
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  const starts = new Uint32Array(lines);
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts[n++] = i + 1;
  return starts;
}

const SPACE = 32, TAB = 9, CR = 13, LF = 10;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const upper = (c: number) => (c >= 97 ? c - 32 : c);

/**
 * Tokenises text[start, end) into `out` (cleared first). Returns LineFlag bits: Macro|NotSimulated for
 * macro syntax (#, [, keywords like IF/GOTO/WHILE), NotSimulated for any other malformed content.
 */
export function lexLine(text: string, start: number, end: number, out: WordBuffer): number {
  out.count = 0;
  let i = start;
  const skipSpace = () => {
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c !== SPACE && c !== TAB && c !== CR) break;
      i++;
    }
  };
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === SPACE || c === TAB || c === CR || c === LF || c === 37 /* % */ || c === 47 /* / */) {
      i++;
      continue;
    }
    if (c === 40 /* ( */) {
      while (i < end && text.charCodeAt(i) !== 41) i++;
      i++;
      continue;
    }
    if (c === 59 /* ; */ || c === 42 /* * */) break;
    if (c === 35 /* # */ || c === 91 /* [ */) return LineFlag.Macro | LineFlag.NotSimulated;
    if (!isLetter(c)) return LineFlag.NotSimulated;

    const letter = upper(c);
    i++;
    skipSpace();
    if (i >= end) return LineFlag.NotSimulated;
    const next = text.charCodeAt(i);
    if (isLetter(next) || next === 35 || next === 91) return LineFlag.Macro | LineFlag.NotSimulated;

    // number: [+-] digits [. digits]
    let sign = 1;
    if (next === 45 /* - */ || next === 43 /* + */) {
      if (next === 45) sign = -1;
      i++;
      skipSpace();
    }
    // accumulate every digit as an integer and divide once, so 0.25 and 90.1 are correctly rounded
    let mantissa = 0;
    let fractionDigits = 0;
    let digits = 0;
    while (i < end && isDigit(text.charCodeAt(i))) {
      mantissa = mantissa * 10 + (text.charCodeAt(i) - 48);
      i++;
      digits++;
    }
    if (i < end && text.charCodeAt(i) === 46 /* . */) {
      i++;
      while (i < end && isDigit(text.charCodeAt(i))) {
        mantissa = mantissa * 10 + (text.charCodeAt(i) - 48);
        fractionDigits++;
        i++;
        digits++;
      }
    }
    const value = fractionDigits ? mantissa / 10 ** fractionDigits : mantissa;
    if (digits === 0) {
      if (i < end && text.charCodeAt(i) === 35) return LineFlag.Macro | LineFlag.NotSimulated;
      return LineFlag.NotSimulated;
    }
    if (letter === 78 /* N */ || letter === 79 /* O */) continue;
    push(out, letter, sign * value);
  }
  return 0;
}
