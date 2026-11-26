import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { makeDeck, matchingTotal } from './cards.ts';
import { apply, mustCallLiar, pause, result, setup, showdownTimeline, validate, view, type State } from './rules.ts';

const rng = () => SeededRng.fromSeed(7);

/** 手工摆一个局面：每人给定手牌，本轮点数 K，0 号先出 */
function table(hands: string[][], extra: Partial<State> = {}): State {
  const n = hands.length;
  return {
    phase: 'playing', n, round: 1, table: 'K', hands, undealt: [], turn: 0, plays: [],
    alive: hands.map(() => true), shots: hands.map(() => 0), bullet: hands.map(() => 6),
    showdowns: [], out: [], winner: null, ...extra,
  };
}

describe('发牌', () => {
  it('3–4 人 20 张，5 人 26 张；每人 5 张', () => {
    expect(makeDeck(3)).toHaveLength(20);
    expect(makeDeck(4)).toHaveLength(20);
    expect(makeDeck(5)).toHaveLength(26);
    expect(matchingTotal(5)).toBe(10);
    for (const n of [3, 4, 5]) {
      const s = setup({ numPlayers: n, rng: rng() });
      expect(s.hands.every((h) => h.length === 5)).toBe(true);
      expect(new Set(s.hands.flat().concat(s.undealt)).size).toBe(makeDeck(n).length);
      expect(s.bullet.every((b) => b >= 1 && b <= 6)).toBe(true);
    }
  });
});

describe('出牌与质疑', () => {
  it('第一手不能喊骗子；一次 1–3 张；只能出自己的牌', () => {
    const s = table([['K1', 'Q1', 'A1', 'W1', 'K2'], ['Q2', 'Q3', 'A2', 'A3', 'K3'], ['A4', 'A5', 'Q4', 'Q5', 'K4']]);
    expect(validate(s, 0, { type: 'liar' })).toMatch(/第一个/);
    expect(validate(s, 1, { type: 'play', cards: ['Q2'] })).toMatch(/没轮到/);
    expect(validate(s, 0, { type: 'play', cards: [] })).toMatch(/1 到 3/);
    expect(validate(s, 0, { type: 'play', cards: ['K1', 'Q1', 'A1', 'W1'] })).toMatch(/1 到 3/);
    expect(validate(s, 0, { type: 'play', cards: ['Q2'] })).toMatch(/没有/);
    expect(validate(s, 0, { type: 'play', cards: ['K1', 'K1'] })).toMatch(/重复/);
    expect(validate(s, 0, { type: 'play', cards: ['K1', 'W1'] })).toBeNull();
  });

  it('翻开是真的（王算万能）：喊的人扣扳机，然后重新发牌由他先出', () => {
    let s = table([['K1', 'W1', 'Q1', 'A1', 'K2'], ['Q2', 'Q3', 'A2', 'A3', 'K3'], ['A4', 'A5', 'Q4', 'Q5', 'K4']]);
    s = apply(s, 0, { type: 'play', cards: ['K1', 'W1'] }, { rng: rng() });
    expect(s.turn).toBe(1);
    expect(s.hands[0]).toHaveLength(3);
    s = apply(s, 1, { type: 'liar' }, { rng: rng() });
    const d = s.showdowns[0];
    expect(d).toMatchObject({ accuser: 1, accused: 0, lied: false, shooter: 1, shot: 1, fired: false });
    expect(d.revealed.sort()).toEqual(['K', 'W']);
    expect(s.round).toBe(2);
    expect(s.turn).toBe(1);
    expect(s.plays).toEqual([]);
    expect(s.hands.every((h) => h.length === 5)).toBe(true);
  });

  it('翻开有假牌：出牌的人扣扳机；子弹在这一发就出局', () => {
    let s = table([['K1', 'Q1', 'A1', 'A2', 'K2'], ['Q2', 'Q3', 'A3', 'A4', 'K3'], ['A5', 'A6', 'Q4', 'Q5', 'K4']], {
      bullet: [1, 6, 6],
    });
    s = apply(s, 0, { type: 'play', cards: ['K1', 'Q1'] }, { rng: rng() });
    s = apply(s, 1, { type: 'liar' }, { rng: rng() });
    expect(s.showdowns[0]).toMatchObject({ lied: true, shooter: 0, fired: true });
    expect(s.alive).toEqual([false, true, true]);
    expect(s.out).toEqual([0]);
    expect(s.hands[0]).toEqual([]);
    expect(s.turn).toBe(1); // 中弹的人出局，由他下家先出
  });

  it('没牌的人被跳过；别人都没牌了只能喊骗子', () => {
    let s = table([['K1', 'K2', 'K3'], ['Q1', 'Q2'], ['A1', 'A2', 'A3', 'A4', 'A5']]);
    s = apply(s, 0, { type: 'play', cards: ['K1', 'K2', 'K3'] }, { rng: rng() });
    expect(s.turn).toBe(1);
    s = apply(s, 1, { type: 'play', cards: ['Q1', 'Q2'] }, { rng: rng() });
    expect(s.turn).toBe(2);
    expect(mustCallLiar(s)).toBe(true);
    expect(validate(s, 2, { type: 'play', cards: ['A1'] })).toMatch(/只能喊骗子/);
    expect(validate(s, 2, { type: 'liar' })).toBeNull();
  });

  it('手里没牌又轮到自己（别人都出完了）：只能喊骗子', () => {
    let s = table([['K1'], ['Q1', 'Q2'], ['A1', 'A2']]);
    s = apply(s, 0, { type: 'play', cards: ['K1'] }, { rng: rng() });
    s = apply(s, 1, { type: 'play', cards: ['Q1', 'Q2'] }, { rng: rng() });
    s = apply(s, 2, { type: 'play', cards: ['A1', 'A2'] }, { rng: rng() });
    // 2 号出完，接的人是下一个还有牌的活人；都没牌了就轮到 0 号，只能翻
    expect(s.turn).toBe(0);
    expect(mustCallLiar(s)).toBe(true);
  });

  it('跳过已出局的人', () => {
    let s = table([['K1', 'K2'], [], ['A1', 'A2']], { alive: [true, false, true] });
    s = apply(s, 0, { type: 'play', cards: ['K1'] }, { rng: rng() });
    expect(s.turn).toBe(2);
  });

  it('只剩一个活人就结束；赢家拿 n-1 分，其他人各 -1', () => {
    let s = table([['K1', 'Q1'], [], ['A1', 'A2']], { alive: [true, false, true], bullet: [6, 6, 1], out: [1] });
    s = apply(s, 0, { type: 'play', cards: ['K1'] }, { rng: rng() });
    s = apply(s, 2, { type: 'liar' }, { rng: rng() });
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe(0);
    expect(s.out).toEqual([1, 2]);
    expect(result(s)).toMatchObject({ winners: [0], scores: [2, -1, -1] });
  });

  it('子弹最晚第六发一定响', () => {
    let s = table([['K1', 'K2', 'K3', 'K4', 'K5'], ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'], ['A1', 'A2', 'A3', 'A4', 'A5']], {
      shots: [0, 5, 0],
    });
    s = apply(s, 0, { type: 'play', cards: ['K1'] }, { rng: rng() });
    s = apply(s, 1, { type: 'liar' }, { rng: rng() });
    expect(s.showdowns[0]).toMatchObject({ shooter: 1, shot: 6, fired: true });
  });
});

describe('视图', () => {
  it('看不到别人的牌、扣着的牌和子弹位置；能看到自己扣下的', () => {
    let s = table([['K1', 'Q1', 'A1', 'A2', 'K2'], ['Q2', 'Q3', 'A3', 'A4', 'K3'], ['A5', 'A6', 'Q4', 'Q5', 'K4']]);
    s = apply(s, 0, { type: 'play', cards: ['K1', 'Q1'] }, { rng: rng() });
    const v1 = view(s, 1);
    expect(JSON.stringify(v1)).not.toContain('"K1"');
    expect(JSON.stringify(v1)).not.toContain('bullet');
    expect(v1.claims).toEqual([{ seat: 0, count: 2 }]);
    expect(view(s, 0).myPlays).toEqual([['K1', 'Q1']]);
    expect(view(s, null).hand).toEqual([]);
  });
});

describe('节奏', () => {
  it('刚翻完牌停到动画放完；新一轮有人出过牌就不停', () => {
    let s = table([['K1', 'K2', 'K3', 'K4', 'K5'], ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'], ['A1', 'A2', 'A3', 'A4', 'A5']]);
    expect(pause(s)).toBe(0);
    s = apply(s, 0, { type: 'play', cards: ['K1', 'K2'] }, { rng: rng() });
    expect(pause(s)).toBe(0);
    s = apply(s, 1, { type: 'liar' }, { rng: rng() });
    expect(pause(s)).toBe(showdownTimeline(2).end);
    expect(showdownTimeline(3).end).toBeGreaterThan(showdownTimeline(1).end);
    if (s.phase === 'playing') {
      s = apply(s, s.turn, { type: 'play', cards: [s.hands[s.turn][0]] }, { rng: rng() });
      expect(pause(s)).toBe(0);
    }
  });
});
