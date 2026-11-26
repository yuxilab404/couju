import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { beatsOf, decide, hints, planHand } from './bot.ts';
import { valueOf } from './cards.ts';
import { hand } from './testhand.ts';
import { interpret, isBomb } from './patterns.ts';
import { active, apply, setup, validate, view, type Action, type State, type View } from './rules.ts';

function viewOf(hands: string[], over: Partial<State> = {}, seat = 0): View {
  const s = setup({ rng: SeededRng.fromSeed(1) });
  return view({ ...s, hands: hands.map(hand), turn: seat, ...over }, seat);
}

describe('拆牌', () => {
  it('配牌补成顺子', () => {
    const combos = planHand(hand('h2 3 4 6 7'), 2);
    expect(combos.map((c) => c.kind)).toEqual(['straight']);
  });
  it('炸弹整组留着', () => {
    const combos = planHand(hand('9 9 9 9 3 5'), 2);
    expect(combos.some((c) => c.kind === 'bomb' && c.size === 4)).toBe(true);
  });
});

describe('跟牌', () => {
  const prevBy = (seat: number, spec: string, level = 2) => {
    const cards = hand(spec);
    return { ...interpret(cards, level, null)!, seat, cards };
  };
  it('对家的牌不压', () => {
    const v = viewOf(['3 5 9 K K', '7 7 7 7 7', '8 8', '9 9 9 9 9'], { lastPlay: prevBy(2, '8') });
    expect(decide(v)).toEqual({ type: 'pass' });
  });
  it('能一手走完就走', () => {
    const v = viewOf(['K K', '7 7 7 7 7', '8 8', '9 9 9 9 9'], { lastPlay: prevBy(2, '8 8') });
    expect(decide(v)).toMatchObject({ type: 'play' });
  });
  it('对手快走完了，舍得用炸弹', () => {
    const v = viewOf(['3 5 9 J J J J 6', '7 7', '8 8 3 4 5 6 9 10 Q', '9 9'], { lastPlay: prevBy(3, 'A') });
    const a = decide(v);
    expect(a.type).toBe('play');
    if (a.type === 'play') expect(isBomb(interpret(a.cards, 2, null, a.as)!)).toBe(true);
  });
  it('列出的出法都压得过', () => {
    const prev = prevBy(1, '3 4 5 6 7');
    for (const m of beatsOf(hand('h2 5 6 7 8 9 10 Q Q Q Q'), 2, prev)) {
      expect(interpret(m.cards, 2, prev, m.as)).not.toBeNull();
    }
  });
});

describe('进贡', () => {
  it('进最大的非配牌，还 10 以下', () => {
    const s = setup({ rng: SeededRng.fromSeed(1) });
    const base: State = {
      ...s, phase: 'tribute', level: 5, hands: [hand('3 4'), hand('3'), hand('h5 A 9 4'), hand('3')],
      tribute: { givers: [2], gifts: [], pairs: [], returns: [], resisted: false, leader: 0 },
      lastHand: { hand: 1, level: 2, order: [0, 1, 3], place: [1, 2, 4, 3], winTeam: 0, up: 1, levelsBefore: [2, 2], levelsAfter: [5, 2], passedA: false, resetTeam: null, leftover: [] },
    };
    const a = decide(view(base, 2));
    expect(a).toEqual({ type: 'tribute', card: hand('h5 A')[1] });
    expect(validate(base, 2, a)).toBeNull();
    const t = apply(base, 2, a, { rng: SeededRng.fromSeed(1) });
    const r = decide(view(t, 0));
    expect(r.type).toBe('return');
    expect(validate(t, 0, r)).toBeNull();
  });
});

it('提示：第一条就是 bot 自己会出的', () => {
  const v = viewOf(['3 3 4 4 5 5 9 K', '7', '8', '9']);
  const h = hints(v);
  expect(h.length).toBeGreaterThan(0);
  const a = decide(v) as Extract<Action, { type: 'play' }>;
  expect(h[0].cards.slice().sort()).toEqual(a.cards.slice().sort());
});

/** 只会出最小单张、能管就管的对手 */
function naive(v: View): Action {
  if (v.phase !== 'playing') return decide(v);
  if (!v.lastPlay) {
    const c = v.hand.slice().sort((a, b) => valueOf(a, v.level) - valueOf(b, v.level))[0];
    return { type: 'play', cards: [c] };
  }
  const m = beatsOf(v.hand, v.level, v.lastPlay).filter((x) => !isBomb(x.p) || v.hand.length < 8);
  if (v.lastPlay.seat === (v.me! + 2) % 4 || !m.length) return { type: 'pass' };
  return { type: 'play', cards: m[0].cards, as: m[0].as };
}

it('bot 一队明显打得过只会出小单张的一队', () => {
  let win = 0;
  const N = 80;
  for (let g = 0; g < N; g++) {
    const rng = SeededRng.fromSeed(g + 11);
    let s = setup({ rng, options: { length: 'one' } });
    while (s.phase !== 'ended') {
      const seat = active(s)[0];
      const a = seat % 2 === 0 ? decide(view(s, seat)) : naive(view(s, seat));
      s = apply(s, seat, a, { rng });
    }
    if (s.winnerTeam === 0) win++;
  }
  expect(win / N).toBeGreaterThan(0.65);
}, 60_000);
