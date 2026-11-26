/**
 * 掼蛋规则（纯函数）。按常见的竞赛规则：
 * - 4 人两队，对家一队（座位 0、2 一队，1、3 一队），两副牌每人 27 张。
 * - 从 2 打起，本副打哪一级由上一副的头游所在队决定；红桃级牌是逢人配。
 * - 出完的人如果没人接得住他最后一手，由他的对家接风先出。
 * - 一副打到三人出完（或一队两人先出完）为止。头游所在队升级：
 *   对家二游升 3 级，三游升 2 级，末游升 1 级；最多升到 A。
 * - 打 A 时要本队打 A 那一副拿头游、且对家不是末游才算过 A，整场结束；
 *   可选"A 三次不过回到 2"。
 * - 从第二副起进贡：末游给头游一张最大的牌（配牌不算），头游还一张 10 以下的牌；
 *   双下时两人都进贡，大的给头游、小的给二游。进贡的人手里有两个大王就抗贡。
 *   进贡后由进贡者先出（双下时进贡大的那位；一样大则是头游下家），抗贡时头游先出。
 */
import type { Result, Rng, Seat } from '@couju/sdk';
import { countNatural, isJoker, isWild, makeDeck, rankOf, sortCards, valueOf } from './cards.ts';
import { interpret, isBomb, KIND_NAME, type Kind, type Pattern } from './patterns.ts';

export const PLAY_MS = 30_000;
export const TRIBUTE_MS = 20_000;
export const HANDOVER_MS = 20_000;
export const ACE = 14;

export interface Options {
  /** full = 从 2 打过 A；one = 只打一副 */
  length: 'full' | 'one';
  /** 打 A 连续几次不过就回到 2；0 = 不限 */
  aLimit: number;
}

export const DEFAULT_OPTIONS: Options = { length: 'full', aLimit: 3 };

export type Action =
  | { type: 'play'; cards: string[]; as?: { kind: Kind; main: number } }
  | { type: 'pass' }
  | { type: 'tribute'; card: string }
  | { type: 'return'; card: string }
  | { type: 'ready' };

export interface PlayInfo extends Pattern {
  seat: Seat;
  cards: string[];
}

export type Recent = string[] | 'pass' | null;

export interface Tribute {
  /** 进贡的人 */
  givers: Seat[];
  /** 已经进的贡（全部进完前也公开：进贡必须是最大的牌，没有秘密） */
  gifts: { from: Seat; card: string }[];
  /** 全部进完后定下谁给谁 */
  pairs: { from: Seat; to: Seat; card: string }[];
  returns: { from: Seat; to: Seat; card: string }[];
  /** 抗贡 */
  resisted: boolean;
  /** 进贡后先出的人 */
  leader: Seat;
}

export interface HandSummary {
  hand: number;
  level: number;
  /** 出完的顺序；双上时只有两个人 */
  order: Seat[];
  /** 每个座位的名次 1..4；双下的两人都记 4 */
  place: number[];
  winTeam: number;
  /** 升了几级（到 A 封顶后实际升的可能更少） */
  up: number;
  levelsBefore: [number, number];
  levelsAfter: [number, number];
  /** 过了 A，整场结束 */
  passedA: boolean;
  /** 打 A 没过，次数用完回到 2 的队 */
  resetTeam: number | null;
  /** 剩下没出完的牌 */
  leftover: string[][];
}

export interface State {
  opts: Options;
  phase: 'tribute' | 'return' | 'playing' | 'handOver' | 'ended';
  /** 第几副，从 1 开始 */
  hand: number;
  /** 本副打几（级牌点数） */
  level: number;
  /** 本副打的是哪一队的级；第一副两队都是 2，记 null */
  levelTeam: number | null;
  teamLevels: [number, number];
  /** 打 A 没过的次数 */
  aFails: [number, number];
  hands: string[][];
  turn: Seat;
  lastPlay: PlayInfo | null;
  passes: number;
  recent: Recent[];
  history: { seat: Seat; cards: string[] | null }[];
  finished: Seat[];
  tribute: Tribute | null;
  lastHand: HandSummary | null;
  /** 一副结束后谁点了"继续" */
  ready: boolean[];
  winnerTeam: number | null;
}

export interface View {
  me: Seat | null;
  opts: Options;
  phase: State['phase'];
  hand: string[];
  counts: number[];
  handNo: number;
  level: number;
  levelTeam: number | null;
  teamLevels: [number, number];
  aFails: [number, number];
  turn: Seat;
  lastPlay: PlayInfo | null;
  recent: Recent[];
  history: State['history'];
  finished: Seat[];
  tribute: Tribute | null;
  lastHand: HandSummary | null;
  ready: boolean[];
  winnerTeam: number | null;
}

export const teamOf = (seat: Seat): number => seat % 2;
export const partnerOf = (seat: Seat): Seat => (seat + 2) % 4;

function deal(rng: Rng, level: number): string[][] {
  const deck = rng.shuffle(makeDeck());
  return [0, 1, 2, 3].map((i) => sortCards(deck.slice(i * 27, i * 27 + 27), level));
}

export function setup({ rng, options }: { rng: Rng; options?: Partial<Options> }): State {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const level = 2;
  const hands = deal(rng, level);
  const first = rng.int(4);
  return {
    opts, phase: 'playing', hand: 1, level, levelTeam: null, teamLevels: [2, 2], aFails: [0, 0],
    hands, turn: first, lastPlay: null, passes: 0, recent: [null, null, null, null], history: [],
    finished: [], tribute: null, lastHand: null, ready: [false, false, false, false], winnerTeam: null,
  };
}

function hasCards(s: Pick<State, 'hands'>, seat: Seat): boolean {
  return s.hands[seat].length > 0;
}

/** from 之后第一个手里还有牌的座位 */
function nextSeat(s: Pick<State, 'hands'>, from: Seat): Seat {
  for (let k = 1; k <= 4; k++) {
    const x = (from + k) % 4;
    if (hasCards(s, x)) return x;
  }
  return from;
}

export function active(s: State): Seat[] {
  switch (s.phase) {
    case 'playing':
      return [s.turn];
    case 'tribute':
      return s.tribute!.givers.filter((g) => !s.tribute!.gifts.some((x) => x.from === g));
    case 'return':
      return s.tribute!.pairs.map((p) => p.to).filter((to) => !s.tribute!.returns.some((r) => r.from === to));
    case 'handOver':
      return [0, 1, 2, 3].filter((i) => !s.ready[i]);
    default:
      return [];
  }
}

/** 进贡必须进的大小：手里除配牌外最大的牌 */
export function tributeValue(hand: readonly string[], level: number): number {
  let m = 0;
  for (const id of hand) if (!isWild(id, level)) m = Math.max(m, valueOf(id, level));
  return m;
}

/** 还贡可以还哪些牌：10 以下（含 10）的非王牌；万一一张都没有，任何牌都行 */
export function returnable(hand: readonly string[]): string[] {
  const low = hand.filter((id) => !isJoker(id) && rankOf(id) <= 10);
  return low.length ? low : hand.slice();
}

export function validate(s: State, seat: Seat, a: Action): string | null {
  if (s.phase === 'ended') return '比赛已经结束了';
  if (!active(s).includes(seat)) return '还没轮到你';
  if (!a || typeof a !== 'object') return '无效操作';
  const hand = s.hands[seat];
  switch (s.phase) {
    case 'handOver':
      return a.type === 'ready' ? null : '等大家点继续';
    case 'tribute': {
      if (a.type !== 'tribute') return '现在要进贡';
      if (!hand.includes(a.card)) return '你没有这张牌';
      if (isWild(a.card, s.level)) return '配牌不用进贡';
      if (valueOf(a.card, s.level) !== tributeValue(hand, s.level)) return '要进手里最大的牌（配牌除外）';
      return null;
    }
    case 'return': {
      if (a.type !== 'return') return '现在要还贡';
      if (!hand.includes(a.card)) return '你没有这张牌';
      if (!returnable(hand).includes(a.card)) return '还贡要还 10 以下的牌';
      return null;
    }
    case 'playing':
      break;
  }
  if (a.type === 'pass') return s.lastPlay ? null : '你先出，不能不出';
  if (a.type !== 'play' || !Array.isArray(a.cards) || a.cards.length === 0) return '请选择要出的牌';
  if (new Set(a.cards).size !== a.cards.length) return '有重复的牌';
  const own = new Set(hand);
  if (!a.cards.every((c) => typeof c === 'string' && own.has(c))) return '你没有这些牌';
  const p = interpret(a.cards, s.level, null, a.as);
  if (!p) return a.as ? '这些牌不能这样出' : '不是合法的牌型';
  if (s.lastPlay && !interpret(a.cards, s.level, s.lastPlay, a.as)) return `管不上${KIND_NAME[s.lastPlay.kind]}`;
  return null;
}

export function apply(s: State, seat: Seat, a: Action, { rng }: { rng: Rng }): State {
  switch (a.type) {
    case 'ready':
      return applyReady(s, seat, rng);
    case 'tribute':
      return applyTribute(s, seat, a.card);
    case 'return':
      return applyReturn(s, seat, a.card);
    case 'pass':
      return applyPass(s, seat);
    case 'play':
      return applyPlay(s, seat, a);
  }
}

function applyPass(s: State, seat: Seat): State {
  const passes = s.passes + 1;
  const recent = s.recent.slice();
  recent[seat] = 'pass';
  const history = [...s.history, { seat, cards: null }];
  const last = s.lastPlay!;
  const alive = [0, 1, 2, 3].filter((i) => hasCards(s, i)).length;
  const lastAlive = hasCards(s, last.seat);
  // 上一手的人还在：其余人都不要就回到他；他已经出完：所有还有牌的人都不要，由他对家接风
  if (lastAlive ? passes >= alive - 1 : passes >= alive) {
    const leader = lastAlive ? last.seat : hasCards(s, partnerOf(last.seat)) ? partnerOf(last.seat) : nextSeat(s, last.seat);
    return { ...s, passes: 0, lastPlay: null, recent, history, turn: leader };
  }
  return { ...s, passes, recent, history, turn: nextSeat(s, seat) };
}

function applyPlay(s: State, seat: Seat, a: Extract<Action, { type: 'play' }>): State {
  const cards = sortCards(a.cards, s.level);
  const p = interpret(cards, s.level, s.lastPlay, a.as)!;
  const played = new Set(cards);
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => !played.has(c)) : h));
  const recent: Recent[] = s.lastPlay ? s.recent.slice() : [null, null, null, null];
  recent[seat] = cards;
  const finished = hands[seat].length === 0 ? [...s.finished, seat] : s.finished;
  const next: State = {
    ...s,
    hands,
    lastPlay: { ...p, seat, cards },
    passes: 0,
    recent,
    history: [...s.history, { seat, cards }],
    finished,
  };
  const doubleWin = finished.length === 2 && teamOf(finished[0]) === teamOf(finished[1]);
  if (doubleWin || finished.length === 3) return endHand(next);
  return { ...next, turn: nextSeat(next, seat) };
}

function endHand(s: State): State {
  const order = s.finished.slice();
  const place = [4, 4, 4, 4];
  order.forEach((seat, i) => (place[seat] = i + 1));
  const first = order[0];
  const winTeam = teamOf(first);
  const partnerPlace = place[partnerOf(first)];
  const up = partnerPlace === 2 ? 3 : partnerPlace === 3 ? 2 : 1;
  const levelsBefore = s.teamLevels;
  const levels: [number, number] = [...s.teamLevels];
  const aFails: [number, number] = [...s.aFails];

  // 过 A：本副打的是本队的 A，拿了头游且对家不是末游
  const passedA = s.level === ACE && s.levelTeam === winTeam && levels[winTeam] === ACE && partnerPlace !== 4;
  levels[winTeam] = Math.min(ACE, levels[winTeam] + up);

  let resetTeam: number | null = null;
  if (!passedA && s.level === ACE && s.levelTeam !== null && levelsBefore[s.levelTeam] === ACE) {
    const t = s.levelTeam;
    aFails[t]++;
    if (s.opts.aLimit > 0 && aFails[t] >= s.opts.aLimit) {
      levels[t] = 2;
      aFails[t] = 0;
      resetTeam = t;
    }
  }

  const summary: HandSummary = {
    hand: s.hand, level: s.level, order, place, winTeam, up, levelsBefore, levelsAfter: levels,
    passedA, resetTeam, leftover: s.hands.map((h) => h.slice()),
  };
  const over = passedA || s.opts.length === 'one';
  return {
    ...s,
    phase: over ? 'ended' : 'handOver',
    teamLevels: levels,
    aFails,
    lastHand: summary,
    lastPlay: null,
    passes: 0,
    ready: [false, false, false, false],
    winnerTeam: over ? winTeam : null,
  };
}

function applyReady(s: State, seat: Seat, rng: Rng): State {
  const ready = s.ready.slice();
  ready[seat] = true;
  if (!ready.every(Boolean)) return { ...s, ready };
  return startHand({ ...s, ready }, rng);
}

/** 发下一副牌，安排进贡 */
function startHand(s: State, rng: Rng): State {
  const last = s.lastHand!;
  const levelTeam = last.winTeam;
  const level = s.teamLevels[levelTeam];
  const hands = deal(rng, level);
  const first = last.order[0];
  const doubleDown = last.order.length === 2;
  const givers = doubleDown ? [0, 1, 2, 3].filter((i) => teamOf(i) !== last.winTeam) : [last.place.indexOf(4)];
  const bigJokers = givers.reduce((n, g) => n + hands[g].filter((c) => rankOf(c) === 17).length, 0);
  const resisted = bigJokers >= 2;
  const base: State = {
    ...s,
    // 新一副沿用同一批牌 id：上一副摊开的剩牌不再留在视图里，免得和新发的牌混淆
    lastHand: { ...last, leftover: [] },
    hand: s.hand + 1,
    level,
    levelTeam,
    hands,
    lastPlay: null,
    passes: 0,
    recent: [null, null, null, null],
    history: [],
    finished: [],
    ready: [false, false, false, false],
  };
  const tribute: Tribute = { givers, gifts: [], pairs: [], returns: [], resisted, leader: first };
  if (resisted) return { ...base, phase: 'playing', turn: first, tribute };
  return { ...base, phase: 'tribute', turn: givers[0], tribute };
}

function applyTribute(s: State, seat: Seat, card: string): State {
  const t = s.tribute!;
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h));
  const gifts = [...t.gifts, { from: seat, card }];
  if (gifts.length < t.givers.length) return { ...s, hands, tribute: { ...t, gifts } };

  const last = s.lastHand!;
  const first = last.order[0];
  let pairs: Tribute['pairs'];
  if (gifts.length === 1) pairs = [{ from: seat, to: first, card }];
  else {
    const [a, b] = gifts;
    const va = valueOf(a.card, s.level), vb = valueOf(b.card, s.level);
    // 大的给头游；一样大时头游的下家给头游
    const big = va !== vb ? (va > vb ? a : b) : a.from === (first + 1) % 4 ? a : b;
    const small = big === a ? b : a;
    pairs = [
      { from: big.from, to: first, card: big.card },
      { from: small.from, to: partnerOf(first), card: small.card },
    ];
  }
  const received = hands.map((h, i) => {
    const got = pairs.filter((p) => p.to === i).map((p) => p.card);
    return got.length ? sortCards([...h, ...got], s.level) : h;
  });
  return { ...s, hands: received, phase: 'return', tribute: { ...t, gifts, pairs, leader: pairs[0].from } };
}

function applyReturn(s: State, seat: Seat, card: string): State {
  const t = s.tribute!;
  const to = t.pairs.find((p) => p.to === seat)!.from;
  const hands = s.hands.map((h, i) =>
    i === seat ? h.filter((c) => c !== card) : i === to ? sortCards([...h, card], s.level) : h,
  );
  const returns = [...t.returns, { from: seat, to, card }];
  const tribute = { ...t, returns };
  if (returns.length < t.pairs.length) return { ...s, hands, tribute };
  return { ...s, hands, tribute, phase: 'playing', turn: t.leader };
}

export function timer(s: State): { ms: number; seats: Seat[]; key?: string } | null {
  switch (s.phase) {
    case 'playing':
      return { ms: PLAY_MS, seats: [s.turn] };
    case 'tribute':
    case 'return':
      return { ms: TRIBUTE_MS, seats: active(s), key: `${s.phase}-${s.hand}` };
    case 'handOver':
      return { ms: HANDOVER_MS, seats: active(s), key: `handOver-${s.hand}` };
    default:
      return null;
  }
}

export const TEAM_NAME = ['1·3 号位', '2·4 号位'];

export function result(s: State): Result | null {
  if (s.phase !== 'ended' || s.winnerTeam === null || !s.lastHand) return null;
  const w = s.winnerTeam;
  const winners = [0, 1, 2, 3].filter((i) => teamOf(i) === w);
  const h = s.lastHand;
  let summary: string;
  let pts: number;
  if (s.opts.length === 'one') {
    const how = h.up === 3 ? '双上' : h.up === 2 ? '头游 + 三游' : '头游 + 末游';
    summary = `${TEAM_NAME[w]}获胜 · ${how} · 升 ${h.up} 级`;
    pts = h.up;
  } else {
    summary = `${TEAM_NAME[w]}过 A 获胜 · 打了 ${s.hand} 副 · ${s.teamLevels[0] === ACE ? 'A' : s.teamLevels[0]} : ${s.teamLevels[1] === ACE ? 'A' : s.teamLevels[1]}`;
    pts = 1;
  }
  // 积分分量（ADR-0007）：整场打过 A 要半小时以上，算 2；只打一副按升级数，双上 1、头游+三游 2/3、头游+末游 1/3
  const weight = s.opts.length === 'one' ? h.up / 3 : 2;
  return { winners, scores: [0, 1, 2, 3].map((i) => (teamOf(i) === w ? pts : -pts)), summary, weight };
}

export function view(s: State, seat: Seat | null): View {
  return {
    me: seat,
    opts: s.opts,
    phase: s.phase,
    hand: seat === null ? [] : s.hands[seat].slice(),
    counts: s.hands.map((h) => h.length),
    handNo: s.hand,
    level: s.level,
    levelTeam: s.levelTeam,
    teamLevels: s.teamLevels,
    aFails: s.aFails,
    turn: s.turn,
    lastPlay: s.lastPlay,
    recent: s.recent.slice(),
    history: s.history.slice(),
    finished: s.finished.slice(),
    tribute: s.tribute,
    lastHand: s.lastHand,
    ready: s.ready.slice(),
    winnerTeam: s.winnerTeam,
  };
}

/** 只有 seat 自己能看到的牌：手里的牌，除了进贡/还贡时公开过的那几张；一副结束后都摊开了 */
export function privateTokens(s: State, seat: Seat): string[] {
  if (s.phase === 'handOver' || s.phase === 'ended') return [];
  const t = s.tribute;
  const shown = new Set([...(t?.gifts ?? []), ...(t?.returns ?? [])].map((x) => x.card));
  return s.hands[seat].filter((c) => !shown.has(c));
}

export function levelLabel(level: number): string {
  return level === ACE ? 'A' : level === 11 ? 'J' : level === 12 ? 'Q' : level === 13 ? 'K' : String(level);
}

export { countNatural, isBomb };
