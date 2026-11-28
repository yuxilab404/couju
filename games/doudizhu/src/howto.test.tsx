import { SeededRng } from '@couju/sdk';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { rankOf } from './cards.ts';
import { bombLadder, examples, Rules, singleOrder } from './howto.tsx';
import { beats, isBomb } from './patterns.ts';
import { setup, view } from './rules.ts';

it('每个例子就是标的牌型；四带二不是炸弹，炸弹压得过它们', () => {
  const bomb = bombLadder()[0].pattern;
  for (const e of examples()) {
    expect(e.pattern.kind).toBe(e.kind);
    expect(isBomb(e.pattern)).toBe(false);
    expect(beats(bomb, e.pattern)).toBe(true);
  }
});

it('炸弹从小到大逐个压得过，王炸最大', () => {
  const ladder = bombLadder();
  for (let i = 1; i < ladder.length; i++) {
    expect(beats(ladder[i].pattern, ladder[i - 1].pattern)).toBe(true);
    expect(beats(ladder[i - 1].pattern, ladder[i].pattern)).toBe(false);
  }
  expect(ladder.at(-1)!.pattern.kind).toBe('rocket');
});

it('单张顺序从小到大', () => {
  const r = singleOrder().map(rankOf);
  expect(r).toEqual([...r].sort((a, b) => a - b));
  expect(r).toHaveLength(15);
});

it('等人时和对局中都画得出来', () => {
  expect(renderToString(<Rules numPlayers={3} options={{}} view={null} />)).toContain('王炸');
  const s = setup({ rng: SeededRng.fromSeed(2) });
  renderToString(<Rules numPlayers={3} options={{}} view={view(s, 0)} />);
  const playing = { ...s, phase: 'playing' as const, landlord: 0, baseScore: 2, bombs: 1 };
  expect(renderToString(<Rules numPlayers={3} options={{}} view={view(playing, 1)} />).replace(/<!-- -->/g, '')).toContain('底分 2，现在 ×2');
});
