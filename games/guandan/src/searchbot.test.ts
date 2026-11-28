import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { decide as ruleDecide } from './bot.ts';
import { candidates, deal, decide } from './searchbot.ts';
import { hand } from './testhand.ts';
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

describe('残局搜索的细节', () => {
  it('收贡的人把收到的牌原样还回去：那张牌在进贡的人手里', () => {
    const s = endgame(11, 200);
    const card = s.hands[1][0];
    const t = { givers: [1], gifts: [{ from: 1, card }], pairs: [{ from: 1, to: 0, card }], returns: [{ from: 0, to: 1, card }], resisted: false, leader: 1 };
    const v = view({ ...s, tribute: t }, 2);
    for (let k = 0; k < 5; k++) {
      const hands = deal(v, SeededRng.fromSeed(k));
      expect(hands[1]).toContain(card);
      expect(hands[0]).not.toContain(card);
    }
  });

  it('同一组牌当顺子出和当同花顺出是两个候选', () => {
    const s = endgame(5, 200);
    const v = view({ ...s, hands: [hand('3 4 5 6 7 9 J'), ...s.hands.slice(1)], turn: 0, lastPlay: null }, 0);
    const flush = v.hand.slice(0, 5).map((id) => `S${id.slice(1)}`);
    v.hand = [...flush, ...v.hand.slice(5)];
    const kinds = candidates(v, ruleDecide(v))
      .filter((a) => a.type === 'play' && a.cards.length === 5)
      .map((a) => (a.type === 'play' ? a.as?.kind : null));
    expect(kinds).toContain('straight');
    expect(kinds).toContain('straightFlush');
  });
});
