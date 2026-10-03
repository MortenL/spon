import { describe, expect, it } from 'vitest';
import { parseLinuxCncToolTable } from '../src';
import { sanitizeName } from '../src/post/format';

/** Hostile inputs for the patterns CodeQL flagged as polynomial (js/polynomial-redos). */
const fast = (run: () => void) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe('regexes stay linear on hostile input', () => {
  const n = 50_000;
  it.each([
    ['digits with no degree sign', 'chamfer ' + '1'.repeat(n) + 'x'],
    ['v-bit, then a digit and spaces with no degree sign', 'v-bit 1' + ' '.repeat(n) + 'x'],
    ['v and spaces with no number', 'v' + ' '.repeat(n) + 'x'],
    ['r and spaces with no number', 'r' + ' '.repeat(n) + 'x'],
  ])('tool table comment: %s', (_name, comment) => {
    expect(fast(() => parseLinuxCncToolTable(`T1 P1 D6 ;${comment}`, 'mm'))).toBeLessThan(200);
  });

  it('job name of underscores', () => {
    expect(fast(() => sanitizeName('a' + '_'.repeat(n) + 'a'))).toBeLessThan(200);
  });
});

describe('behaviour is unchanged', () => {
  const guess = (comment: string) => parseLinuxCncToolTable(`T1 P1 D6 ;${comment}`, 'mm').tools[0];
  it('reads tip angles and corner radii from comments', () => {
    expect(guess('engraver 30 deg').tipAngleDeg).toBe(30);
    expect(guess('V 90').tipAngleDeg).toBe(90);
    expect(guess('v-60 bit').tipAngleDeg).toBe(60);
    expect(guess('tool  45   °').tipAngleDeg).toBe(45);
    expect(guess('chamfer 120°').tipAngleDeg).toBe(120);
    expect(guess('bull R 0.5')).toMatchObject({ type: 'bull', cornerRadius: 0.5 });
    expect(guess('flat endmill').type).toBe('flat');
  });
  it('sanitizes job names', () => {
    expect(sanitizeName('  __My job (v2)!__ ')).toBe('My_job_v2');
    expect(sanitizeName('___')).toBe('job');
    expect(sanitizeName('a_b')).toBe('a_b');
  });
});
