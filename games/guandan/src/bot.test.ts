import { SeededRng } from '@couju/sdk';
import { describe, expect, it } from 'vitest';
import { beatsOf, decide, hints, plan, planHand } from './bot.ts';
import { countNatural, valueOf } from './cards.ts';
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
  it('两张配牌一起补缺口，不贪心拆成两对一单', () => {
    const combos = planHand(hand('h2 h2 3 4 7'), 2);
    expect(combos).toMatchObject([{ kind: 'straight', main: 7, size: 5 }]);
    expect(combos).toHaveLength(1);
  });
  it('缓存不受返回值被修改的影响，也不串级牌', () => {
    const cards = hand('3 3 4 5 6 7');
    const cnt = countNatural(cards, 2);
    const expected = plan(cnt, 2);
    const modified = plan(cnt, 2);
    modified[0].ranks.length = 0;
    modified[0].main = 99;
    modified.length = 0;
    expect(plan(cnt, 2)).toEqual(expected);
    expect(plan(countNatural(hand('3 3'), 3), 3)[0].main).toBe(15);
    expect(plan(countNatural(hand('3 3'), 2), 2)[0].main).toBe(3);

    const wildHand = hand('h2 h2 3 4 7');
    const expectedWild = planHand(wildHand, 2);
    planHand(wildHand, 2)[0].ranks.length = 0;
    expect(planHand(wildHand, 2)).toEqual(expectedWild);
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
  it('配牌能把炸弹加大：四张 9 + 两张配牌压五张炸弹，一手走完', () => {
    const v = viewOf(['9 9 9 9 h2 h2', '3 3', '3 4', '5 6'], { lastPlay: prevBy(1, '8 8 8 8 8') });
    const a = decide(v);
    expect(a).toMatchObject({ type: 'play', as: { kind: 'bomb', main: 9 } });
    if (a.type === 'play') expect(a.cards).toHaveLength(6);
    expect(hints(v).moves).not.toHaveLength(0);
  });
  it('列出的出法都压得过', () => {
    const prev = prevBy(1, '3 4 5 6 7');
    for (const m of beatsOf(hand('h2 5 6 7 8 9 10 Q Q Q Q'), 2, prev)) {
      expect(interpret(m.cards, 2, prev, m.as)).not.toBeNull();
    }
  });
  it('三带二优先带小对，保留级牌对子', () => {
    const prev = prevBy(1, '5 5 5 3 3');
    const moves = beatsOf(hand('2 2 4 4 6 6 6 9'), 2, prev);
    const sixes = moves.find((m) => m.p.kind === 'fullHouse' && m.p.main === 6)!;
    expect(sixes.cards.slice().sort()).toEqual(hand('6 6 6 4 4').slice().sort());
  });
  it('三带二的带牌不拆炸弹', () => {
    const prev = prevBy(1, '5 5 5 3 3');
    const moves = beatsOf(hand('3 3 3 3 6 6 6 9 9'), 2, prev);
    const sixes = moves.find((m) => m.p.kind === 'fullHouse' && m.p.main === 6)!;
    expect(sixes.cards.slice().sort()).toEqual(hand('6 6 6 9 9').slice().sort());
  });
  it('三带二带另一对，保留完整连对作为最后一手', () => {
    const v = viewOf(['3 3 4 4 5 5 6 6 6 K K', '7 7 8 8 9 9 10 10', '8 8 9 9 10 10 J J', '9 9 10 10 J J Q Q'], {
      lastPlay: prevBy(1, '5 5 5 9 9'),
    });
    const a = decide(v);
    expect(a).toMatchObject({ type: 'play', as: { kind: 'fullHouse', main: 6 } });
    if (a.type === 'play') {
      expect(a.cards.slice().sort()).toEqual(hand('6 6 6 K K').slice().sort());
      const rest = v.hand.filter((c) => !a.cards.includes(c));
      expect(interpret(rest, 2, null)).toMatchObject({ kind: 'tube', size: 6 });
    }
  });
  it('三带二选带对时把配牌的消耗一起计分', () => {
    const prev = prevBy(1, '5 5 5 3 3');
    const moves = beatsOf(hand('h2 4 6 6 6 9 9'), 2, prev);
    const sixes = moves.find((m) => m.p.kind === 'fullHouse' && m.p.main === 6)!;
    expect(sixes.cards.slice().sort()).toEqual(hand('6 6 6 9 9').slice().sort());
    expect(interpret(sixes.cards, 2, prev, sixes.as)).not.toBeNull();
  });
  it('对手报单时拆大对封口，不出小单张让下家走', () => {
    const v = viewOf(['4 K K', 'Q', '3 3 6 6', '8 8'], { lastPlay: prevBy(3, '3') });
    expect(decide(v)).toMatchObject({ type: 'play', as: { kind: 'single', main: 13 } });
  });
});

it('对手报单而自己全是单张时，先出最大单张封口', () => {
  const v = viewOf(['4 7 2', 'Q', '3 3 6 6', '8 8']);
  expect(decide(v)).toMatchObject({ type: 'play', as: { kind: 'single', main: 15 } });
});

it('开局能用 QQ、KK、AA 出最大木板时，留下配牌和五张 7 的炸弹', () => {
  const s = setup({ rng: SeededRng.fromSeed(550001) });
  const a = decide(view(s, s.turn));
  expect(a).toMatchObject({ type: 'play', as: { kind: 'tube', main: 14 } });
  expect(validate(s, s.turn, a)).toBeNull();
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
  expect(h.pass).toBe(false);
  expect(h.moves.length).toBeGreaterThan(0);
  const a = decide(v) as Extract<Action, { type: 'play' }>;
  expect(h.moves[0].cards.slice().sort()).toEqual(a.cards.slice().sort());
});

describe('提示的顺序', () => {
  const prevBy = (seat: number, spec: string, level = 2) => {
    const cards = hand(spec);
    return { ...interpret(cards, level, null)!, seat, cards };
  };
  it('对家的牌：先建议不出，不会一上来就提示炸对家', () => {
    const v = viewOf(['A A A A K K K K Q Q J 10 5 5 3', '7 7', '8 8', '9 9'], { lastPlay: prevBy(2, '2') });
    const h = hints(v);
    expect(h).toMatchObject({ pass: true, fromPartner: true });
    expect(h.moves.every((m) => isBomb(m.p))).toBe(true);
  });
  it('跟单张：拆对子的在前，拆炸弹的在后，炸弹最后', () => {
    const many = '3 4 5 6 7 8 9 10 J Q';
    const v = viewOf(['A A A A K K K K Q Q J J 10 10 5 5 3', many, many, many], { lastPlay: prevBy(1, '8') });
    const h = hints(v);
    expect(h.pass).toBe(true); // 对手牌还多，不值得拆
    expect(h.moves.map((m) => (isBomb(m.p) ? 'bomb' : String(m.p.main)))).toEqual(['10', '11', '12', '13', '14', 'bomb', 'bomb']);
  });
  it('跟对子：自然对子在前，用配牌凑的、拆炸弹的在后', () => {
    const v = viewOf(['h2 8 7 7 9 9 10 10 10 10 Q Q', '7 7', '8 8', '9 9'], { lastPlay: prevBy(1, '3 3') });
    const moves = hints(v).moves.filter((m) => !isBomb(m.p));
    const wildAt = moves.findIndex((m) => m.cards.some((c) => c.startsWith('H02')));
    const tenAt = moves.findIndex((m) => m.p.main === 10);
    expect(moves[0].p.main).toBe(7);
    expect(wildAt).toBeGreaterThan(moves.findIndex((m) => m.p.main === 12));
    expect(tenAt).toBe(moves.length - 1);
  });
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
