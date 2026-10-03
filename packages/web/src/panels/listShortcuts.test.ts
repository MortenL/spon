import { describe, expect, it } from 'vitest';
import { duplicateShortcutLabel, firstProblem, moveSteps, shouldHandle, type KeyLike } from './listShortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}, target: KeyLike['target'] = { tagName: 'BODY' }): KeyLike =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, ...mods });

describe('shouldHandle', () => {
  it('maps the shortcuts', () => {
    expect(shouldHandle(key('d', { ctrlKey: true }), false)).toBe('duplicate');
    expect(shouldHandle(key('D', { metaKey: true }), false)).toBe('duplicate');
    expect(shouldHandle(key('Delete'), false)).toBe('delete');
    expect(shouldHandle(key('ArrowUp', { altKey: true }), false)).toBe('up');
    expect(shouldHandle(key('ArrowDown', { altKey: true }), false)).toBe('down');
    expect(shouldHandle(key('D', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(shouldHandle(key('d'), false)).toBeNull();
    expect(shouldHandle(key('ArrowUp'), false)).toBeNull();
    expect(shouldHandle(key('Backspace'), false)).toBeNull();
  });
  it('never acts while typing or with a dialog open (review focus 1)', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(shouldHandle(key('Delete', {}, target), false)).toBeNull();
      expect(shouldHandle(key('d', { ctrlKey: true }, target), false)).toBeNull();
    }
    expect(shouldHandle(key('Delete'), true)).toBeNull();
  });
});

describe('firstProblem', () => {
  it('prefers the first error, then the first warning', () => {
    expect(firstProblem([])).toBeNull();
    expect(firstProblem([{ severity: 'warning', message: 'w1' }, { severity: 'error', message: 'e1' }, { severity: 'error', message: 'e2' }])).toBe('e1');
    expect(firstProblem([{ severity: 'info', message: 'i' }, { severity: 'warning', message: 'w1' }])).toBe('w1');
    expect(firstProblem([{ severity: 'info', message: 'i' }])).toBeNull();
  });
});

describe('moveSteps (review focus 4)', () => {
  it('is the signed distance from the dragged row to the drop row', () => {
    expect(moveSteps(['a', 'b', 'c', 'd'], 'a', 'c')).toBe(2);
    expect(moveSteps(['a', 'b', 'c', 'd'], 'd', 'a')).toBe(-3);
    expect(moveSteps(['a', 'b'], 'a', 'a')).toBe(0);
    expect(moveSteps(['a'], 'a', 'a')).toBe(0);
    expect(moveSteps(['a', 'b'], 'a', 'zz')).toBe(0);
  });
});

describe('open menu', () => {
  it('ignores keys whose target is inside a menu', () => {
    const inMenu = { tagName: 'DIV', closest: (sel: string) => (sel === '[role="menu"]' ? {} : null) };
    expect(shouldHandle(key('Delete', {}, inMenu), false)).toBeNull();
    expect(shouldHandle(key('d', { ctrlKey: true }, inMenu), false)).toBeNull();
  });
});

describe('duplicateShortcutLabel', () => {
  it('is ⌘D on Apple platforms and Ctrl+D elsewhere', () => {
    expect(duplicateShortcutLabel('MacIntel')).toBe('⌘D');
    expect(duplicateShortcutLabel('iPhone')).toBe('⌘D');
    expect(duplicateShortcutLabel('Win32')).toBe('Ctrl+D');
    expect(duplicateShortcutLabel('Linux x86_64')).toBe('Ctrl+D');
    expect(duplicateShortcutLabel('')).toBe('Ctrl+D');
  });
});
