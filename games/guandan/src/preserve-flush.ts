import { bombsOf } from './bot.ts';
import { isWild, rankOf, suitOf, wildsOf } from './cards.ts';
import type { Action, View } from './rules.ts';

/** 最终出牌才择花色：点数、配牌和声明牌型不变，尽量留下现成同花顺。推演不调用。 */
export function preserveFlush(v: View, action: Action): Action {
  if (action.type !== 'play' || !action.as || action.as.kind === 'straightFlush') return action;
  const needs = new Map<number, number>();
  for (const card of action.cards) {
    if (!isWild(card, v.level)) needs.set(rankOf(card), (needs.get(rankOf(card)) ?? 0) + 1);
  }
  const choices = new Map<number, string[]>();
  for (const [rank, count] of needs) {
    const cards = v.hand.filter((c) => !isWild(c, v.level) && rankOf(c) === rank);
    if (cards.length > count && new Set(cards.map(suitOf)).size > 1) choices.set(rank, cards);
  }
  if (!choices.size) return action;

  const weights = new Map<string, number>();
  for (const move of bombsOf(v.hand, v.level)) {
    if (move.p.kind !== 'straightFlush') continue;
    const weight = 1 / (1 + wildsOf(move.cards, v.level).length);
    for (const card of move.cards) {
      if (isWild(card, v.level)) continue;
      const key = suitOf(card) + rankOf(card);
      weights.set(key, (weights.get(key) ?? 0) + weight);
    }
  }
  if (!weights.size) return action;

  const replacements = new Map<number, string[]>();
  for (const [rank, cards] of choices) {
    const selected: string[] = [];
    const left = cards.slice();
    for (let n = 0; n < needs.get(rank)!; n++) {
      let best = 0;
      let bestScore = Infinity;
      for (let i = 0; i < left.length; i++) {
        const suit = suitOf(left[i]);
        const duplicates = left.filter((c) => suitOf(c) === suit).length;
        const score = duplicates > 1 ? 0 : (weights.get(suit + rank) ?? 0);
        if (score < bestScore) { best = i; bestScore = score; }
      }
      selected.push(left.splice(best, 1)[0]);
    }
    replacements.set(rank, selected);
  }
  const cards = action.cards.map((card) => {
    if (isWild(card, v.level)) return card;
    return replacements.get(rankOf(card))?.shift() ?? card;
  });
  return cards.every((c, i) => c === action.cards[i]) ? action : { ...action, cards };
}
