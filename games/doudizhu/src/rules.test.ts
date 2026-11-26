import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { makeDeck, rankOf } from './cards.ts';
import { apply, result, setup, validate, view, type State } from './rules.ts';

const rng = () => SeededRng.fromSeed(1);

function playingState(over: Partial<State>): State {
  const s = setup({ rng: rng() });
  return {
    ...s, phase: 'playing', landlord: 0, baseScore: 3, bids: [{ seat: 0, score: 3 }], turn: 0,
    ...over,
  };
}

describe('发牌', () => {
  it('17/17/17 + 3，正好一副牌', () => {
    const s = setup({ rng: rng() });
    expect(s.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(s.bottom).toHaveLength(3);
    expect([...s.hands.flat(), ...s.bottom].sort()).toEqual(makeDeck().sort());
  });
});

describe('叫分', () => {
  it('叫 3 分立即当地主并拿底牌', () => {
    const s = setup({ rng: rng() });
    const t = apply(s, s.turn, { type: 'bid', score: 3 }, { rng: rng() });
    expect(t.landlord).toBe(s.turn);
    expect(t.hands[s.turn]).toHaveLength(20);
    expect(t.phase).toBe('playing');
    expect(t.turn).toBe(s.turn);
  });
  it('必须比当前高', () => {
    let s = setup({ rng: rng() });
    s = apply(s, s.turn, { type: 'bid', score: 2 }, { rng: rng() });
    expect(validate(s, s.turn, { type: 'bid', score: 2 })).toMatch(/更高/);
    expect(validate(s, s.turn, { type: 'bid', score: 0 })).toBeNull();
    expect(validate(s, (s.turn + 1) % 3, { type: 'bid', score: 3 })).toMatch(/轮到/);
  });
  it('一轮后最高分当地主', () => {
    let s = setup({ rng: rng() });
    const first = s.turn;
    s = apply(s, s.turn, { type: 'bid', score: 1 }, { rng: rng() });
    s = apply(s, s.turn, { type: 'bid', score: 2 }, { rng: rng() });
    s = apply(s, s.turn, { type: 'bid', score: 0 }, { rng: rng() });
    expect(s.landlord).toBe((first + 1) % 3);
    expect(s.baseScore).toBe(2);
  });
  it('都不叫重发，连续 3 次强制首叫者 1 分', () => {
    const r = rng();
    let s = setup({ rng: r });
    for (let round = 0; round < 3; round++) {
      expect(s.phase).toBe('bidding');
      for (let i = 0; i < 3; i++) s = apply(s, s.turn, { type: 'bid', score: 0 }, { rng: r });
    }
    expect(s.phase).toBe('playing');
    expect(s.landlord).toBe(s.firstBidder);
    expect(s.baseScore).toBe(1);
    expect(s.redeals).toBe(3);
  });
});

describe('出牌', () => {
  it('领出不能不要，跟牌要管得上', () => {
    const s = playingState({ hands: [['S03', 'S04', 'H04'], ['S05', 'H05'], ['S06']] });
    expect(validate(s, 0, { type: 'pass' })).toMatch(/不能不要/);
    expect(validate(s, 0, { type: 'play', cards: ['S03', 'S04'] })).toMatch(/牌型/);
    expect(validate(s, 0, { type: 'play', cards: ['S09'] })).toMatch(/没有/);
    const t = apply(s, 0, { type: 'play', cards: ['S03'] }, { rng: rng() });
    expect(validate(t, 1, { type: 'play', cards: ['S05', 'H05'] })).toMatch(/管不上/);
    expect(validate(t, 1, { type: 'play', cards: ['S05'] })).toBeNull();
  });
  it('两家不要后由最后出牌者自由出', () => {
    let s = playingState({ hands: [['S03', 'S04'], ['S05'], ['S06']] });
    s = apply(s, 0, { type: 'play', cards: ['S04'] }, { rng: rng() });
    s = apply(s, 1, { type: 'pass' }, { rng: rng() });
    s = apply(s, 2, { type: 'pass' }, { rng: rng() });
    expect(s.turn).toBe(0);
    expect(s.lastPlay).toBeNull();
    expect(validate(s, 0, { type: 'play', cards: ['S03'] })).toBeNull();
  });
});

describe('计分', () => {
  it('春天：农民一张没出，地主赢，×2', () => {
    let s = playingState({ hands: [['S03'], ['S05', 'H05'], ['S06']] });
    s = apply(s, 0, { type: 'play', cards: ['S03'] }, { rng: rng() });
    const r = result(s)!;
    expect(r.winners).toEqual([0]);
    expect(r.summary).toMatch(/春天/);
    expect(r.scores).toEqual([12, -6, -6]);
    expect(r.weight).toBeCloseTo(0.5 + 0.5 * Math.log2(6));
  });
  it('反春：地主只出过一手，农民赢，×2', () => {
    let s = playingState({ hands: [['S03', 'S04'], ['S05', 'S06'], ['S07', 'S08']] });
    s = apply(s, 0, { type: 'play', cards: ['S03'] }, { rng: rng() });
    s = apply(s, 1, { type: 'play', cards: ['S05'] }, { rng: rng() });
    s = apply(s, 2, { type: 'pass' }, { rng: rng() });
    s = apply(s, 0, { type: 'pass' }, { rng: rng() });
    s = apply(s, 1, { type: 'play', cards: ['S06'] }, { rng: rng() });
    const r = result(s)!;
    expect(r.winners).toEqual([1, 2]);
    expect(r.summary).toMatch(/反春/);
    expect(r.scores).toEqual([-12, 6, 6]);
  });
  it('炸弹和王炸各翻倍', () => {
    let s = playingState({
      baseScore: 2,
      hands: [['S03', 'H03', 'C03', 'D03', 'J16', 'J17', 'S09'], ['S05', 'S06'], ['S07', 'S08']],
    });
    s = apply(s, 0, { type: 'play', cards: ['S03', 'H03', 'C03', 'D03'] }, { rng: rng() });
    s = apply(s, 1, { type: 'pass' }, { rng: rng() });
    s = apply(s, 2, { type: 'pass' }, { rng: rng() });
    s = apply(s, 0, { type: 'play', cards: ['J16', 'J17'] }, { rng: rng() });
    s = apply(s, 1, { type: 'pass' }, { rng: rng() });
    s = apply(s, 2, { type: 'pass' }, { rng: rng() });
    s = apply(s, 0, { type: 'play', cards: ['S09'] }, { rng: rng() });
    const r = result(s)!;
    // 2 分 × 炸弹 2 × 王炸 2 × 春天 2 = 16
    expect(r.scores).toEqual([32, -16, -16]);
    expect(r.summary).toMatch(/= 16/);
    // 积分分量：16 倍是 2 的 4 次方，0.5 + 0.5×4
    expect(r.weight).toBe(2.5);
  });
});

describe('视图', () => {
  it('看不到别人的牌和未公开的底牌', () => {
    const s = setup({ rng: rng() });
    const v = view(s, 1);
    expect(v.hand).toEqual(s.hands[1]);
    expect(v.bottom).toBeNull();
    const json = JSON.stringify(v);
    for (const c of [...s.hands[0], ...s.hands[2], ...s.bottom]) expect(json).not.toContain(`"${c}"`);
    expect(v.counts).toEqual([17, 17, 17]);
  });
  it('定地主后公开底牌', () => {
    const s = setup({ rng: rng() });
    const t = apply(s, s.turn, { type: 'bid', score: 3 }, { rng: rng() });
    expect(view(t, (s.turn + 1) % 3).bottom).toEqual(s.bottom);
    expect(t.bottom.every((c) => rankOf(c) >= 3)).toBe(true);
  });
});
