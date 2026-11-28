/**
 * 补位 bot：只看自己的视图。
 *
 * 没看牌时闷着跟，偶尔闷着加注；轮数越多、单注越大越想看牌（必闷轮内不看）。
 * 看了牌按牌力估胜率：这手牌在所有三张牌组合里排第几（百分位），对每个还没弃牌的对手乘一次，
 * 看过牌还不走的对手手里大概率不差，多乘一点。胜率够付这一注就跟，很大就加注，
 * 差一点就找人比牌（优先挑闷着的人），再差就弃牌，偶尔诈一下。
 */
import type { Bot, Rng, Seat } from '@couju/sdk';
import { classify, compareValues, makeDeck, type HandValue } from './patterns.ts';
import type { Action, View } from './rules.ts';

let table: HandValue[] | null = null;
/** 所有 22100 种三张牌按大小排好（不算 235 特例），算百分位用 */
function allHands(): HandValue[] {
  if (table) return table;
  const deck = makeDeck();
  const out: HandValue[] = [];
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++)
      for (let k = j + 1; k < deck.length; k++) out.push(classify([deck[i], deck[j], deck[k]]));
  out.sort(compareValues);
  return (table = out);
}

/** 这手牌比随机一手牌大的概率（一样大算一半） */
export function strength(hand: readonly string[]): number {
  const v = classify(hand);
  const all = allHands();
  let lo = 0;
  let hi = all.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (compareValues(all[m], v) < 0) lo = m + 1;
    else hi = m;
  }
  let eq = lo;
  while (eq < all.length && compareValues(all[eq], v) === 0) eq++;
  return (lo + (eq - lo) / 2) / all.length;
}

function opponents(v: View, me: Seat): Seat[] {
  return v.folded.flatMap((f, i) => (f || i === me ? [] : [i]));
}

/** 估计赢下这局的概率 */
export function winChance(v: View, me: Seat, hand: readonly string[]): number {
  const p = strength(hand);
  let w = 1;
  for (const j of opponents(v, me)) {
    // 看过牌还跟着的人手里一般不差；闷着的人就是一手随机牌
    const stayedSeen = v.log.some((e) => e.seat === j && e.blind === false);
    w *= Math.pow(p, stayedSeen ? 1.8 : 1);
  }
  return w;
}

function canRaise(v: View): number | null {
  const higher = v.stakes.filter((x) => x > v.stake);
  return higher.length ? higher[0] : null;
}

function compareTarget(v: View, me: Seat, rng: Rng): Seat {
  const opp = opponents(v, me);
  const blind = opp.filter((j) => !v.seen[j]);
  return rng.pick(blind.length ? blind : opp);
}

export function decide(v: View, rng: Rng): Action {
  const me = v.me ?? v.turn;
  const hand = v.hands[me];
  const opp = opponents(v, me);
  const mayCompare = v.acted[me] >= 1;
  const mayLook = !v.seen[me] && v.acted[me] >= v.options.blindRounds;
  const lastRound = v.acted[me] + 1 >= v.options.maxRounds;

  if (!v.seen[me] || !hand) {
    if (mayLook) {
      const pLook = 0.3 + 0.18 * v.acted[me] + (v.stake >= 3 ? 0.25 : 0) + (lastRound ? 1 : 0);
      if (rng.next() < pLook) return { type: 'look' };
    }
    // 闷着：一个对手、轮数不少了，偶尔闷比
    if (mayCompare && opp.length === 1 && v.acted[me] >= 2 && rng.next() < 0.2) return { type: 'compare', target: opp[0] };
    const up = canRaise(v);
    if (up !== null && v.stake < 3 && rng.next() < 0.12) return { type: 'raise', stake: up };
    return { type: 'call' };
  }

  const w = winChance(v, me, hand);
  const cost = v.stake * 2;
  const need = cost / (v.pot + cost);
  const noise = (rng.next() - 0.5) * 0.1;

  // 最后一轮：要么比，要么走
  if (lastRound && mayCompare) {
    if (w + noise > need * 0.8) return { type: 'compare', target: compareTarget(v, me, rng) };
    return { type: 'fold' };
  }
  if (w + noise > 0.55) {
    const up = canRaise(v);
    if (up !== null && rng.next() < 0.5) return { type: 'raise', stake: up };
    // 牌很大、只剩一个人、轮数够了：开牌收底池
    if (mayCompare && opp.length === 1 && v.acted[me] >= 3 && rng.next() < 0.3) return { type: 'compare', target: opp[0] };
    return { type: 'call' };
  }
  if (w + noise > need * 1.3) return { type: 'call' };
  if (mayCompare && w + noise > need * 0.7) return { type: 'compare', target: compareTarget(v, me, rng) };
  // 诈一下：只在单注还小的时候
  if (v.stake <= 2 && rng.next() < 0.08) return { type: 'call' };
  return { type: 'fold' };
}

export const bot: Bot<View, Action> = {
  decide: (v, ctx) => decide(v, ctx.rng),
};
