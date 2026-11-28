import { SeededRng } from '@couju/sdk';
import { expect, it } from 'vitest';
import { decide, strength } from './bot.ts';
import { apply, DEFAULT_OPTIONS, result, setup, validate, view, type Action, type State, type View } from './rules.ts';

it('牌力：豹子接近 1，最小的单张接近 0，对子比单张大', () => {
  expect(strength(['S14', 'H14', 'D14'])).toBeGreaterThan(0.999);
  expect(strength(['S2', 'H3', 'D5'])).toBeLessThan(0.01);
  expect(strength(['S9', 'H9', 'D2'])).toBeGreaterThan(strength(['S14', 'H13', 'D11']));
});

it('第一轮不比牌；必闷轮内不看牌；出的动作都合法', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = setup({ numPlayers: 4, options: { ...DEFAULT_OPTIONS, blindRounds: 1 }, rng: SeededRng.fromSeed(seed) });
    const a = decide(view(s, s.turn), SeededRng.fromSeed(seed));
    expect(['call', 'raise']).toContain(a.type);
    expect(validate(s, s.turn, a)).toBeNull();
  }
});

it('看过牌拿到豹子不弃牌', () => {
  const s: State = {
    ...setup({ numPlayers: 3, rng: SeededRng.fromSeed(1) }),
    hands: [['S14', 'H14', 'D14'], ['S2', 'H4', 'D7'], ['C2', 'C9', 'H11']], turn: 0, seen: [true, false, false],
  };
  for (let i = 0; i < 50; i++) expect(decide(view(s, 0), SeededRng.fromSeed(i)).type).not.toBe('fold');
});

it('赢得过只会跟注的人（4 人桌，2000 局平均每局净赚）', () => {
  const station = (): Action => ({ type: 'call' });
  let total = 0;
  for (let g = 0; g < 2000; g++) {
    const rng = SeededRng.fromSeed(g);
    let s = setup({ numPlayers: 4, rng });
    const me = g % 4;
    while (s.phase !== 'ended') {
      const v: View = view(s, s.turn);
      s = apply(s, s.turn, s.turn === me ? decide(v, rng) : station());
    }
    total += result(s)!.scores![me];
  }
  expect(total / 2000).toBeGreaterThan(3);
});
