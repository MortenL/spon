import { describe, expect, it } from 'vitest';
import { axesHint, triadDirections } from './wcsAxes';

const off = { reverseX: false, reverseY: false, swapXY: false };

describe('axesHint', () => {
  it('describes the default layout', () => {
    expect(axesHint(off)).toBe('Program +X points right and +Y points away from you, as shown');
  });
  it('describes reverseY', () => {
    expect(axesHint({ ...off, reverseY: true })).toBe('Program +X points right and +Y points toward you in the view');
  });
  it('describes swapXY', () => {
    expect(axesHint({ ...off, swapXY: true })).toBe('Program +X points away from you and +Y points right in the view');
  });
});

describe('triadDirections', () => {
  it('gives the scene direction of program +X and +Y for all 8 layouts', () => {
    const cases: [Partial<typeof off>, [number, number], [number, number]][] = [
      [{}, [1, 0], [0, 1]],
      [{ reverseX: true }, [-1, 0], [0, 1]],
      [{ reverseY: true }, [1, 0], [0, -1]],
      [{ reverseX: true, reverseY: true }, [-1, 0], [0, -1]],
      [{ swapXY: true }, [0, 1], [1, 0]],
      [{ swapXY: true, reverseX: true }, [0, 1], [-1, 0]],
      [{ swapXY: true, reverseY: true }, [0, -1], [1, 0]],
      [{ swapXY: true, reverseX: true, reverseY: true }, [0, -1], [-1, 0]],
    ];
    for (const [flags, x, y] of cases) {
      const d = triadDirections({ ...off, ...flags });
      expect([d.x.x, d.x.y]).toEqual(x);
      expect([d.y.x, d.y.y]).toEqual(y);
    }
  });
});
