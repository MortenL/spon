import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './timeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the work finishes in time', async () => {
    const onTimeout = vi.fn();
    await expect(withTimeout(Promise.resolve(7), 1000, onTimeout, 'late')).resolves.toBe(7);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('runs onTimeout and rejects with the message when the work hangs', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const result = withTimeout(new Promise<never>(() => {}), 1000, onTimeout, 'Import timed out');
    const assertion = expect(result).rejects.toThrow('Import timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('passes through a rejection from the work', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, () => {}, 'late')).rejects.toThrow('boom');
  });
});
