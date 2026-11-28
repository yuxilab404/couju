import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { decide as ruleDecide } from './bot.ts';
import { countNatural, wildsOf } from './cards.ts';
import { preserveFlush } from './preserve-flush.ts';
import { decide } from './searchbot.ts';
import { active, apply, setup, validate, view, type Action, type View } from './rules.ts';

const flush = ['S03a', 'S04a', 'S05a', 'S06a', 'S07a'];
function viewOf(hand: string[]): View {
  const s = setup({ rng: SeededRng.fromSeed(1), options: { length: 'one' } });
  return view({ ...s, hands: [hand, ['C08a'], ['D09a'], ['H10a']], turn: 0 }, 0);
}
const single = (card: string): Action => ({ type: 'play', cards: [card], as: { kind: 'single', main: 3 } });

describe('最终出牌保留同花顺', () => {
  it('同点有其他花色时留下唯一同花顺', () => {
    const v = viewOf([...flush, 'H03a']);
    expect(preserveFlush(v, single('S03a'))).toEqual(single('H03a'));
  });

  it('同花色有两副时可出一张，第二张用其他花色替代', () => {
    const v = viewOf([...flush, 'S03b', 'H03a']);
    const action: Action = { type: 'play', cards: ['S03a', 'S03b'], as: { kind: 'pair', main: 3 } };
    expect(preserveFlush(v, action)).toEqual({ ...action, cards: ['S03a', 'H03a'] });
  });

  it('识别配牌补全的同花顺，同时保留出牌原定的配牌', () => {
    const v = viewOf(['S03a', 'S04a', 'S06a', 'S07a', 'H02a', 'H02b', 'H03a']);
    const action: Action = { type: 'play', cards: ['S03a', 'H02b'], as: { kind: 'pair', main: 3 } };
    expect(preserveFlush(v, action)).toEqual({ ...action, cards: ['H03a', 'H02b'] });
  });

  it('没有花色选择、没有同花顺、过牌和直接出同花顺都原样返回', () => {
    const noChoice = single('S03a');
    expect(preserveFlush(viewOf(flush), noChoice)).toBe(noChoice);
    expect(preserveFlush(viewOf(['S03a', 'H03a', 'C09a']), noChoice)).toBe(noChoice);
    const pass: Action = { type: 'pass' };
    expect(preserveFlush(viewOf(flush), pass)).toBe(pass);
    const action: Action = { type: 'play', cards: flush, as: { kind: 'straightFlush', main: 7 } };
    expect(preserveFlush(viewOf([...flush, 'H03a']), action)).toBe(action);
  });

  it('真实出口的规则回退应用花色选择，取消时保留原回退动作', async () => {
    const v = { ...viewOf([...flush, 'H03a']), counts: [6, 27, 27, 27] };
    expect(await decide(v)).toEqual(single('H03a'));
    expect(await decide(v, AbortSignal.abort())).toEqual(ruleDecide(v));
  });

  it('真实牌局保持原动作的点数、配牌和牌型，并逐步校验合法性', () => {
    for (let seed = 0; seed < 26; seed++) {
      const rng = SeededRng.fromSeed(91000 + seed);
      const level = 2 + seed % 13;
      let s = setup({ rng, options: { length: 'one' } });
      s = { ...s, level, teamLevels: [level, level] };
      while (s.phase !== 'ended') {
        const seat = active(s)[0];
        const v = view(s, seat);
        const original = ruleDecide(v);
        const action = preserveFlush(v, original);
        expect(validate(s, seat, action)).toBeNull();
        if (action.type === 'play' && original.type === 'play') {
          expect(countNatural(action.cards, level)).toEqual(countNatural(original.cards, level));
          expect(wildsOf(action.cards, level)).toEqual(wildsOf(original.cards, level));
          expect(action.as).toEqual(original.as);
        }
        s = apply(s, seat, action, { rng });
      }
    }
  });
});
