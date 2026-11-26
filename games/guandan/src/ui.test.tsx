import { SeededRng, type SeatInfo } from '@couju/sdk';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { decide } from './bot.ts';
import { active, apply, result, setup, view, type State } from './rules.ts';
import { hand } from './testhand.ts';
import { Board } from './ui.tsx';

const seats: SeatInfo[] = [0, 1, 2, 3].map((i) => ({
  seat: i, name: ['小明', '电脑 A', '阿花', '电脑 B'][i], avatarUrl: null, kind: i % 2 ? 'bot' : 'human',
  hosted: false, connected: true, team: i % 2,
}));

/** 去掉 React 在相邻文本之间插的注释，方便按文字断言 */
function render(s: State, seat: number | null) {
  return renderHtml(s, seat).replace(/<!-- -->/g, '');
}
function renderHtml(s: State, seat: number | null) {
  return renderToString(
    <Board view={view(s, seat)} seat={seat} seats={seats} act={() => {}} pending={false} error={null}
      timer={{ seats: active(s), deadline: Date.now() + 10_000 }} result={result(s)} />,
  );
}

it('整场各阶段都能渲染：出牌、一副结束、进贡、还贡、结束', () => {
  const rng = SeededRng.fromSeed(3);
  let s = setup({ rng });
  expect(render(s, s.turn)).toContain('出牌');
  expect(render(s, 0)).toContain('打 2');
  const seen = new Set<string>();
  for (let i = 0; i < 40_000 && s.phase !== 'ended'; i++) {
    if (!seen.has(s.phase)) {
      seen.add(s.phase);
      const html = render(s, active(s)[0] ?? 0);
      if (s.phase === 'handOver') expect(html).toMatch(/第 1 副结束/);
      if (s.phase === 'tribute') expect(html).toContain('进贡');
      if (s.phase === 'return') expect(html).toContain('还贡');
      render(s, null);
    }
    const seat = active(s)[0];
    s = apply(s, seat, decide(view(s, seat)), { rng });
  }
  expect(s.phase).toBe('ended');
  expect([...seen].sort()).toEqual(['handOver', 'playing', 'return', 'tribute']);
  const html = render(s, 0);
  expect(html).toMatch(/你们赢了|你们输了/);
  expect(html).toContain('过 A');
});

it('桌上那一手写出它算作什么：两张配牌 + 456 当 4–8 的顺子', () => {
  const s0 = setup({ rng: SeededRng.fromSeed(1) });
  const cards = hand('h2 h2 4 5 6');
  const s: State = {
    ...s0,
    hands: [hand('9 10'), hand('3'), hand('K'), hand('Q')],
    turn: 2,
    recent: [null, cards, null, null],
    lastPlay: { kind: 'straight', main: 8, size: 5, seat: 1, cards },
  };
  const html = render(s, 0);
  expect(html).toContain('data-declared="1"');
  expect(html).toContain('顺子 4–8');
});
