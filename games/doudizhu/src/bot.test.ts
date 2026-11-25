import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { decide, hints } from './bot.ts';
import { apply, result, setup, validate, view, type State } from './rules.ts';

function playOut(seed: number): State {
  const rng = SeededRng.fromSeed(seed);
  let s = setup({ rng });
  for (let i = 0; i < 2000 && s.phase !== 'ended'; i++) {
    const a = decide(view(s, s.turn));
    expect(validate(s, s.turn, a)).toBeNull();
    s = apply(s, s.turn, a, { rng });
  }
  return s;
}

describe('bot', () => {
  const base = (over: Partial<State>): State => ({
    ...setup({ rng: SeededRng.fromSeed(1) }),
    phase: 'playing', baseScore: 1, ...over,
  });
  const r1 = () => ({ rng: SeededRng.fromSeed(1) });

  it('领出时能一手出完就出完', () => {
    const s = base({ landlord: 1, turn: 0, hands: [['S03', 'H03', 'C03', 'S04', 'H04'], ['S05'], ['S06']] });
    const a = decide(view(s, 0));
    expect(a.type === 'play' && a.cards.length).toBe(5);
  });
  it('跟牌时能一手出完就出完', () => {
    let s = base({ landlord: 0, turn: 0, hands: [['S05', 'S09'], ['S07', 'H07'], ['S06']] });
    s = apply(s, 0, { type: 'play', cards: ['S05'] }, r1());
    s = apply(s, 1, { type: 'pass' }, r1());
    expect(decide(view(s, 2))).toEqual({ type: 'play', cards: ['S06'] });
  });
  it('不压队友的大牌', () => {
    let s = base({
      landlord: 0, turn: 1,
      hands: [['S03', 'S04', 'S05', 'H09', 'D10'], ['S13', 'S08', 'S07', 'H07', 'C04'], ['S14', 'H06', 'C06', 'D05', 'H03']],
    });
    s = apply(s, 1, { type: 'play', cards: ['S13'] }, r1());
    expect(decide(view(s, 2))).toEqual({ type: 'pass' });
  });
  it('地主只剩一张时农民必须管', () => {
    let s = base({
      landlord: 0, turn: 0,
      hands: [['S05', 'S09'], ['S15', 'H03', 'D04', 'C07', 'S08', 'H08'], ['S14', 'H06', 'C06', 'D05', 'H03'.replace('H', 'S')]],
    });
    s = apply(s, 0, { type: 'play', cards: ['S05'] }, r1());
    const a = decide(view(s, 1));
    expect(a.type).toBe('play');
  });
  it('对手只剩一张时领出不出单', () => {
    const s = base({
      landlord: 1, turn: 0,
      hands: [['S03', 'S07', 'H07', 'S11', 'H11'], ['S05'], ['S06', 'H06', 'S12']],
    });
    const a = decide(view(s, 0));
    expect(a.type === 'play' && a.cards.length).toBeGreaterThan(1);
  });
  it('提示给出的都是合法出法', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = SeededRng.fromSeed(seed);
      let s = setup({ rng });
      for (let i = 0; i < 200 && s.phase !== 'ended'; i++) {
        const v = view(s, s.turn);
        for (const h of hints(v)) expect(validate(s, s.turn, { type: 'play', cards: h })).toBeNull();
        s = apply(s, s.turn, decide(v), { rng });
      }
    }
  });
  it('对打几百局：全部合法结束，打印地主胜率', () => {
    let lord = 0, spring = 0;
    const N = 400;
    for (let g = 0; g < N; g++) {
      const s = playOut(1000 + g);
      expect(s.phase).toBe('ended');
      const r = result(s)!;
      if (r.winners.includes(s.landlord!)) lord++;
      if (/春/.test(r.summary)) spring++;
    }
    console.log(`bot 自对弈 ${N} 局：地主胜率 ${((lord / N) * 100).toFixed(1)}%，春天/反春 ${spring} 局`);
  }, 120_000);
});
