import { SeededRng, type SeatInfo } from '@couju/sdk';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { decide } from './bot.ts';
import { apply, result, setup, view } from './rules.ts';
import { Board } from './ui.tsx';

const html = (x: string) => x.replace(/<!-- -->/g, '');

it('2–6 人从开局到结束都能渲染：闷牌时看不到自己的牌，结束后全部亮牌', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const seats: SeatInfo[] = Array.from({ length: n }, (_, i) => ({
      seat: i, name: `玩家${i + 1}`, avatarUrl: null, kind: i === 0 ? 'human' : 'bot',
      hosted: false, connected: true, team: null,
    }));
    const rng = SeededRng.fromSeed(n);
    let s = setup({ numPlayers: n, rng });
    const render = (seat: number | null) =>
      html(
        renderToString(
          <Board view={view(s, seat)} seat={seat} seats={seats} act={() => {}} pending={false} error={null}
            timer={{ seats: [s.turn], deadline: Date.now() + 10_000 }} result={result(s)} />,
        ),
      );
    const first = render(s.turn);
    expect(first).toContain(`data-pot="${n}"`);
    expect(first).toContain('闷牌中');
    expect(first).toMatch(/闷跟 1/);
    expect(first).not.toContain('data-card');
    let i = 0;
    while (s.phase !== 'ended' && i++ < 1000) {
      s = apply(s, s.turn, decide(view(s, s.turn), rng));
      render(0);
    }
    expect(s.phase).toBe('ended');
    const end = render(0);
    expect(end).toMatch(/你赢了|你输了/);
    expect(end).toContain('赢下底池');
    for (const c of s.hands.flat()) expect(end).toContain(`data-card="${c}"`);
    expect(render(null)).toContain('旁观');
  }
});

it('比牌后只有比牌的两个人看到对方的牌', () => {
  const seats: SeatInfo[] = [0, 1, 2].map((i) => ({ seat: i, name: `P${i}`, avatarUrl: null, kind: 'human', hosted: false, connected: true, team: null }));
  let s = setup({ numPlayers: 3, rng: SeededRng.fromSeed(9) });
  const t0 = s.turn;
  const t1 = (t0 + 1) % 3;
  const t2 = (t0 + 2) % 3;
  s = apply(s, t0, { type: 'call' });
  s = apply(s, t1, { type: 'call' });
  s = apply(s, t2, { type: 'call' });
  s = apply(s, t0, { type: 'compare', target: t1 });
  const r = (seat: number) =>
    html(renderToString(<Board view={view(s, seat)} seat={seat} seats={seats} act={() => {}} pending={false} error={null} timer={null} result={null} />));
  expect(r(t0)).toContain('比牌');
  for (const c of s.hands[t1]) expect(r(t0)).toContain(`data-card="${c}"`);
  for (const c of [...s.hands[t0], ...s.hands[t1]]) expect(r(t2)).not.toContain(`data-card="${c}"`);
  expect(r(t2)).toContain('输了，出局');
});
