/**
 * 炸金花规则，纯函数。一局就是一手牌。
 *
 * 开局每人先下底注，各发 3 张扣着。从庄家下家开始轮流行动：
 * - 看牌：随时（轮到自己时）翻开自己的牌，不算一次行动；看过之后下注翻倍。
 * - 跟注：闷着付 1 倍单注，看过牌付 2 倍。
 * - 加注：把单注提到更高一档，再按上面的倍数付。
 * - 比牌：从第二轮起，付一次跟注的钱，挑一个没弃牌的人比大小，输的出局；一样大算主动比的人输。
 *   只有比牌的两个人能看到对方的牌。
 * - 弃牌：这局不玩了，已经下的注留在底池。
 * 只剩一个人时他拿走底池。每个人都行动满封顶轮数还没分出胜负，就按座次挨个系统比牌。
 * 结束后所有人亮牌。
 */
import type { Result, Rng, Seat } from '@couju/sdk';
import { classify, compareHands, HAND_SIZE, KIND_LABEL, makeDeck, sortHand } from './patterns.ts';

export const ANTE = 1;
/** 单注能加到的档位，从第一档开始 */
export const STAKES: readonly number[] = [1, 2, 3, 5, 10];
export const TURN_MS = 30_000;
/** 比牌翻开到出结果的时间线（毫秒）。画面按它放，pause 也按它停 */
export const COMPARE = { flip: 300, flipGap: 160, verdict: 1300, end: 2200 } as const;

export interface Options {
  /** 封顶轮数：每人都行动满这么多次就系统比牌 */
  maxRounds: number;
  /** 前几轮必须闷牌（不能看牌） */
  blindRounds: number;
  /** 不同花色的 235 吃豹子 */
  beat235: boolean;
}
export const DEFAULT_OPTIONS: Options = { maxRounds: 10, blindRounds: 0, beat235: true };

export type Action =
  | { type: 'look' }
  | { type: 'call' }
  | { type: 'raise'; stake: number }
  | { type: 'fold' }
  | { type: 'compare'; target: Seat };

/** 公开的行动记录 */
export interface LogEntry {
  seat: Seat;
  type: Action['type'];
  /** 这一下往底池里放了多少 */
  cost?: number;
  /** 加注后的单注 */
  stake?: number;
  /** 下注时是不是闷着 */
  blind?: boolean;
  target?: Seat;
  loser?: Seat;
}

export interface Compare {
  /** 主动比的人（系统比牌时是座次靠后的那个） */
  a: Seat;
  b: Seat;
  loser: Seat;
  /** 封顶后系统比的 */
  auto: boolean;
}

export interface State {
  phase: 'betting' | 'ended';
  n: number;
  options: Options;
  dealer: Seat;
  turn: Seat;
  hands: string[][];
  seen: boolean[];
  folded: boolean[];
  /** 每人这局一共下了多少（含底注） */
  bets: number[];
  stake: number;
  /** 每人行动过几次（看牌不算） */
  acted: number[];
  /** 一共行动过几次（看牌不算），倒计时的 key 用 */
  moves: number;
  log: LogEntry[];
  compares: Compare[];
  end: { reason: 'fold' | 'compare' | 'cap'; winner: Seat } | null;
}

export interface View {
  me: Seat | null;
  phase: State['phase'];
  n: number;
  options: Options;
  dealer: Seat;
  turn: Seat;
  /** 当前行动的人是第几轮 */
  round: number;
  stake: number;
  stakes: readonly number[];
  ante: number;
  pot: number;
  bets: number[];
  seen: boolean[];
  folded: boolean[];
  acted: number[];
  /** 我知道的牌：自己看过（或弃了）的、和我比过牌的人的；结束后全部 */
  hands: (string[] | null)[];
  log: LogEntry[];
  compares: Compare[];
  end: State['end'];
}

export function normalizeOptions(o: Partial<Options> | undefined): Options {
  const x = { ...DEFAULT_OPTIONS, ...(o ?? {}) };
  return {
    maxRounds: Math.max(1, Math.floor(Number(x.maxRounds)) || DEFAULT_OPTIONS.maxRounds),
    blindRounds: Math.max(0, Math.floor(Number(x.blindRounds)) || 0),
    beat235: !!x.beat235,
  };
}

export function setup({ numPlayers, options, rng }: { numPlayers: number; options?: Partial<Options>; rng: Rng }): State {
  const n = numPlayers;
  const deck = rng.shuffle(makeDeck());
  const hands = Array.from({ length: n }, (_, i) => sortHand(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE)));
  const dealer = rng.int(n);
  const none = () => Array.from({ length: n }, () => false);
  return {
    phase: 'betting', n, options: normalizeOptions(options), dealer, turn: (dealer + 1) % n, hands,
    seen: none(), folded: none(), bets: hands.map(() => ANTE), stake: STAKES[0],
    acted: hands.map(() => 0), moves: 0, log: [], compares: [], end: null,
  };
}

export function pot(s: Pick<State, 'bets'>): number {
  return s.bets.reduce((a, b) => a + b, 0);
}

export function remaining(s: Pick<State, 'folded'>): Seat[] {
  return s.folded.flatMap((f, i) => (f ? [] : [i]));
}

/** 这个座位跟一次要付多少：闷着 1 倍单注，看过 2 倍 */
export function callCost(s: Pick<State, 'stake' | 'seen'>, seat: Seat, stake = s.stake): number {
  return stake * (s.seen[seat] ? 2 : 1);
}

export function canLook(s: State, seat: Seat): boolean {
  return !s.seen[seat] && s.acted[seat] >= s.options.blindRounds;
}

/** 从第二轮起能比牌 */
export function canCompare(s: Pick<State, 'acted'>, seat: Seat): boolean {
  return s.acted[seat] >= 1;
}

export function active(s: State): Seat[] {
  return s.phase === 'ended' ? [] : [s.turn];
}

export function validate(s: State, seat: Seat, a: Action): string | null {
  if (s.phase === 'ended') return '这局已经结束了';
  if (seat !== s.turn) return '还没轮到你';
  if (!a || typeof a !== 'object') return '无效操作';
  switch (a.type) {
    case 'look':
      if (s.seen[seat]) return '已经看过牌了';
      if (!canLook(s, seat)) return `前 ${s.options.blindRounds} 轮必须闷牌`;
      return null;
    case 'call':
    case 'fold':
      return null;
    case 'raise':
      if (!STAKES.includes(a.stake)) return '没有这一档';
      if (a.stake <= s.stake) return '加注要比现在的单注大';
      return null;
    case 'compare':
      if (!canCompare(s, seat)) return '第一轮不能比牌';
      if (!Number.isInteger(a.target) || a.target < 0 || a.target >= s.n || a.target === seat) return '选一个人比牌';
      if (s.folded[a.target]) return '他已经弃牌了';
      return null;
    default:
      return '无效操作';
  }
}

function nextLive(folded: boolean[], from: Seat): Seat {
  const n = folded.length;
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    if (!folded[j]) return j;
  }
  return from;
}

export function apply(s: State, seat: Seat, a: Action, _ctx?: { rng: Rng }): State {
  if (a.type === 'look') {
    const seen = s.seen.slice();
    seen[seat] = true;
    return { ...s, seen, log: [...s.log, { seat, type: 'look' }] };
  }
  const bets = s.bets.slice();
  const folded = s.folded.slice();
  const acted = s.acted.slice();
  acted[seat]++;
  let stake = s.stake;
  let compares = s.compares;
  let entry: LogEntry;
  if (a.type === 'fold') {
    folded[seat] = true;
    entry = { seat, type: 'fold' };
  } else if (a.type === 'compare') {
    const cost = callCost(s, seat);
    bets[seat] += cost;
    // 一样大算主动比的人输
    const loser = compareHands(s.hands[seat], s.hands[a.target], s.options.beat235) > 0 ? a.target : seat;
    folded[loser] = true;
    compares = [...compares, { a: seat, b: a.target, loser, auto: false }];
    entry = { seat, type: 'compare', cost, blind: !s.seen[seat], target: a.target, loser };
  } else {
    if (a.type === 'raise') stake = a.stake;
    const cost = callCost(s, seat, stake);
    bets[seat] += cost;
    entry = { seat, type: a.type, cost, blind: !s.seen[seat], ...(a.type === 'raise' ? { stake } : {}) };
  }
  const next: State = { ...s, bets, folded, acted, stake, compares, moves: s.moves + 1, log: [...s.log, entry] };
  const live = remaining(next);
  if (live.length === 1) {
    return { ...next, phase: 'ended', end: { reason: a.type === 'compare' ? 'compare' : 'fold', winner: live[0] } };
  }
  const turn = nextLive(folded, seat);
  // 轮转是按座次的：下一个人都行动满封顶轮数了，说明剩下的人都满了
  if (acted[turn] >= s.options.maxRounds) return capShowdown({ ...next, turn });
  return { ...next, turn };
}

/** 封顶后系统比牌：从下一个该行动的人开始按座次挨个比，一样大算座次靠后（后比）的人输 */
function capShowdown(s: State): State {
  const order: Seat[] = [];
  for (let k = 0; k < s.n; k++) {
    const j = (s.turn + k) % s.n;
    if (!s.folded[j]) order.push(j);
  }
  const folded = s.folded.slice();
  const compares = s.compares.slice();
  let holder = order[0];
  for (const j of order.slice(1)) {
    const loser = compareHands(s.hands[j], s.hands[holder], s.options.beat235) > 0 ? holder : j;
    folded[loser] = true;
    compares.push({ a: j, b: holder, loser, auto: true });
    if (loser === holder) holder = j;
  }
  return { ...s, folded, compares, phase: 'ended', end: { reason: 'cap', winner: holder } };
}

/** 结束时桌上停多久：都弃牌了停一下就好；比牌定胜负要等比牌放完 */
export function endPause(reason: NonNullable<State['end']>['reason']): number {
  return reason === 'fold' ? 800 : COMPARE.end + 400;
}

/** 刚比完牌、刚结束：桌上停一下让人看清 */
export function pause(s: State): number {
  if (s.phase === 'ended') return endPause(s.end?.reason ?? 'fold');
  return s.log[s.log.length - 1]?.type === 'compare' ? COMPARE.end : 0;
}

export function timer(s: State): { ms: number; seats: Seat[]; key: string } | null {
  if (s.phase === 'ended') return null;
  // 看牌不算一次行动，不重新计时
  return { ms: TURN_MS, seats: [s.turn], key: `m${s.moves}` };
}

/** 超时就弃牌：桌上默认的规矩，也免得替人把注下大 */
export function onTimeout(): Action {
  return { type: 'fold' };
}

export function result(s: State): Result | null {
  if (s.phase !== 'ended' || !s.end) return null;
  const total = pot(s);
  const w = s.end.winner;
  const scores = s.bets.map((b, i) => (i === w ? total - b : -b));
  const how =
    s.end.reason === 'fold'
      ? '其他人都弃牌了'
      : s.end.reason === 'compare'
        ? `比牌胜出 · ${KIND_LABEL[classify(s.hands[w]).kind]}`
        : `${s.options.maxRounds} 轮封顶系统比牌 · ${KIND_LABEL[classify(s.hands[w]).kind]}`;
  return {
    winners: [w],
    scores,
    summary: `${how} · 底池 ${total}`,
    // 底池越大这局越"大"：每人平均下 20 分（bot 4 人桌的平均）算 1 倍
    weight: Math.min(3, Math.max(0.5, Math.round((total / (20 * s.n)) * 100) / 100)),
  };
}

/** viewer 知不知道 seat 的牌 */
export function knows(s: State, viewer: Seat | null, seat: Seat): boolean {
  if (s.phase === 'ended') return true;
  if (viewer === null) return false;
  if (viewer === seat) return s.seen[seat] || s.folded[seat];
  return s.compares.some((c) => !c.auto && ((c.a === viewer && c.b === seat) || (c.b === viewer && c.a === seat)));
}

export function view(s: State, seat: Seat | null): View {
  return {
    me: seat,
    phase: s.phase,
    n: s.n,
    options: { ...s.options },
    dealer: s.dealer,
    turn: s.turn,
    round: Math.min(s.options.maxRounds, s.acted[s.turn] + 1),
    stake: s.stake,
    stakes: STAKES,
    ante: ANTE,
    pot: pot(s),
    bets: s.bets.slice(),
    seen: s.seen.slice(),
    folded: s.folded.slice(),
    acted: s.acted.slice(),
    hands: s.hands.map((h, j) => (knows(s, seat, j) ? h.slice() : null)),
    log: s.log.map((e) => ({ ...e })),
    compares: s.compares.map((c) => ({ ...c })),
    end: s.end ? { ...s.end } : null,
  };
}

/** 只有 seat 自己知道的牌：结束前没跟人比过牌的手牌（比过牌的话对方也看到了；结束后全亮） */
export function privateTokens(s: State, seat: Seat): string[] {
  if (s.phase === 'ended') return [];
  if (s.compares.some((c) => !c.auto && (c.a === seat || c.b === seat))) return [];
  return s.hands[seat].slice();
}
