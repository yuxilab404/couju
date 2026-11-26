import { describe, expect, it } from 'vitest';
import { SeededRng } from '@couju/sdk';
import { decide } from './bot.ts';
import { COUNTER_RANKS, outstanding } from './counter.ts';
import { apply, setup, view } from './rules.ts';

describe('记牌器', () => {
  it('开局：别人手里 = 一副牌减去我的 17 张', () => {
    const left = outstanding({ hand: ['S03', 'H03', 'J17'], history: [] });
    expect(left[3]).toBe(2);
    expect(left[17]).toBe(0);
    expect(left[16]).toBe(1);
    expect(left[15]).toBe(4);
  });

  it('打出的牌被扣掉，"不要"不影响', () => {
    const left = outstanding({
      hand: ['S05'],
      history: [{ seat: 1, cards: ['H05', 'C05'] }, { seat: 2, cards: null }, { seat: 0, cards: ['J16', 'J17'] }],
    });
    expect(left[5]).toBe(1);
    expect(left[16]).toBe(0);
    expect(left[17]).toBe(0);
  });

  it('整局任意时刻：记牌器总数 = 另外两家的手牌张数之和', () => {
    const rng = SeededRng.fromSeed(11);
    let s = setup({ rng });
    for (let i = 0; i < 400 && s.phase !== 'ended'; i++) {
      for (const me of [0, 1, 2]) {
        const v = view(s, me);
        const total = COUNTER_RANKS.reduce((n, r) => n + outstanding(v)[r], 0);
        const others = v.counts.reduce((n, c, seat) => n + (seat === me ? 0 : c), 0);
        // 叫分阶段底牌还没发到谁手里，也算"别人手里"（未知位置）
        expect(total).toBe(others + (v.phase === 'bidding' ? 3 : 0));
        for (const r of COUNTER_RANKS) expect(outstanding(v)[r]).toBeGreaterThanOrEqual(0);
      }
      s = apply(s, s.turn, decide(view(s, s.turn)), { rng });
    }
  });
});
