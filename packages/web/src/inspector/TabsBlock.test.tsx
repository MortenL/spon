import { defaultTabs, type PocketOp, type ProfileOp } from '@sponcam/core';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommand = vi.hoisted(() => vi.fn());
vi.mock('@/state/camView', () => ({ runCommand }));

import { TabsBlock } from './TabsBlock';

type Props = Record<string, unknown> & { children?: ReactNode };

/** Walk an element tree (without rendering) and return the first element carrying this data-testid. */
function find(node: ReactNode, testId: string): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, testId);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<Props>(node)) return null;
  if (node.props['data-testid'] === testId || node.props.testId === testId) return node;
  return find(node.props.children, testId);
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}

const tabs = (manual: { refIndex: number; t: number[] }[], enabled = true) => ({ ...defaultTabs(10), enabled, manual });
const profile = (manual: { refIndex: number; t: number[] }[]) => ({ id: 'op1', type: 'profile', tabs: tabs(manual) }) as unknown as ProfileOp;
const pocket = () => ({ id: 'op2', type: 'pocket', tabs: tabs([]) }) as unknown as PocketOp;

describe('TabsBlock', () => {
  beforeEach(() => runCommand.mockReset());

  it('counts contours placed by hand', () => {
    const tree = TabsBlock({ op: profile([{ refIndex: 0, t: [0.2] }, { refIndex: 2, t: [] }]) });
    expect(text(find(tree, 'pass-tab-manual-count'))).toBe('2 contours placed by hand');
  });

  it('hides the manual count at zero and says "contour" for one', () => {
    expect(find(TabsBlock({ op: profile([]) }), 'pass-tab-manual-count')).toBeNull();
    expect(text(find(TabsBlock({ op: profile([{ refIndex: 1, t: [0.5] }]) }), 'pass-tab-manual-count'))).toBe('1 contour placed by hand');
  });

  it('Reset clears manual', () => {
    const tree = TabsBlock({ op: profile([{ refIndex: 0, t: [0.2] }]) });
    (find(tree, 'pass-tab-reset')!.props.onClick as () => void)();
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0][0]).toMatchObject({ type: 'updateOperation', id: 'op1', patch: { tabs: { manual: [] } } });
  });

  it('renders the per-contour reset, disabled until Task 5', () => {
    const tree = TabsBlock({ op: profile([{ refIndex: 0, t: [0.2] }]) });
    expect(find(tree, 'pass-tab-reset-contour')!.props.disabled).toBe(true);
  });

  it('pocket without islands explains itself and disables the fields', () => {
    const tree = TabsBlock({ op: pocket(), islands: 0 });
    expect(text(find(tree, 'pass-tab-no-islands'))).toBe('Tabs hold islands; this pocket has none');
    for (const id of ['pass-tabs', 'pass-tab-shape', 'pass-tab-width', 'pass-tab-height', 'pass-tab-placement', 'pass-tab-count']) {
      expect(find(tree, id)!.props.disabled, id).toBe(true);
    }
  });

  it('pocket with islands has no notice and enabled fields', () => {
    const tree = TabsBlock({ op: pocket(), islands: 2 });
    expect(find(tree, 'pass-tab-no-islands')).toBeNull();
    expect(find(tree, 'pass-tab-width')!.props.disabled).toBeFalsy();
  });
});
