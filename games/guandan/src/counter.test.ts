import { SeededRng } from '@couju/sdk';
import { expect, it } from 'vitest';
import { decide } from './bot.ts';
import { COUNTER_RANKS, outstanding } from './counter.ts';
import { apply, setup, view } from './rules.ts';

it('记牌器：别人手里每个点数的张数，和实际一致', () => {
  const rng = SeededRng.fromSeed(9);
  let s = setup({ rng, options: { length: 'one' } });
  for (let i = 0; i < 40 && s.phase === 'playing'; i++) {
    const v = view(s, 0);
    const left = outstanding(v);
    for (const r of COUNTER_RANKS) {
      const real = [1, 2, 3].reduce((n, x) => n + s.hands[x].filter((c) => Number(c.slice(1, 3)) === r).length, 0);
      expect(left[r]).toBe(real);
    }
    s = apply(s, s.turn, decide(view(s, s.turn)), { rng });
  }
});
