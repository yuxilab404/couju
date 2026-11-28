import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { decide as ruleDecide } from './bot.ts';
import { isWild, makeDeck, sortCards, valueOf } from './cards.ts';
import { bestCandidate, candidates, deal, decide, handValue } from './searchbot.ts';
import { hand } from './testhand.ts';
import { active, apply, setup, validate, view, type HandSummary, type State } from './rules.ts';

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

  it('开局领出沿用规则 bot 的选择', async () => {
    const s = endgame(5, 200);
    const v = view(s, s.turn);
    expect(await decide(v)).toEqual(ruleDecide(v));
  });

  it('打 J 开局，对手的 999 带 22 不值得用两张逢人配去接', async () => {
    const rng = SeededRng.fromSeed(924023);
    const dealt = setup({ rng, options: { length: 'one' } });
    let s: State = { ...dealt, level: 11, teamLevels: [11, 11], hands: dealt.hands.map(h => sortCards(h, 11)) };
    s = apply(s, 1, { type: 'play', cards: ['H02a', 'H02b', 'C02b', 'H04b', 'S04a'], as: { kind: 'fullHouse', main: 2 } }, { rng });
    s = apply(s, 2, { type: 'play', cards: ['C09a', 'H09a', 'S09a', 'D02a', 'S02a'], as: { kind: 'fullHouse', main: 9 } }, { rng });
    expect(await decide(view(s, 3))).toEqual({ type: 'pass' });
  });

  it('最后一张 K 能管对手的 3 拿头游，就当场出完', async () => {
    const s = setup({ rng: SeededRng.fromSeed(924031), options: { length: 'one' } });
    const v = { ...view(s, 0), turn: 0, hand: ['C13a'], counts: [1, 6, 10, 8],
      lastPlay: { seat: 3, cards: ['H03b'], kind: 'single' as const, main: 3, size: 1 } };
    expect(await decide(v)).toEqual({ type: 'play', cards: ['C13a'], as: { kind: 'single', main: 13 } });
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
  function samplingView(hands: string[][], tribute: State['tribute']) {
    const s = setup({ rng: SeededRng.fromSeed(21), options: { length: 'one' } });
    const remaining = new Set(hands.flat());
    return view({ ...s, hands, tribute, history: [{ seat: 0, cards: makeDeck().filter((c) => !remaining.has(c)) }] }, 0);
  }

  it('有贡牌上限时，跳过的大牌不会特别偏向下一个无上限座位', () => {
    const v = samplingView([['S05a'], ['S03a', 'S04a'], ['S04b'], ['J16a']], {
      givers: [1], gifts: [{ from: 1, card: 'S05a' }], pairs: [{ from: 1, to: 0, card: 'S05a' }],
      returns: [{ from: 0, to: 1, card: 'S03a' }], resisted: false, leader: 1,
    });
    let atTwo = 0;
    for (let k = 0; k < 600; k++) if (deal(v, SeededRng.fromSeed(k))[2].includes('J16a')) atTwo++;
    expect(atTwo).toBeGreaterThan(240);
    expect(atTwo).toBeLessThan(360);
  });

  it('抗贡时还没打出的大王只分给进贡方', () => {
    const v = samplingView([['S03a'], ['J17a', 'J17b', 'S04a'], ['S05a', 'S06a'], ['S07a', 'S08a']], {
      givers: [1], gifts: [], pairs: [], returns: [], resisted: true, leader: 0,
    });
    for (let k = 0; k < 30; k++) {
      const sample = deal(v, SeededRng.fromSeed(k));
      expect(sample[1]).toEqual(expect.arrayContaining(['J17a', 'J17b']));
      expect(sample.map((h) => h.length)).toEqual(v.counts);
    }
  });

  it('没抗贡且公开进过一个大王时，另一个大王不再分给进贡方', () => {
    const v = samplingView([['J17a', 'S04a'], ['S03a', 'S05a'], ['J17b', 'S06a'], ['S07a', 'S08a']], {
      givers: [1], gifts: [{ from: 1, card: 'J17a' }], pairs: [{ from: 1, to: 0, card: 'J17a' }],
      returns: [{ from: 0, to: 1, card: 'S03a' }], resisted: false, leader: 1,
    });
    for (let k = 0; k < 30; k++) {
      const sample = deal(v, SeededRng.fromSeed(k));
      expect(sample[1]).not.toContain('J17b');
      expect(sample.map((h) => h.length)).toEqual(v.counts);
    }
  });

  it('换牌门槛只比较规则首选，后面的更优候选不用再次跨过门槛', () => {
    expect(bestCandidate([0, 3, 4.5], 10)).toBe(2);
    expect(bestCandidate([0, 4.5, 3], 10)).toBe(1);
    expect(bestCandidate([0, 1.9], 10)).toBe(0);
  });

  it('候选有顶住对手的最大普通牌，不被几张小牌挤掉', () => {
    const s = endgame(5, 200);
    const prev = { kind: 'single' as const, main: 3, size: 1, seat: 1, cards: hand('3') };
    const v = view({ ...s, hands: [hand('4 5 6 7 8 9 J Q K A bj'), ...s.hands.slice(1)], turn: 0, lastPlay: prev }, 0);
    const cs = candidates(v, { type: 'play', cards: [v.hand[0]], as: { kind: 'single', main: 4 } });
    expect(cs.some((a) => a.type === 'play' && a.as?.kind === 'single' && a.as.main === 17)).toBe(true);
    expect(cs.length).toBeLessThanOrEqual(6);
  });

  it('对家剩一对时，首攻能拆出小对喂给他', () => {
    const s = endgame(5, 200);
    const v = view({ ...s, hands: [hand('3 3 3 4 4 4 7 8'), s.hands[1], hand('9 9'), s.hands[3]], turn: 0, lastPlay: null }, 0);
    const cs = candidates(v, ruleDecide(v));
    expect(cs.some((a) => a.type === 'play' && a.as?.kind === 'pair' && a.as.main === 3)).toBe(true);
  });

  it('采样遵守贡牌上限，配牌和公开还回来的更大牌不受限', () => {
    const s = endgame(11, 200);
    const hands = [['S13a', 'H14a'], ['J17a', 'H02a', 'S05a'], ['J16a', 'S03a', 'S04a'], ['C06a']];
    const remaining = new Set(hands.flat());
    const tribute = {
      givers: [1], gifts: [{ from: 1, card: 'S13a' }], pairs: [{ from: 1, to: 0, card: 'S13a' }],
      returns: [{ from: 0, to: 1, card: 'J17a' }], resisted: false, leader: 1,
    };
    const v = view({ ...s, hands, tribute, history: [{ seat: 2, cards: makeDeck().filter((c) => !remaining.has(c)) }] }, 3);
    let sampledWild = false;
    for (let k = 0; k < 30; k++) {
      const sample = deal(v, SeededRng.fromSeed(k));
      expect(sample.map((h) => h.length)).toEqual(v.counts);
      expect(new Set(sample.flat()).size).toBe(remaining.size);
      expect(sample.flat().slice().sort()).toEqual([...remaining].sort());
      expect(sample[0]).toContain('S13a');
      expect(sample[1]).toContain('J17a');
      expect(sample[1].every((c) => c === 'J17a' || isWild(c, v.level) || valueOf(c, v.level) <= 13)).toBe(true);
      sampledWild ||= sample[1].includes('H02a');
    }
    expect(sampledWild).toBe(true);
  });

  it('整场比单副升级更重视过 A 和避免退回 2，单副模式仍按升级算', () => {
    const h: HandSummary = {
      hand: 1, level: 14, order: [0, 1, 2], place: [1, 2, 3, 4], winTeam: 0, up: 2,
      levelsBefore: [14, 10], levelsAfter: [14, 10], passedA: true, resetTeam: null, leftover: [],
    };
    const ordinary = { ...h, passedA: false, up: 3 };
    expect(handValue(h, 0, true)).toBeGreaterThan(handValue(ordinary, 0, true));
    expect(handValue(h, 1, true)).toBeLessThan(handValue(ordinary, 1, true));
    expect(handValue({ ...ordinary, resetTeam: 0 }, 0, true)).toBeLessThan(handValue({ ...ordinary, winTeam: 1 }, 0, true));
    expect(handValue({ ...ordinary, resetTeam: 1 }, 0, true)).toBeGreaterThan(handValue(ordinary, 0, true));
    expect(handValue(h, 0, false)).toBe(2);
    expect(handValue(h, 1, false)).toBe(-2);
  });

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
