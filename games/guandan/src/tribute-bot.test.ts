import { SeededRng } from '@couju/sdk';
import { expect, it } from 'vitest';
import { decide } from './bot.ts';
import { setup, view, type State } from './rules.ts';
import { hand } from './testhand.ts';

function exchange(phase: 'tribute' | 'return', cards: string[], level: number) {
  const s: State = setup({ rng: SeededRng.fromSeed(1) });
  return decide(view({ ...s, phase, level, hands: [cards, ...s.hands.slice(1)] }, 0));
}

it('有两张最大的 A 可进贡时，给对手不在同花顺里的那张', () => {
  const cards = hand('hA cA hK hQ hJ h10');
  expect(exchange('tribute', cards, 2)).toEqual({ type: 'tribute', card: 'C14a' });
});

it('还贡时保住逢人配，只有配牌合规时照常还', () => {
  expect(exchange('return', hand('h5 9 9'), 5)).toMatchObject({ type: 'return', card: hand('9')[0] });
  expect(exchange('return', hand('h5 Q K A'), 5)).toEqual({ type: 'return', card: 'H05a' });
});
