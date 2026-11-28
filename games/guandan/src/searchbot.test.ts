import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { decide as ruleDecide } from './bot.ts';
import { decide } from './searchbot.ts';
import { active, apply, setup, validate, view, type State } from './rules.ts';

/** 规则 bot 打到全场只剩 limit 张牌左右的局面 */
function endgame(seed: number, limit: number): State {
  const rng = SeededRng.fromSeed(seed);
  let s = setup({ rng, options: { length: 'one' } });
  while (s.phase === 'playing' && s.hands.reduce((n, h) => n + h.length, 0) > limit) {
    const seat = active(s)[0];
    s = apply(s, seat, ruleDecide(view(s, seat)), { rng });
  }
  return s;
}

describe('残局搜索', () => {
  it('打完残局：每一步都合法，同一局面两次给出同一个决定', async () => {
    for (let g = 0; g < 6; g++) {
      const rng = SeededRng.fromSeed(g);
      let s = endgame(g + 300, 45);
      while (s.phase === 'playing') {
        const seat = active(s)[0];
        const a = await decide(view(s, seat));
        expect(validate(s, seat, a)).toBeNull();
        if (g === 0) expect(await decide(view(s, seat))).toEqual(a);
        s = apply(s, seat, a, { rng });
      }
      expect(s.phase).toBe('ended');
    }
  }, 60_000);

  it('牌还多时不搜，直接用规则 bot 的决定', async () => {
    const s = endgame(5, 200);
    const v = view(s, s.turn);
    expect(await decide(v)).toEqual(ruleDecide(v));
  });

  it('被取消时交回规则 bot 的决定', async () => {
    const s = endgame(7, 30);
    const v = view(s, s.turn);
    const ctl = new AbortController();
    ctl.abort();
    expect(await decide(v, ctl.signal)).toEqual(ruleDecide(v));
  });
});
