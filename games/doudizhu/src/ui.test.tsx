import { SeededRng, type SeatInfo } from '@couju/sdk';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { decide } from './bot.ts';
import { apply, result, setup, view } from './rules.ts';
import { Board } from './ui.tsx';

const seats: SeatInfo[] = [0, 1, 2].map((i) => ({
  seat: i, name: ['小明', '电脑 A', '阿花'][i], avatarUrl: null, kind: i === 1 ? 'bot' : 'human',
  hosted: false, connected: true, team: null,
}));

it('各阶段都能渲染', () => {
  const rng = SeededRng.fromSeed(5);
  let s = setup({ rng });
  const render = (seat: number | null) =>
    renderToString(
      <Board view={view(s, seat)} seat={seat} seats={seats} act={() => {}} pending={false} error={null}
        timer={{ seats: [s.turn], deadline: Date.now() + 10_000 }} result={result(s)} />,
    );
  expect(render(s.turn)).toContain('叫分');
  let i = 0;
  while (s.phase !== 'ended' && i++ < 500) {
    if (i === 5) expect(render(0)).toContain('倍数');
    s = apply(s, s.turn, decide(view(s, s.turn)), { rng });
  }
  const html = render(0);
  expect(html).toMatch(/你赢了|你输了/);
  expect(render(null)).toContain('旁观');

  // 打完后牌桌上摊开每个人剩下的牌：两个对手在座位上，旁观者连座位 1 也看得到
  const leftovers = (h: string) => [...h.matchAll(/data-leftover="(\d)"/g)].map((m) => Number(m[1])).sort();
  expect(leftovers(html)).toEqual([1, 2]);
  expect(leftovers(render(null))).toEqual([0, 1, 2]);
  for (const seat of [0, 1, 2]) {
    for (const c of s.hands[seat]) expect(render(null)).toContain(`data-card="${c}"`);
  }
});
