/**
 * 补位 bot：只看自己的视图。
 * 喊不喊骗子：先用牌数算死账（声称的张数超过别人手里最多可能有的就一定是假的），
 * 算不死就按张数、这一轮别人已经声称了多少、自己有没有真牌可出估一个怀疑度，再加一点随机。
 * 出牌：有真牌出 1–3 张真牌，偶尔夹一张假的；没有真牌只能吹牛，出 1 张（偶尔 2 张）。
 */
import type { Bot, Rng } from '@couju/sdk';
import { matches } from './cards.ts';
import { MAX_PLAY, type Action, type View } from './rules.ts';

/** 我知道的、能当本轮点数的牌：手里的 + 本轮我扣着出的 */
function myMatching(v: View): number {
  return [...v.hand, ...v.myPlays.flat()].filter((c) => matches(c, v.table)).length;
}

/** 上一手是假的的估计概率（0..1） */
export function suspicion(v: View): number {
  const last = v.claims[v.claims.length - 1];
  if (!last) return 0;
  const total = v.deck.perRank + v.deck.jokers;
  const othersMax = total - myMatching(v);
  if (last.count > othersMax) return 1;
  const othersClaimed = v.claims.filter((c) => c.seat !== v.me).reduce((m, c) => m + c.count, 0);
  if (othersClaimed > othersMax) return 0.9;
  let p = [0, 0.1, 0.22, 0.36][last.count] ?? 0.36;
  p += 0.4 * (othersClaimed / Math.max(1, othersMax));
  if (v.counts[last.seat] === 0) p += 0.08;
  const myTruth = v.hand.filter((c) => matches(c, v.table)).length;
  if (myTruth === 0) p += 0.2; // 不喊就得吹牛，喊的代价相对小
  return Math.min(0.95, p);
}

export function shouldCallLiar(v: View, rng: Rng): boolean {
  if (v.mustCallLiar) return true;
  if (v.claims.length === 0) return false;
  const p = suspicion(v);
  if (p >= 1) return true;
  return p + (rng.next() - 0.5) * 0.3 > 0.5;
}

export function choosePlay(v: View, rng: Rng): string[] {
  const truth = v.hand.filter((c) => matches(c, v.table));
  const fake = v.hand.filter((c) => !matches(c, v.table));
  // 真牌先出普通的，王留到后面
  truth.sort((a, b) => Number(a[0] === 'W') - Number(b[0] === 'W'));
  if (truth.length === 0) {
    const k = fake.length >= 4 && rng.next() < 0.3 ? 2 : 1;
    return rng.shuffle(fake).slice(0, k);
  }
  const k = 1 + rng.int(Math.min(MAX_PLAY, truth.length));
  const cards = truth.slice(0, k);
  if (cards.length < MAX_PLAY && fake.length > 0 && rng.next() < 0.2) cards.push(rng.pick(fake));
  return cards;
}

export function decide(v: View, rng: Rng): Action {
  if (shouldCallLiar(v, rng)) return { type: 'liar' };
  return { type: 'play', cards: choosePlay(v, rng) };
}

export const bot: Bot<View, Action> = {
  decide: (v, ctx) => decide(v, ctx.rng),
};
