import { beatsOf, naturalShape, planCost, planHand, remainingCost, type Move } from './bot.ts';
import { isWild, valueOf, valueOfRank } from './cards.ts';
import { outstanding } from './counter.ts';
import { isBomb, strength, type Pattern } from './patterns.ts';
import type { Action, View } from './rules.ts';

// 对同一副牌分别接牌、过牌并打到结算，拟合两条路线的净升级差。复算见 BOT.md。
const weights = [
  0.2521, 0.0559, 0.3206, -0.2006, 0.253, -0.3129, -0.0019, 0.1091, -0.0922, 0.0611,
  -0.2287, 0.2574, 0.0338, 0.152, 0.0318, 0.1003, 0.0361, -0.1315, 0.0294, 0.1114,
  0.0144, -0.5954, -0.1545, -0.1923, 0.2572, -0.1638, -0.1699, -0.0806, 0.1974, -0.3199,
  -0.1426, 0.3037, -0.0984, 0.1337, 0.0516, 0.105, 0.0706, -0.035, -0.076, -0.1805,
  -0.0889, 0.0616, -0.0145, -0.1521, -0.1706, 0.1047, 0.1254, 0.0285, 0.1111, 0.1906,
  -0.0228, 0.0631, 0.0192, 0.1254,
];

function strongerCards(unseen: number[], level: number, main: number, width: number): number {
  let mass = 0;
  for (let r = 2; r <= 17; r++) {
    const n = unseen[r];
    if (valueOfRank(r, level) <= main || n < width) continue;
    // 同点牌散在三家；一张就能接时直接计数，成组的牌按数量折算。
    mass += width === 1 ? n : Math.min(n / 2, n * (n - 1) / 12);
  }
  return mass;
}

/** 原策略想过时，找一手不出炸弹、对剩牌结构损失最小的普通跟牌。 */
function cheapestReply(v: View, prev: Pattern, beforeBombs: number): Move | undefined {
  let best: Move | undefined, lowestCost = Infinity;
  for (const move of beatsOf(v.hand, v.level, prev)) {
    if (isBomb(move.p)) continue;
    const cost = remainingCost(v.hand, v.level, move, beforeBombs);
    if (cost < lowestCost || (cost === lowestCost && best && strength(move.p) < strength(best.p))) {
      best = move;
      lowestCost = cost;
    }
  }
  return best;
}

/** 为离线训练和牌桌生成同一组特征。只比较过牌和一手普通跟牌。 */
export function contestExample(v: View, first: Action) {
  const prev = v.lastPlay, me = v.me;
  if (!prev || me === null || prev.seat % 2 === me % 2 || isBomb(prev)) return null;
  const hand = v.hand, level = v.level;
  if (first.type === 'play' && (!first.as || isBomb(first.as) || first.cards.length === hand.length)) return null;
  const before = naturalShape(hand, level);
  const move = first.type === 'pass' ? cheapestReply(v, prev, before.bombs) :
    first.type === 'play' && first.as ? { cards: first.cards, as: first.as, p: { ...first.as, size: first.cards.length } } : null;
  if (!move || move.cards.length === hand.length) return null;
  const used = new Set(move.cards), remainder = hand.filter(c => !used.has(c));
  const after = naturalShape(remainder, level), plan = planHand(remainder, level);
  const naturalGain = before.cost - after.cost;
  const gain = planCost(planHand(hand, level), level) - planCost(plan, level);
  const broken = Math.max(0, before.bombs - after.bombs);
  const wild = move.cards.filter(c => isWild(c, level)).length;
  const highCards = move.cards.filter(c => valueOf(c, level) >= 15).length;
  const p = move.p, size = move.cards.length;
  const single = Number(p.kind === 'single'), pair = Number(p.kind === 'pair');
  const group = !!(single || pair || p.kind === 'triple' || p.kind === 'fullHouse');
  const width = single ? 1 : pair ? 2 : 3;
  const unseen = outstanding(v);
  const aboveReply = group ? strongerCards(unseen, level, p.main, width) : 0;
  const abovePrev = group ? strongerCards(unseen, level, prev.main, width) : 0;
  const next = (me + 1) % 4, partner = v.counts[(me + 2) % 4], owner = v.counts[prev.seat];
  const threat = Math.min(v.counts[next] || 27, v.counts[(me + 3) % 4] || 27);
  const last = Number(prev.seat === next), shortOwner = Number(owner <= 7), control = Number(p.main >= 15);
  const features = [
    // 出牌顺序、各家剩余张数、当前两手牌的形状和大小。
    1, Number(first.type === 'play'), last, hand.length / 27, partner / 27, owner / 27, threat / 27,
    Number(partner === 0), shortOwner, size / 6, p.main / 17, prev.main / 17,
    single, pair, Number(p.kind === 'fullHouse'), Number(p.kind === 'triple'), Number(p.kind === 'straight'),
    Number(p.kind === 'plate'), Number(p.kind === 'tube'),
    // 拆牌代价、控制牌消耗、外面还可能有多少张更大的同型牌。
    naturalGain, gain, broken, wild, highCards, control, Math.min(aboveReply / 12, 1), Math.min(abovePrev / 12, 1),
    Number(group && aboveReply === 0), Number(group && abovePrev <= 2),
    plan.filter(c => c.kind === 'single' && c.main < 11).length / 5, plan.length / 9, plan.filter(isBomb).length / 3,
    Number(plan.length <= 2), plan.filter(c => c.kind === p.kind && c.main > p.main).length / 3,
    // 相同的拆牌代价在单张、对子、长牌以及最后一道关时不同。
    naturalGain * single, naturalGain * pair, gain * Number(size >= 5), gain * last, wild * (1 - shortOwner),
    control * single, control * pair, highCards * Number(size > 3), prev.main / 17 * pair, prev.main / 17 * single,
    last * owner / 27, Number(hand.length <= 12), Number(threat <= 3), Number(group && p.main >= 12 && prev.main >= 11),
    Math.min(aboveReply / 12, 1) * last, Math.min(abovePrev / 12, 1) * owner / 27,
    Number(partner < hand.length && size >= 3), before.bombs / 3,
    Number(!broken && !wild && naturalGain >= 0.9), Number(wild > 0 && highCards > 1),
  ];
  return { action: { type: 'play', cards: move.cards, as: move.as } as Action, features };
}

export function chooseContest(v: View, first: Action): Action {
  const example = contestExample(v, first);
  if (!example) return first;
  const gain = example.features.reduce((sum, x, i) => sum + x * weights[i], 0);
  if (first.type === 'pass' && gain > 0.2) return example.action;
  if (first.type === 'play' && gain < -0.2) return { type: 'pass' };
  return first;
}
