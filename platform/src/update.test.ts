import { describe, expect, it } from 'vitest';
import { UpdateWatcher } from './update.ts';

describe('UpdateWatcher', () => {
  it('线上版本和自己不同才记下；一样、拿不到、出错都不提示', async () => {
    let next: string | null | Error = 'v1';
    const w = new UpdateWatcher('v1', async () => {
      if (next instanceof Error) throw next;
      return next;
    });
    await w.check();
    expect(w.state.get().latest).toBeNull();
    next = null;
    await w.check();
    expect(w.state.get().latest).toBeNull();
    next = new Error('offline');
    await w.check();
    expect(w.state.get().latest).toBeNull();
    next = 'v2';
    await w.check();
    expect(w.state.get().latest).toBe('v2');
    next = 'v3';
    await w.check();
    expect(w.state.get().latest).toBe('v3');
  });
});
