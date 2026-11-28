import { describe as group, expect, it } from 'vitest';
import { classify, compareHands, describe, makeDeck, sortHand } from './patterns.ts';

group('牌型识别', () => {
  it('一副 52 张不重复', () => {
    const d = makeDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });

  it('六种牌型', () => {
    expect(classify(['S5', 'H5', 'D5']).kind).toBe('trips');
    expect(classify(['H12', 'H13', 'H14']).kind).toBe('straightFlush');
    expect(classify(['H14', 'H2', 'H3']).kind).toBe('straightFlush');
    expect(classify(['C2', 'C7', 'C11']).kind).toBe('flush');
    expect(classify(['S4', 'H5', 'D6']).kind).toBe('straight');
    expect(classify(['S14', 'H2', 'D3']).kind).toBe('straight');
    expect(classify(['S13', 'H14', 'D2']).kind).toBe('high'); // K-A-2 不是顺子
    expect(classify(['S9', 'D9', 'C3']).kind).toBe('pair');
    expect(classify(['S3', 'D9', 'C9']).kind).toBe('pair');
    expect(classify(['S14', 'D10', 'H7']).kind).toBe('high');
  });

  it('说明文字', () => {
    expect(describe(['S14', 'H2', 'D3'])).toBe('顺子 · A-2-3');
    expect(describe(['H12', 'H13', 'H14'])).toBe('同花顺 · Q-K-A');
    expect(describe(['S3', 'D9', 'C9'])).toBe('对子 · 一对 9');
    expect(describe(['S2', 'D3', 'C5'])).toBe('单张 · 235');
    expect(sortHand(['S3', 'D14', 'C9'])).toEqual(['D14', 'C9', 'S3']);
  });
});

group('比大小', () => {
  const beats = (a: string[], b: string[], x = false) => compareHands(a, b, x);
  it('牌型之间、牌型之内', () => {
    expect(beats(['S2', 'H2', 'D2'], ['H12', 'H13', 'H14'])).toBeGreaterThan(0);
    expect(beats(['H12', 'H13', 'H14'], ['C2', 'C7', 'C11'])).toBeGreaterThan(0);
    expect(beats(['C2', 'C3', 'C5'], ['S12', 'H13', 'D14'])).toBeGreaterThan(0);
    expect(beats(['S14', 'H2', 'D3'], ['S2', 'D2', 'C14'])).toBeGreaterThan(0);
    // 顺子：QKA 最大，A23 最小
    expect(beats(['S12', 'H13', 'D14'], ['S11', 'H12', 'D13'])).toBeGreaterThan(0);
    expect(beats(['S14', 'H2', 'D3'], ['S2', 'H3', 'D4'])).toBeLessThan(0);
    // 对子先比对，再比单张
    expect(beats(['S9', 'D9', 'C3'], ['S8', 'D8', 'C14'])).toBeGreaterThan(0);
    expect(beats(['S9', 'D9', 'C4'], ['H9', 'C9', 'C3'])).toBeGreaterThan(0);
    // 单张一张张比；完全一样大为 0（不比花色）
    expect(beats(['S14', 'D10', 'H7'], ['C14', 'H10', 'D6'])).toBeGreaterThan(0);
    expect(beats(['S14', 'D10', 'H7'], ['C14', 'H10', 'D7'])).toBe(0);
  });

  it('235 吃豹子：只在开着时，只压豹子，同花的 235 不算', () => {
    const trips = ['S14', 'H14', 'D14'];
    const s235 = ['S2', 'H3', 'C5'];
    expect(beats(s235, trips, false)).toBeLessThan(0);
    expect(beats(s235, trips, true)).toBeGreaterThan(0);
    expect(beats(trips, s235, true)).toBeLessThan(0);
    expect(beats(s235, ['S2', 'H4', 'C6'], true)).toBeLessThan(0);
    expect(beats(['S2', 'S3', 'S5'], trips, true)).toBeLessThan(0);
  });
});
