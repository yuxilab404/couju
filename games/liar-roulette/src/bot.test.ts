import { SeededRng } from '@couju/sdk';
import { expect, it } from 'vitest';
import { choosePlay, decide, suspicion } from './bot.ts';
import { apply, setup, view, type State } from './rules.ts';

function table(hands: string[][]): State {
  return {
    phase: 'playing', n: hands.length, round: 1, table: 'K', hands, undealt: [], turn: 0, plays: [],
    alive: hands.map(() => true), shots: hands.map(() => 0), bullet: hands.map(() => 6),
    showdowns: [], out: [], winner: null,
  };
}

it('声称的张数超过别人手里最多可能有的：一定喊骗子', () => {
  // 3 人局能当 K 的一共 8 张，我手里有 6 张，上家却说出了 3 张 K
  let s = table([['Q1', 'Q2', 'A1', 'A2', 'A3'], ['K1', 'K2', 'K3', 'K4', 'W1'], ['Q3', 'Q4', 'A4', 'A5', 'A6']]);
  s.hands[1] = ['K1', 'K2', 'K3', 'K4', 'W1'];
  s = apply(s, 0, { type: 'play', cards: ['Q1', 'Q2', 'A1'] }, { rng: SeededRng.fromSeed(1) });
  const v = view({ ...s, hands: s.hands.map((h, i) => (i === 1 ? [...h, 'K5'] : h)) }, 1);
  expect(suspicion(v)).toBe(1);
  for (let i = 0; i < 20; i++) expect(decide(v, SeededRng.fromSeed(i))).toEqual({ type: 'liar' });
});

it('有真牌时出的都是自己手里的牌，至少 1 张、至多 3 张', () => {
  for (let seed = 0; seed < 50; seed++) {
    const s = setup({ numPlayers: 4, rng: SeededRng.fromSeed(seed) });
    const v = view(s, s.turn);
    const cards = choosePlay(v, SeededRng.fromSeed(seed));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.length).toBeLessThanOrEqual(3);
    for (const c of cards) expect(v.hand).toContain(c);
  }
});

it('第一手不会喊骗子', () => {
  for (let seed = 0; seed < 50; seed++) {
    const s = setup({ numPlayers: 3, rng: SeededRng.fromSeed(seed) });
    expect(decide(view(s, s.turn), SeededRng.fromSeed(seed)).type).toBe('play');
  }
});
