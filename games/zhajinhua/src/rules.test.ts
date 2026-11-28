import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { apply, callCost, DEFAULT_OPTIONS, pause, privateTokens, result, setup, timer, validate, view, type Action, type State } from './rules.ts';

const rng = () => SeededRng.fromSeed(3);

/** 手工摆一个局面：给定手牌，0 号先行动，庄家是最后一个人 */
function table(hands: string[][], extra: Partial<State> = {}): State {
  const n = hands.length;
  return {
    phase: 'betting', n, options: { ...DEFAULT_OPTIONS }, dealer: n - 1, turn: 0, hands,
    seen: hands.map(() => false), folded: hands.map(() => false), bets: hands.map(() => 1), stake: 1,
    acted: hands.map(() => 0), moves: 0, log: [], compares: [], end: null, ...extra,
  };
}
const AAA = ['S14', 'H14', 'D14'];
const KK = ['S13', 'H13', 'D2'];
const QJ9 = ['S12', 'H11', 'D9'];
const S235 = ['S2', 'H3', 'C5'];

function play(s: State, ...acts: Action[]): State {
  for (const a of acts) {
    const err = validate(s, s.turn, a);
    if (err) throw new Error(`${s.turn}: ${err} ${JSON.stringify(a)}`);
    s = apply(s, s.turn, a);
  }
  return s;
}

describe('开局', () => {
  it('每人 3 张不重复、先下底注，从庄家下家开始', () => {
    for (const n of [2, 6]) {
      const s = setup({ numPlayers: n, rng: rng() });
      expect(s.hands.every((h) => h.length === 3)).toBe(true);
      expect(new Set(s.hands.flat()).size).toBe(n * 3);
      expect(s.bets).toEqual(Array(n).fill(1));
      expect(s.turn).toBe((s.dealer + 1) % n);
      expect(s.options).toEqual(DEFAULT_OPTIONS);
    }
  });

  it('建房选项照着用', () => {
    const s = setup({ numPlayers: 3, options: { maxRounds: 5, blindRounds: 3, beat235: false }, rng: rng() });
    expect(s.options).toEqual({ maxRounds: 5, blindRounds: 3, beat235: false });
  });
});

describe('下注', () => {
  it('闷跟 1 倍，看过 2 倍；加注提单注，后面的人按新单注跟', () => {
    let s = table([QJ9, KK, AAA]);
    s = play(s, { type: 'call' });
    expect(s.bets[0]).toBe(2);
    s = play(s, { type: 'look' });
    expect(s.turn).toBe(1); // 看牌不算一次行动
    expect(s.seen[1]).toBe(true);
    expect(callCost(s, 1)).toBe(2);
    s = play(s, { type: 'raise', stake: 3 });
    expect(s.stake).toBe(3);
    expect(s.bets[1]).toBe(1 + 6);
    s = play(s, { type: 'call' });
    expect(s.bets[2]).toBe(1 + 3);
    expect(s.log.map((e) => e.type)).toEqual(['call', 'look', 'raise', 'call']);
    expect(s.log[2]).toMatchObject({ seat: 1, cost: 6, stake: 3, blind: false });
  });

  it('不合法的操作', () => {
    const s = table([QJ9, KK, AAA]);
    expect(validate(s, 1, { type: 'call' })).toMatch(/没轮到/);
    expect(validate(s, 0, { type: 'raise', stake: 1 })).toMatch(/大/);
    expect(validate(s, 0, { type: 'raise', stake: 4 })).toMatch(/档/);
    expect(validate(s, 0, { type: 'compare', target: 1 })).toMatch(/第一轮/);
    const seen = play(s, { type: 'look' });
    expect(validate(seen, 0, { type: 'look' })).toMatch(/看过/);
    const blind = table([QJ9, KK], { options: { ...DEFAULT_OPTIONS, blindRounds: 1 } });
    expect(validate(blind, 0, { type: 'look' })).toMatch(/必须闷/);
    const r2 = play(blind, { type: 'call' }, { type: 'call' });
    expect(validate(r2, 0, { type: 'look' })).toBeNull();
  });
});

describe('比牌', () => {
  it('从第二轮起付跟注的钱比，输的出局；只剩一人就结束，赢家拿底池', () => {
    let s = table([KK, QJ9]);
    s = play(s, { type: 'call' }, { type: 'call' });
    expect(validate(s, 0, { type: 'compare', target: 0 })).toMatch(/选一个/);
    s = play(s, { type: 'compare', target: 1 });
    expect(s.compares).toEqual([{ a: 0, b: 1, loser: 1, auto: false }]);
    expect(s.phase).toBe('ended');
    expect(s.end).toEqual({ reason: 'compare', winner: 0 });
    const r = result(s)!;
    expect(r.winners).toEqual([0]);
    expect(r.scores).toEqual([2, -2]);
    expect(r.scores!.reduce((a, b) => a + b, 0)).toBe(0);
    expect(r.summary).toContain('对子');
  });

  it('一样大算主动比的人输；只有比牌的两个人看得到对方的牌', () => {
    let s = table([['S14', 'D10', 'H7'], ['C14', 'H10', 'D7'], QJ9]);
    s = play(s, { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'compare', target: 1 });
    expect(s.folded).toEqual([true, false, false]);
    expect(s.turn).toBe(1);
    expect(view(s, 1).hands[0]).toEqual(s.hands[0]);
    expect(view(s, 0).hands[1]).toEqual(s.hands[1]);
    expect(view(s, 2).hands[0]).toBeNull();
    expect(view(s, 2).hands[1]).toBeNull();
    expect(view(s, null).hands.every((h) => h === null)).toBe(true);
    // 被比的人没看过自己的牌，还是闷着
    expect(view(s, 1).hands[1]).toBeNull();
    expect(s.seen[1]).toBe(false);
    expect(privateTokens(s, 1)).toEqual([]);
    expect(privateTokens(s, 2)).toEqual(QJ9);
    expect(pause(s)).toBeGreaterThan(0);
  });

  it('235 吃豹子按房间设置', () => {
    const on = play(table([S235, AAA]), { type: 'call' }, { type: 'call' }, { type: 'compare', target: 1 });
    expect(on.end?.winner).toBe(0);
    const off = play(table([S235, AAA], { options: { ...DEFAULT_OPTIONS, beat235: false } }), { type: 'call' }, { type: 'call' }, { type: 'compare', target: 1 });
    expect(off.end?.winner).toBe(1);
  });
});

describe('结束', () => {
  it('都弃牌了剩下的人拿底池，不用比牌', () => {
    const s = play(table([QJ9, KK, AAA]), { type: 'call' }, { type: 'fold' }, { type: 'fold' });
    expect(s.end).toEqual({ reason: 'fold', winner: 0 });
    expect(result(s)!.scores).toEqual([2, -1, -1]);
    expect(result(s)!.summary).toContain('都弃牌');
    // 结束后全部亮牌
    expect(view(s, 1).hands).toEqual(s.hands);
    expect(timer(s)).toBeNull();
  });

  it('封顶：每人都行动满就从下一个人起按座次系统比牌', () => {
    let s = table([QJ9, AAA, KK], { options: { ...DEFAULT_OPTIONS, maxRounds: 2 } });
    s = play(s, { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' });
    expect(s.phase).toBe('betting');
    s = play(s, { type: 'call' });
    expect(s.phase).toBe('ended');
    expect(s.end).toEqual({ reason: 'cap', winner: 1 });
    expect(s.compares).toEqual([
      { a: 1, b: 0, loser: 0, auto: true },
      { a: 2, b: 1, loser: 2, auto: true },
    ]);
    expect(result(s)!.summary).toContain('2 轮封顶');
  });

  it('看牌不重新计时，下注会', () => {
    const s = table([QJ9, KK]);
    const k = timer(s)!.key;
    expect(timer(play(s, { type: 'look' }))!.key).toBe(k);
    expect(timer(play(s, { type: 'call' }))!.key).not.toBe(k);
  });

  it('没看牌时自己也看不到自己的牌，看了或弃了才看得到', () => {
    let s = table([QJ9, KK, AAA]);
    expect(view(s, 0).hands[0]).toBeNull();
    s = play(s, { type: 'look' });
    expect(view(s, 0).hands[0]).toEqual(QJ9);
    s = play(s, { type: 'call' }, { type: 'fold' });
    expect(view(s, 1).hands[1]).toEqual(KK);
  });
});
