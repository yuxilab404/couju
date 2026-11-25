/** 斗地主规则：叫 1/2/3 分，纯函数。 */
import type { Result, Rng, Seat } from '@couju/sdk';
import { cardsText, countCards, makeDeck, rankOf, sortCards } from './cards.ts';
import { interpret, isBomb, KIND_NAME, type Kind, type Pattern } from './patterns.ts';

export const BID_MS = 15_000;
export const PLAY_MS = 30_000;
/** 连续这么多次都不叫，强制首叫者 1 分当地主 */
export const MAX_REDEALS = 3;

export type Action =
  | { type: 'bid'; score: 0 | 1 | 2 | 3 }
  | { type: 'play'; cards: string[] }
  | { type: 'pass' };

export interface PlayInfo extends Pattern {
  seat: Seat;
  cards: string[];
  name: string;
}

export type Recent = string[] | 'pass' | null;

export interface State {
  phase: 'bidding' | 'playing' | 'ended';
  hands: string[][];
  bottom: string[];
  redeals: number;
  firstBidder: Seat;
  bids: { seat: Seat; score: number }[];
  turn: Seat;
  landlord: Seat | null;
  baseScore: number;
  bombs: number;
  /** 本轮目前最大的一手；null = 轮到的人自由出牌 */
  lastPlay: PlayInfo | null;
  passes: number;
  /** 本轮每个座位最近的动作，给画面用 */
  recent: Recent[];
  history: { seat: Seat; cards: string[] | null }[];
  /** 每个座位出过几手（不含不要），算春天用 */
  playsBy: number[];
  winner: Seat | null;
}

export interface View {
  me: Seat | null;
  phase: State['phase'];
  hand: string[];
  counts: number[];
  landlord: Seat | null;
  firstBidder: Seat;
  bids: { seat: Seat; score: number }[];
  maxBid: number;
  /** 定地主后公开 */
  bottom: string[] | null;
  turn: Seat;
  lastPlay: PlayInfo | null;
  recent: Recent[];
  history: { seat: Seat; cards: string[] | null }[];
  bombs: number;
  multiplier: number;
  baseScore: number;
  redeals: number;
  /** 结束后公开所有人剩下的牌 */
  revealed: string[][] | null;
  winner: Seat | null;
}

function deal(rng: Rng): { hands: string[][]; bottom: string[] } {
  const deck = rng.shuffle(makeDeck());
  return {
    hands: [0, 1, 2].map((i) => sortCards(deck.slice(i * 17, i * 17 + 17))),
    bottom: sortCards(deck.slice(51)),
  };
}

export function setup({ rng }: { rng: Rng }): State {
  const { hands, bottom } = deal(rng);
  const first = rng.int(3);
  return {
    phase: 'bidding', hands, bottom, redeals: 0, firstBidder: first, bids: [], turn: first,
    landlord: null, baseScore: 0, bombs: 0, lastPlay: null, passes: 0,
    recent: [null, null, null], history: [], playsBy: [0, 0, 0], winner: null,
  };
}

export function maxBid(s: Pick<State, 'bids'>): number {
  return s.bids.reduce((m, b) => Math.max(m, b.score), 0);
}

export function multiplier(s: State): number {
  let m = 2 ** s.bombs;
  if (s.winner !== null && (isSpring(s) || isAntiSpring(s))) m *= 2;
  return m;
}

function isSpring(s: State): boolean {
  if (s.landlord === null || s.winner !== s.landlord) return false;
  return s.playsBy.every((n, i) => i === s.landlord || n === 0);
}
function isAntiSpring(s: State): boolean {
  if (s.landlord === null || s.winner === null || s.winner === s.landlord) return false;
  return s.playsBy[s.landlord] === 1;
}

export function active(s: State): Seat[] {
  return s.phase === 'ended' ? [] : [s.turn];
}

export function validate(s: State, seat: Seat, a: Action): string | null {
  if (s.phase === 'ended') return '这局已经结束了';
  if (seat !== s.turn) return '还没轮到你';
  if (!a || typeof a !== 'object') return '无效操作';
  if (a.type === 'bid') {
    if (s.phase !== 'bidding') return '现在不是叫分阶段';
    if (![0, 1, 2, 3].includes(a.score)) return '只能叫 1、2、3 分或不叫';
    if (a.score !== 0 && a.score <= maxBid(s)) return `要叫比 ${maxBid(s)} 分更高的分`;
    return null;
  }
  if (s.phase !== 'playing') return '现在还不能出牌';
  if (a.type === 'pass') return s.lastPlay ? null : '你先出，不能不要';
  if (a.type !== 'play' || !Array.isArray(a.cards) || a.cards.length === 0) return '请选择要出的牌';
  if (new Set(a.cards).size !== a.cards.length) return '有重复的牌';
  const hand = new Set(s.hands[seat]);
  if (!a.cards.every((c) => typeof c === 'string' && hand.has(c))) return '你没有这些牌';
  const p = interpret(a.cards.map(rankOf), null);
  if (!p) return '不是合法的牌型';
  if (s.lastPlay && !interpret(a.cards.map(rankOf), s.lastPlay)) return `管不上${s.lastPlay.name}`;
  return null;
}

export function apply(s: State, seat: Seat, a: Action, { rng }: { rng: Rng }): State {
  if (a.type === 'bid') return applyBid(s, seat, a.score, rng);
  if (a.type === 'pass') {
    const passes = s.passes + 1;
    const recent = s.recent.slice();
    recent[seat] = 'pass';
    const trickOver = passes >= 2;
    return {
      ...s,
      passes: trickOver ? 0 : passes,
      lastPlay: trickOver ? null : s.lastPlay,
      recent,
      history: [...s.history, { seat, cards: null }],
      turn: (seat + 1) % 3,
    };
  }
  const cards = sortCards(a.cards);
  const p = interpret(cards.map(rankOf), s.lastPlay)!;
  const played = new Set(cards);
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => !played.has(c)) : h));
  const recent: Recent[] = s.lastPlay ? s.recent.slice() : [null, null, null];
  recent[seat] = cards;
  const playsBy = s.playsBy.slice();
  playsBy[seat]++;
  const done = hands[seat].length === 0;
  return {
    ...s,
    hands,
    lastPlay: { ...p, seat, cards, name: KIND_NAME[p.kind] },
    passes: 0,
    bombs: s.bombs + (isBomb(p) ? 1 : 0),
    recent,
    history: [...s.history, { seat, cards }],
    playsBy,
    turn: done ? seat : (seat + 1) % 3,
    winner: done ? seat : null,
    phase: done ? 'ended' : 'playing',
  };
}

function applyBid(s: State, seat: Seat, score: number, rng: Rng): State {
  const bids = [...s.bids, { seat, score }];
  if (score === 3) return becomeLandlord(s, seat, 3, bids);
  if (bids.length < 3) return { ...s, bids, turn: (seat + 1) % 3 };
  const best = bids.reduce((m, b) => (b.score > m.score ? b : m), bids[0]);
  if (best.score > 0) return becomeLandlord(s, best.seat, best.score, bids);
  const redeals = s.redeals + 1;
  if (redeals >= MAX_REDEALS) return becomeLandlord({ ...s, redeals }, s.firstBidder, 1, bids);
  const { hands, bottom } = deal(rng);
  const first = rng.int(3);
  return { ...s, hands, bottom, redeals, firstBidder: first, bids: [], turn: first };
}

function becomeLandlord(s: State, seat: Seat, score: number, bids: State['bids']): State {
  const hands = s.hands.map((h, i) => (i === seat ? sortCards([...h, ...s.bottom]) : h));
  return { ...s, bids, hands, landlord: seat, baseScore: score, phase: 'playing', turn: seat };
}

export function timer(s: State): { ms: number; seats: Seat[] } | null {
  if (s.phase === 'ended') return null;
  return { ms: s.phase === 'bidding' ? BID_MS : PLAY_MS, seats: [s.turn] };
}

export function result(s: State): Result | null {
  if (s.phase !== 'ended' || s.winner === null || s.landlord === null) return null;
  const L = s.landlord;
  const landlordWin = s.winner === L;
  const mult = multiplier(s);
  const total = s.baseScore * mult;
  const scores = [0, 1, 2].map((i) => (i === L ? 2 * total : -total) * (landlordWin ? 1 : -1));
  const tags = [landlordWin ? '地主获胜' : '农民获胜'];
  if (isSpring(s)) tags.push('春天');
  if (isAntiSpring(s)) tags.push('反春');
  if (s.bombs) tags.push(`炸弹 ×${s.bombs}`);
  tags.push(`${s.baseScore} 分 ×${mult} = ${total}`);
  return {
    winners: landlordWin ? [L] : [0, 1, 2].filter((i) => i !== L),
    scores,
    summary: tags.join(' · '),
  };
}

export function view(s: State, seat: Seat | null): View {
  const revealedBottom = s.landlord !== null;
  return {
    me: seat,
    phase: s.phase,
    hand: seat === null ? [] : s.hands[seat].slice(),
    counts: s.hands.map((h) => h.length),
    landlord: s.landlord,
    firstBidder: s.firstBidder,
    bids: s.bids.slice(),
    maxBid: maxBid(s),
    bottom: revealedBottom ? s.bottom.slice() : null,
    turn: s.turn,
    lastPlay: s.lastPlay,
    recent: s.recent.slice(),
    history: s.history.slice(),
    bombs: s.bombs,
    multiplier: multiplier(s),
    baseScore: s.baseScore,
    redeals: s.redeals,
    revealed: s.phase === 'ended' ? s.hands.map((h) => h.slice()) : null,
    winner: s.winner,
  };
}

/** 只有 seat 自己能看到的牌：手里还没公开的牌；未公开的底牌对所有人都是私有的 */
export function privateTokens(s: State, seat: Seat): string[] {
  if (s.phase === 'ended') return [];
  const publicBottom = s.landlord !== null ? new Set(s.bottom) : new Set<string>();
  const mine = s.hands[seat].filter((c) => !publicBottom.has(c));
  return s.landlord === null ? [...mine, ...s.bottom] : mine;
}

export function describePlay(cards: readonly string[]): string {
  const p = interpret(cards.map(rankOf), null);
  return p ? `${KIND_NAME[p.kind]} ${cardsText(cards)}` : cardsText(cards);
}

export { countCards };
export type { Kind };
