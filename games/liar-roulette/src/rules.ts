/**
 * 唬牌规则，纯函数。
 *
 * 每轮：给活着的人各发 5 张，翻出本轮点数（K/Q/A 之一）。轮到的人扣着出 1–3 张，
 * 声称都是本轮点数（王算万能）。下家要么接着出，要么喊"骗子"翻开上一手：
 * 有一张不对就是上家说谎，上家对自己扣一枪；全对就是喊的人扣一枪。
 * 每人一把六发左轮、一颗子弹，位置开局随机且谁都不知道；第几枪响要看运气，最多第六枪。
 * 每次翻牌后重新发牌开下一轮，活到最后的人赢。
 */
import type { Result, Rng, Seat } from '@couju/sdk';
import { faceOf, HAND_SIZE, JOKERS, makeDeck, matches, perRank, RANKS, sortCards, type Face, type Rank } from './cards.ts';

export const PLAY_MS = 30_000;
export const CHAMBERS = 6;
export const MAX_PLAY = 3;

export type Action = { type: 'play'; cards: string[] } | { type: 'liar' };

export interface Showdown {
  round: number;
  table: Rank;
  /** 喊骗子的人 */
  accuser: Seat;
  /** 被翻牌的人 */
  accused: Seat;
  /** 翻开的点数（不带 id，免得和以后几轮的牌混淆） */
  revealed: Face[];
  lied: boolean;
  /** 扣扳机的人 */
  shooter: Seat;
  /** 这是他的第几枪 */
  shot: number;
  fired: boolean;
}

export interface State {
  phase: 'playing' | 'ended';
  n: number;
  round: number;
  table: Rank;
  hands: string[][];
  /** 本轮没发出去的牌，谁都看不到 */
  undealt: string[];
  turn: Seat;
  /** 本轮扣着出的每一手，按顺序 */
  plays: { seat: Seat; cards: string[] }[];
  alive: boolean[];
  /** 每人已经扣了几次扳机 */
  shots: number[];
  /** 子弹在第几发（1..6），谁都看不到 */
  bullet: number[];
  showdowns: Showdown[];
  /** 出局顺序 */
  out: Seat[];
  winner: Seat | null;
}

export interface View {
  me: Seat | null;
  phase: State['phase'];
  n: number;
  round: number;
  table: Rank;
  hand: string[];
  counts: number[];
  turn: Seat;
  /** 本轮每一手出了几张（公开的只是张数） */
  claims: { seat: Seat; count: number }[];
  /** 我本轮扣着出过的牌（只有自己记得） */
  myPlays: string[][];
  alive: boolean[];
  shots: number[];
  chambers: number;
  showdowns: Showdown[];
  /** 轮到的人只能喊骗子（自己没牌了，或者别人都没牌了） */
  mustCallLiar: boolean;
  /** 整副牌的构成，算概率用 */
  deck: { perRank: number; jokers: number; dealt: number };
  out: Seat[];
  winner: Seat | null;
}

function aliveSeats(s: Pick<State, 'alive'>): Seat[] {
  return s.alive.flatMap((a, i) => (a ? [i] : []));
}

function deal(n: number, alive: boolean[], rng: Rng): { hands: string[][]; undealt: string[]; table: Rank } {
  const deck = rng.shuffle(makeDeck(n));
  let k = 0;
  const hands = alive.map((a) => (a ? sortCards(deck.slice(k, (k += HAND_SIZE))) : []));
  return { hands, undealt: deck.slice(k), table: rng.pick(RANKS) };
}

export function setup({ numPlayers, rng }: { numPlayers: number; rng: Rng }): State {
  const n = numPlayers;
  const alive = Array.from({ length: n }, () => true);
  const bullet = alive.map(() => 1 + rng.int(CHAMBERS));
  const { hands, undealt, table } = deal(n, alive, rng);
  return {
    phase: 'playing', n, round: 1, table, hands, undealt, turn: rng.int(n), plays: [],
    alive, shots: alive.map(() => 0), bullet, showdowns: [], out: [], winner: null,
  };
}

/** seat 出完牌后该谁接：下一个还有牌的活人；都没牌了就是下一个活人（他只能喊骗子） */
function responder(s: Pick<State, 'n' | 'alive' | 'hands'>, seat: Seat): Seat {
  let firstAlive: Seat | null = null;
  for (let k = 1; k < s.n; k++) {
    const j = (seat + k) % s.n;
    if (!s.alive[j]) continue;
    firstAlive ??= j;
    if (s.hands[j].length > 0) return j;
  }
  return firstAlive ?? seat;
}

export function mustCallLiar(s: State): boolean {
  if (s.phase !== 'playing' || s.plays.length === 0) return false;
  if (s.hands[s.turn].length === 0) return true;
  return aliveSeats(s).every((j) => j === s.turn || s.hands[j].length === 0);
}

export function active(s: State): Seat[] {
  return s.phase === 'ended' ? [] : [s.turn];
}

export function validate(s: State, seat: Seat, a: Action): string | null {
  if (s.phase === 'ended') return '这局已经结束了';
  if (seat !== s.turn) return '还没轮到你';
  if (!a || typeof a !== 'object') return '无效操作';
  if (a.type === 'liar') return s.plays.length > 0 ? null : '你是这一轮第一个出牌的，没人可质疑';
  if (a.type !== 'play' || !Array.isArray(a.cards)) return '无效操作';
  if (mustCallLiar(s)) return '只能喊骗子了';
  if (a.cards.length < 1 || a.cards.length > MAX_PLAY) return `一次出 1 到 ${MAX_PLAY} 张`;
  if (new Set(a.cards).size !== a.cards.length) return '有重复的牌';
  const hand = new Set(s.hands[seat]);
  if (!a.cards.every((c) => typeof c === 'string' && hand.has(c))) return '你没有这些牌';
  return null;
}

export function apply(s: State, seat: Seat, a: Action, { rng }: { rng: Rng }): State {
  if (a.type === 'play') {
    const played = new Set(a.cards);
    const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => !played.has(c)) : h));
    const cards = sortCards(a.cards);
    return { ...s, hands, plays: [...s.plays, { seat, cards }], turn: responder({ ...s, hands }, seat) };
  }
  return showdown(s, seat, rng);
}

function showdown(s: State, accuser: Seat, rng: Rng): State {
  const last = s.plays[s.plays.length - 1];
  const lied = last.cards.some((c) => !matches(c, s.table));
  const shooter = lied ? last.seat : accuser;
  const shots = s.shots.slice();
  shots[shooter]++;
  const fired = shots[shooter] >= s.bullet[shooter];
  const alive = s.alive.slice();
  if (fired) alive[shooter] = false;
  const record: Showdown = {
    round: s.round, table: s.table, accuser, accused: last.seat,
    revealed: last.cards.map(faceOf), lied, shooter, shot: shots[shooter], fired,
  };
  const showdowns = [...s.showdowns, record];
  const out = fired ? [...s.out, shooter] : s.out;
  const living = aliveSeats({ alive });
  if (living.length <= 1) {
    return { ...s, alive, shots, showdowns, out, phase: 'ended', winner: living[0] ?? null };
  }
  // 下一轮：扣扳机的人先出；他出局了就是他的下一个活人
  let starter = shooter;
  while (!alive[starter]) starter = (starter + 1) % s.n;
  const { hands, undealt, table } = deal(s.n, alive, rng);
  return { ...s, alive, shots, showdowns, out, round: s.round + 1, table, hands, undealt, plays: [], turn: starter };
}

/**
 * 翻牌动画的时间线（毫秒，从翻牌那一刻算）：喊骗子 → 一张张翻开 → 判定 → 扣扳机 → 枪响。
 * 画面按它放，pause 也按它停，bot 等它放完再出手。只是节奏，不影响规则。
 */
export function showdownTimeline(cards: number) {
  const flip = 400;
  const flipGap = 280;
  const verdict = flip + Math.max(0, cards - 1) * flipGap + 500;
  const trigger = verdict + 500;
  const shot = trigger + 800;
  return { flip, flipGap, verdict, trigger, shot, end: shot + 600 };
}

/** 刚翻完牌（新一轮还没人出，或者这一下决出了胜负）：桌上停到动画放完 */
export function pause(s: State): number {
  const d = s.showdowns[s.showdowns.length - 1];
  if (!d || (s.phase === 'playing' && s.plays.length > 0)) return 0;
  return showdownTimeline(d.revealed.length).end;
}

export function timer(s: State): { ms: number; seats: Seat[] } | null {
  if (s.phase === 'ended') return null;
  return { ms: PLAY_MS, seats: [s.turn] };
}

export function result(s: State): Result | null {
  if (s.phase !== 'ended' || s.winner === null) return null;
  const scores = s.alive.map((_, i) => (i === s.winner ? s.n - 1 : -1));
  const pulls = s.shots.reduce((a, b) => a + b, 0);
  return {
    winners: [s.winner],
    scores,
    summary: `活到最后 · 共 ${s.round} 轮 · 一共扣了 ${pulls} 次扳机`,
  };
}

export function view(s: State, seat: Seat | null): View {
  return {
    me: seat,
    phase: s.phase,
    n: s.n,
    round: s.round,
    table: s.table,
    hand: seat === null ? [] : s.hands[seat].slice(),
    counts: s.hands.map((h) => h.length),
    turn: s.turn,
    claims: s.plays.map((p) => ({ seat: p.seat, count: p.cards.length })),
    myPlays: seat === null ? [] : s.plays.filter((p) => p.seat === seat).map((p) => p.cards.slice()),
    alive: s.alive.slice(),
    shots: s.shots.slice(),
    chambers: CHAMBERS,
    showdowns: s.showdowns.slice(),
    mustCallLiar: mustCallLiar(s),
    deck: { perRank: perRank(s.n), jokers: JOKERS, dealt: aliveSeats(s).length * HAND_SIZE },
    out: s.out.slice(),
    winner: s.winner,
  };
}

/** 只有 seat 自己知道的牌：手牌、本轮自己扣着出的牌；没发出去的牌对谁都是私有的 */
export function privateTokens(s: State, seat: Seat): string[] {
  const mine = s.plays.filter((p) => p.seat === seat).flatMap((p) => p.cards);
  return [...s.hands[seat], ...mine, ...s.undealt];
}
