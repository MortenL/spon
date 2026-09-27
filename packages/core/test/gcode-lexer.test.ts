import { describe, expect, it } from 'vitest';
import { decodeProgramText } from '../src/gcode/decode';
import { computeLineStarts, createWordBuffer, lexLine } from '../src/gcode/lexer';
import { LineFlag } from '../src/gcode/types';

function lex(line: string) {
  const buf = createWordBuffer(2); // tiny on purpose: must grow
  const flags = lexLine(line, 0, line.length, buf);
  const words: string[] = [];
  for (let i = 0; i < buf.count; i++) words.push(`${String.fromCharCode(buf.letters[i])}${buf.values[i]}`);
  return { flags, words };
}

describe('lexLine', () => {
  it('reads packed, spaced and lower-case words', () => {
    expect(lex('G1X10Y-2.5').words).toEqual(['G1', 'X10', 'Y-2.5']);
    expect(lex('g 1 x 10.5  y+3').words).toEqual(['G1', 'X10.5', 'Y3']);
    expect(lex('X.5 Y-.25 Z0.').words).toEqual(['X0.5', 'Y-0.25', 'Z0']);
  });

  it('drops comments, line numbers, program numbers, % and checksums', () => {
    expect(lex('N10 G0 X1 (rapid) Y2 ; tail comment').words).toEqual(['G0', 'X1', 'Y2']);
    expect(lex('O1234 (PART)').words).toEqual([]);
    expect(lex('%').words).toEqual([]);
    expect(lex('N20 G1 X1*47').words).toEqual(['G1', 'X1']);
    expect(lex('/G1 X2').words).toEqual(['G1', 'X2']);
    expect(lex('  ').words).toEqual([]);
  });

  it('keeps decimal G codes', () => {
    expect(lex('G90.1 G91.1').words).toEqual(['G90.1', 'G91.1']);
  });

  it('flags macro syntax', () => {
    for (const line of ['#1=5', 'G1 X#1', 'IF [#1 GT 0] GOTO 10', 'WHILE [#2 LT 3] DO1', 'G1 X[1+2]']) {
      expect(lex(line).flags).toBe(LineFlag.Macro | LineFlag.NotSimulated);
    }
  });

  it('flags malformed words as not simulated', () => {
    expect(lex('G1 X').flags).toBe(LineFlag.NotSimulated);
    expect(lex('G1 X1 = 2').flags).toBe(LineFlag.NotSimulated);
    expect(lex('G1 X1').flags).toBe(0);
  });
});

describe('computeLineStarts', () => {
  it('finds the start of every line for LF and CRLF text', () => {
    expect(Array.from(computeLineStarts('a\nb\r\nc'))).toEqual([0, 2, 5]);
    expect(Array.from(computeLineStarts(''))).toEqual([0]);
    expect(Array.from(computeLineStarts('x\n'))).toEqual([0, 2]);
  });

  it('lets lexLine read CRLF lines', () => {
    const text = 'G0 X1\r\nG1 Y2\r\n';
    const starts = computeLineStarts(text);
    const buf = createWordBuffer();
    lexLine(text, starts[0], starts[1], buf);
    expect(buf.count).toBe(2);
    expect(buf.values[1]).toBe(1);
  });
});

describe('decodeProgramText', () => {
  it('decodes UTF-8 and falls back to Latin-1', () => {
    expect(decodeProgramText(new TextEncoder().encode('(Ø6 fres)\nG0'))).toBe('(Ø6 fres)\nG0');
    expect(decodeProgramText(new Uint8Array([0x28, 0xd8, 0x29]))).toBe('(Ø)');
  });
});
