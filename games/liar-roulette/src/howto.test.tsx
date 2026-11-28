import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { fireChance, Rules } from './howto.tsx';

it('按人数写牌数，左轮概率表到第六枪必响', () => {
  const html = (n: number) => renderToString(<Rules numPlayers={n} options={{}} view={null} />).replace(/<!-- -->/g, '');
  expect(html(3)).toContain('一共 20 张');
  expect(html(5)).toContain('一共 26 张');
  expect([0, 1, 2, 3, 4, 5].map(fireChance)).toEqual(['1/6', '1/5', '1/4', '1/3', '1/2', '必响']);
});
