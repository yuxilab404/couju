import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { makeDeck } from './cards.ts';
import { hand } from './testhand.ts';
import { active, apply, privateTokens, result, setup, validate, view, type Action, type State } from './rules.ts';

const rng = () => SeededRng.fromSeed(1);

/** 出牌阶段，手牌直接指定 */
function playing(hands: string[], over: Partial<State> = {}): State {
  const s = setup({ rng: rng() });
  return { ...s, hands: hands.map(hand), turn: 0, ...over };
}

function run(s: State, steps: [number, Action][]): State {
  for (const [seat, a] of steps) {
    const err = validate(s, seat, a);
    if (err) throw new Error(`座位 ${seat} ${JSON.stringify(a)}：${err}`);
    s = apply(s, seat, a, { rng: rng() });
  }
  return s;
}
const play = (spec: string): Action => ({ type: 'play', cards: hand(spec) });
const pass: Action = { type: 'pass' };

describe('发牌', () => {
  it('每人 27 张，正好两副牌', () => {
    const s = setup({ rng: rng() });
    expect(s.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
    expect(s.hands.flat().sort()).toEqual(makeDeck().sort());
    expect(new Set(makeDeck()).size).toBe(108);
    expect(s.level).toBe(2);
  });
});

describe('出牌', () => {
  it('不能不出领出；管不上要说清楚', () => {
    const s = playing(['3 4', '5 6', '7 8', '9 10']);
    expect(validate(s, 0, pass)).toMatch(/不能不出/);
    const t = run(s, [[0, play('3')]]);
    expect(t.turn).toBe(1);
    expect(validate(t, 1, play('5 6'))).toMatch(/不是合法|管不上/);
    expect(validate(t, 2, play('7'))).toMatch(/轮到/);
  });

  it('三家都不要，回到出牌的人', () => {
    const s = playing(['3 4', '5 6', '7 8', '9 10']);
    const t = run(s, [[0, play('4')], [1, pass], [2, pass], [3, pass]]);
    expect(t.turn).toBe(0);
    expect(t.lastPlay).toBeNull();
  });

  it('出完的人没人接得住：对家接风', () => {
    const s = playing(['A', '5 6', '7 8', '9 10']);
    const t = run(s, [[0, play('A')], [1, pass], [2, pass], [3, pass]]);
    expect(t.finished).toEqual([0]);
    expect(t.turn).toBe(2);
    expect(t.lastPlay).toBeNull();
  });

  it('出完后有人管上，照常轮转（跳过出完的人）', () => {
    const s = playing(['3', '5 6', '7 8', '9 10']);
    const t = run(s, [[0, play('3')], [1, play('6')], [2, pass], [3, pass]]);
    expect(t.turn).toBe(1);
  });
});

describe('一副结束与升级', () => {
  it('双上：升 3 级，打一副的局直接结束', () => {
    const s = playing(['A', '3 4', 'K', '5 6'], { opts: { length: 'one', aLimit: 3 } });
    const t = run(s, [[0, play('A')], [1, pass], [2, pass], [3, pass], [2, play('K')]]);
    expect(t.phase).toBe('ended');
    expect(t.lastHand!.up).toBe(3);
    expect(t.teamLevels).toEqual([5, 2]);
    const r = result(t)!;
    expect(r.winners).toEqual([0, 2]);
    expect(r.scores).toEqual([3, -3, 3, -3]);
    expect(r.summary).toMatch(/双上/);
    expect(r.weight).toBe(1);
  });

  it('头游 + 末游：升 1 级，进入下一副；四个人都点继续才发牌', () => {
    const s = playing(['A', 'K', '3 4', 'Q']);
    let t = run(s, [[0, play('A')], [1, pass], [2, pass], [3, pass], [2, play('3')], [3, play('Q')], [1, play('K')]]);
    expect(t.phase).toBe('handOver');
    expect(t.lastHand!.order).toEqual([0, 3, 1]);
    expect(t.lastHand!.up).toBe(1);
    expect(t.teamLevels).toEqual([3, 2]);
    expect(active(t)).toEqual([0, 1, 2, 3]);
    t = run(t, [[0, { type: 'ready' }], [1, { type: 'ready' }], [3, { type: 'ready' }]]);
    expect(active(t)).toEqual([2]);
    t = run(t, [[2, { type: 'ready' }]]);
    expect(t.hand).toBe(2);
    expect(t.level).toBe(3);
    expect(t.levelTeam).toBe(0);
    // 末游是座位 2，给头游座位 0 进贡（除非抗贡）
    if (t.phase === 'tribute') expect(active(t)).toEqual([2]);
    else expect(t.tribute!.resisted).toBe(true);
  });
});

/** 一副结束后的局面：order 是出完顺序 */
function afterHand(order: number[], over: Partial<State> = {}): State {
  const place = [4, 4, 4, 4];
  order.forEach((x, i) => (place[x] = i + 1));
  const s = setup({ rng: rng() });
  return {
    ...s,
    phase: 'handOver',
    ready: [true, true, true, false],
    lastHand: {
      hand: 1, level: 2, order, place, winTeam: order[0] % 2, up: 1, levelsBefore: [2, 2],
      levelsAfter: [3, 2], passedA: false, resetTeam: null, leftover: [[], [], [], []],
    },
    teamLevels: [3, 2],
    ...over,
  };
}

/** 找一个种子，让下一副发出来的牌满足条件 */
function seedWhere(s: State, ok: (t: State) => boolean): State {
  for (let seed = 1; seed < 500; seed++) {
    const t = apply(s, 3, { type: 'ready' }, { rng: SeededRng.fromSeed(seed) });
    if (ok(t)) return t;
  }
  throw new Error('找不到合适的种子');
}

describe('进贡', () => {
  it('单贡：末游进最大的牌，头游还 10 以下的牌，进贡的人先出', () => {
    let t = seedWhere(afterHand([0, 1, 3]), (x) => x.phase === 'tribute');
    expect(active(t)).toEqual([2]);
    const big = t.hands[2].find((c) => c[0] !== 'H' || c.slice(1, 3) !== '03')!;
    const ranked = t.hands[2].filter((c) => !(c[0] === 'H' && c.slice(1, 3) === '03'));
    const lowest = ranked[ranked.length - 1];
    if (lowest !== big) expect(validate(t, 2, { type: 'tribute', card: lowest })).toMatch(/最大/);
    t = run(t, [[2, { type: 'tribute', card: big }]]);
    expect(t.phase).toBe('return');
    expect(t.hands[0]).toContain(big);
    expect(t.hands[0]).toHaveLength(28);
    expect(active(t)).toEqual([0]);
    const high = t.hands[0].find((c) => Number(c.slice(1, 3)) > 10 && c[0] !== 'J');
    if (high) expect(validate(t, 0, { type: 'return', card: high })).toMatch(/10 以下/);
    const low = t.hands[0].find((c) => c[0] !== 'J' && Number(c.slice(1, 3)) <= 10)!;
    t = run(t, [[0, { type: 'return', card: low }]]);
    expect(t.phase).toBe('playing');
    expect(t.turn).toBe(2);
    expect(t.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
    expect(t.hands[2]).toContain(low);
    // 进贡、还贡的牌是公开的，不算私有信息
    expect(privateTokens(t, 0)).not.toContain(big);
    expect(JSON.stringify(view(t, 1))).toContain(big);
  });

  it('双下：两人都进贡，大的给头游、小的给二游', () => {
    let t = seedWhere(afterHand([0, 2]), (x) => x.phase === 'tribute');
    expect(active(t).sort()).toEqual([1, 3]);
    const top = (seat: number) => t.hands[seat].find((c) => !(c[0] === 'H' && c.slice(1, 3) === '03'))!;
    const c1 = top(1), c3 = top(3);
    t = run(t, [[3, { type: 'tribute', card: c3 }], [1, { type: 'tribute', card: c1 }]]);
    expect(t.phase).toBe('return');
    const toFirst = t.tribute!.pairs.find((p) => p.to === 0)!;
    const toSecond = t.tribute!.pairs.find((p) => p.to === 2)!;
    expect(toFirst).toBeTruthy();
    expect(toSecond).toBeTruthy();
    expect(active(t).sort()).toEqual([0, 2]);
    expect(t.tribute!.leader).toBe(toFirst.from);
  });

  it('进贡的人手里有两个大王：抗贡，头游先出', () => {
    const t = seedWhere(afterHand([1, 0, 2]), (x) => x.tribute?.resisted === true);
    expect(t.phase).toBe('playing');
    expect(t.turn).toBe(1);
    expect(t.hands[3].filter((c) => c.startsWith('J17'))).toHaveLength(2);
  });
});

describe('打 A', () => {
  it('打自己的 A 拿头游、对家不是末游：过 A，整场结束', () => {
    const s = playing(['A', '3 4', 'K', '5 6'], { level: 14, levelTeam: 0, teamLevels: [14, 9] });
    const t = run(s, [[0, play('A')], [1, pass], [2, pass], [3, pass], [2, play('K')]]);
    expect(t.phase).toBe('ended');
    expect(t.lastHand!.passedA).toBe(true);
    expect(result(t)!.winners).toEqual([0, 2]);
    expect(result(t)!.summary).toMatch(/过 A/);
    expect(result(t)!.weight).toBe(2);
  });

  it('头游 + 末游不算过 A；三次不过回到 2', () => {
    const s = playing(['3', 'K', '4 5', 'Q'], { level: 14, levelTeam: 0, teamLevels: [14, 9], aFails: [2, 0] });
    const t = run(s, [[0, play('3')], [1, pass], [2, pass], [3, pass], [2, play('4')], [3, play('Q')], [1, play('K')]]);
    expect(t.phase).toBe('handOver');
    expect(t.lastHand!.passedA).toBe(false);
    expect(t.lastHand!.resetTeam).toBe(0);
    expect(t.teamLevels).toEqual([2, 9]);
  });

  it('不限次数时一直打 A', () => {
    const s = playing(['3', 'K', '4 5', 'Q'], {
      level: 14, levelTeam: 0, teamLevels: [14, 9], aFails: [5, 0], opts: { length: 'full', aLimit: 0 },
    });
    const t = run(s, [[0, play('3')], [1, pass], [2, pass], [3, pass], [2, play('4')], [3, play('Q')], [1, play('K')]]);
    expect(t.teamLevels).toEqual([14, 9]);
    expect(t.aFails).toEqual([6, 0]);
  });

  it('升级封顶到 A', () => {
    const s = playing(['A', '3 4', 'K', '5 6'], { level: 12, levelTeam: 0, teamLevels: [12, 2] });
    const t = run(s, [[0, play('A')], [1, pass], [2, pass], [3, pass], [2, play('K')]]);
    expect(t.teamLevels).toEqual([14, 2]);
    expect(t.phase).toBe('handOver');
  });
});
