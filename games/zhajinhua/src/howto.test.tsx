import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EXAMPLES, Rules } from './howto.tsx';
import { classify, compareHands } from './patterns.ts';
import { DEFAULT_OPTIONS } from './rules.ts';

it('例牌真是标的牌型，并且从上到下一个压一个', () => {
  for (const e of EXAMPLES) expect(classify(e.cards).kind).toBe(e.kind);
  for (let i = 1; i < EXAMPLES.length; i++) expect(compareHands(EXAMPLES[i - 1].cards, EXAMPLES[i].cards, false)).toBeGreaterThan(0);
});

it('按房间设置写 235、必闷和封顶轮数', () => {
  const html = (o = {}) =>
    renderToString(<Rules numPlayers={4} options={{ ...DEFAULT_OPTIONS, ...o }} view={null} />).replace(/<!-- -->/g, '');
  expect(html()).toContain('235 吃豹子');
  expect(html()).toContain('10 轮');
  expect(html({ beat235: false })).toContain('235 就是一手普通的单张');
  expect(html({ blindRounds: 3, maxRounds: 20 })).toContain('前 3 轮必须闷着');
  expect(html({ blindRounds: 3, maxRounds: 20 })).toContain('20 轮');
});
