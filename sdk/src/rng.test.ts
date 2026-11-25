import { describe, expect, it } from 'vitest';
import { SeededRng } from './rng.ts';

describe('SeededRng', () => {
  it('同种子同序列', () => {
    const a = SeededRng.fromSeed(42), b = SeededRng.fromSeed(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('状态可序列化并续接', () => {
    const a = SeededRng.fromSeed(7);
    a.next(); a.next();
    const b = new SeededRng(JSON.parse(JSON.stringify(a.state())));
    for (let i = 0; i < 50; i++) expect(b.int(1000)).toBe(a.int(1000));
  });
  it('shuffle 不改入参且是排列', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = SeededRng.fromSeed(1).shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(src);
  });
  it('int 范围', () => {
    const r = SeededRng.fromSeed(3);
    for (let i = 0; i < 1000; i++) {
      const x = r.int(5);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(5);
    }
  });
});
