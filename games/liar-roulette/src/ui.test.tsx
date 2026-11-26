import { SeededRng, type SeatInfo } from '@couju/sdk';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { decide } from './bot.ts';
import { apply, result, setup, view } from './rules.ts';
import { Board } from './ui.tsx';

it('3–5 人从开局到结束都能渲染', () => {
  for (const n of [3, 4, 5]) {
    const seats: SeatInfo[] = Array.from({ length: n }, (_, i) => ({
      seat: i, name: `玩家${i + 1}`, avatarUrl: null, kind: i === 0 ? 'human' : 'bot',
      hosted: false, connected: true, team: null,
    }));
    const rng = SeededRng.fromSeed(n);
    let s = setup({ numPlayers: n, rng });
    const render = (seat: number | null) =>
      renderToString(
        <Board view={view(s, seat)} seat={seat} seats={seats} act={() => {}} pending={false} error={null}
          timer={{ seats: [s.turn], deadline: Date.now() + 10_000 }} result={result(s)} />,
      );
    expect(render(0)).toContain(`data-table="${s.table}"`);
    let i = 0;
    let sawShowdown = false;
    while (s.phase !== 'ended' && i++ < 2000) {
      if (s.showdowns.length > 0 && !sawShowdown) {
        expect(render(0)).toContain('翻开');
        sawShowdown = true;
      }
      s = apply(s, s.turn, decide(view(s, s.turn), rng), { rng });
    }
    expect(s.phase).toBe('ended');
    expect(render(0)).toMatch(/你活到了最后|你输了/);
    expect(render(null)).toContain('旁观');
    expect(render(0)).toContain('出局');
  }
});

it('决出胜负的那一翻也算"刚翻完"：牌桌内的结算等翻牌动画放完', async () => {
  const { revealJustHappened } = await import('./ui.tsx');
  const rng = SeededRng.fromSeed(7);
  let s = setup({ numPlayers: 3, rng });
  let sawMid = false;
  while (s.phase !== 'ended') {
    s = apply(s, s.turn, decide(view(s, s.turn), rng), { rng });
    const v = view(s, 0);
    if (s.phase === 'playing' && v.showdowns.length > 0 && v.claims.length === 0) {
      expect(revealJustHappened(v)).toBe(true);
      sawMid = true;
    }
    if (s.phase === 'playing' && v.claims.length > 0) expect(revealJustHappened(v)).toBe(false);
  }
  expect(sawMid).toBe(true);
  expect(view(s, 0).claims.length).toBeGreaterThan(0);
  expect(revealJustHappened(view(s, 0))).toBe(true);
});
