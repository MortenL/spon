import { describe, expect, it } from 'vitest';
import { isScaled, lineToScrollTop, MAX_SPACER_PX, scrollTopToFirstLine, spacerHeight } from './virtualScroll';

const ROW = 20;
const VIEWPORT = 300; // 15 rows

describe('isScaled / spacerHeight', () => {
  it('is not scaled below the cap and reports the exact content height', () => {
    expect(isScaled(1000, ROW)).toBe(false);
    expect(spacerHeight(1000, ROW)).toBe(20_000);
  });

  it('is scaled above the cap and caps the spacer height', () => {
    expect(isScaled(2_000_000, ROW)).toBe(true);
    expect(spacerHeight(2_000_000, ROW)).toBe(MAX_SPACER_PX);
  });
});

describe('scrollTopToFirstLine / lineToScrollTop', () => {
  it('identity case below the cap: scrollTop / rowHeight, and its exact inverse', () => {
    expect(scrollTopToFirstLine(240, VIEWPORT, 1000, ROW)).toBe(12);
    expect(lineToScrollTop(12, VIEWPORT, 1000, ROW)).toBe(240);
  });

  it('at 2M lines, scrollTop at max maps to the last page', () => {
    const count = 2_000_000;
    const visibleRows = VIEWPORT / ROW;
    const maxScroll = MAX_SPACER_PX - VIEWPORT;
    expect(scrollTopToFirstLine(maxScroll, VIEWPORT, count, ROW)).toBe(count - visibleRows);
  });

  it('at 2M lines, scrollTop 0 maps to line 0', () => {
    expect(scrollTopToFirstLine(0, VIEWPORT, 2_000_000, ROW)).toBe(0);
  });

  it('round trip line -> scrollTop -> first line lands within one row', () => {
    const count = 2_000_000;
    const line = 500_000;
    const scrollTop = lineToScrollTop(line, VIEWPORT, count, ROW);
    const back = scrollTopToFirstLine(scrollTop, VIEWPORT, count, ROW);
    expect(Math.abs(back - line)).toBeLessThanOrEqual(1);
  });

  it('count 0 always maps to line 0 / scrollTop 0', () => {
    expect(scrollTopToFirstLine(1234, VIEWPORT, 0, ROW)).toBe(0);
    expect(lineToScrollTop(5, VIEWPORT, 0, ROW)).toBe(0);
  });
});
