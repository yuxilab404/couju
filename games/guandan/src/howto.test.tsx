import { SeededRng } from '@couju/sdk';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { bombLadder, plainExamples, Rules, singleOrder } from './howto.tsx';
import { faceOf, valueOf } from './cards.ts';
import { beats, isBomb } from './patterns.ts';
import { DEFAULT_OPTIONS, setup, view } from './rules.ts';

const LEVELS = [2, 3, 5, 7, 10, 11, 12, 13, 14];

describe.each(LEVELS)('打 %i 时', (level) => {
  it('炸弹表从小到大，每一档都压得过上一档、反过来压不过', () => {
    const ladder = bombLadder(level);
    expect(ladder.map((e) => e.name)).toEqual([
      '4 张炸弹', '5 张炸弹', '同花顺', '6 张炸弹', '7 张炸弹', '8 张炸弹', '9 张炸弹', '10 张炸弹', '天王炸',
    ]);
    for (const e of ladder) expect(isBomb(e.pattern), e.name).toBe(true);
    for (let i = 1; i < ladder.length; i++) {
      expect(beats(ladder[i].pattern, ladder[i - 1].pattern), `${ladder[i].name} > ${ladder[i - 1].name}`).toBe(true);
      expect(beats(ladder[i - 1].pattern, ladder[i].pattern)).toBe(false);
    }
    expect(ladder[2].pattern.kind).toBe('straightFlush');
    expect(ladder[8].pattern.kind).toBe('jokerBomb');
  });

  it('普通牌型的例子就是标的牌型，最小的炸弹也压得过它们', () => {
    const smallest = bombLadder(level)[0].pattern;
    for (const e of plainExamples(level)) {
      expect(e.pattern.kind).toBe(e.kind);
      expect(beats(smallest, e.pattern)).toBe(true);
    }
  });

  it('单张顺序从小到大：级牌在 A 上面、小王下面', () => {
    const vals = singleOrder(level).map((id) => valueOf(id, level));
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
    expect(new Set(vals).size).toBe(15);
    expect(faceOf(singleOrder(level)[12], level).badge).toBe('级');
  });
});

it('等人时和对局中都画得出来；对局中写当前打几', () => {
  const idle = renderToString(<Rules numPlayers={4} options={DEFAULT_OPTIONS} view={null} />).replace(/<!-- -->/g, '');
  expect(idle).toContain('炸弹从小到大');
  expect(idle).toContain('天王炸');
  expect(idle).toContain('打 A 累计 3 次没过');
  const s = { ...setup({ rng: SeededRng.fromSeed(1) }), level: 9, hand: 4, levelTeam: 1 };
  const live = renderToString(<Rules numPlayers={4} options={{ length: 'one', aLimit: 3 }} view={view(s, 0)} />).replace(/<!-- -->/g, '');
  expect(live).toContain('第 4 副，<b>打 9</b>');
  expect(live).toContain('只打一副');
  expect(live).not.toContain('次没过');
});
