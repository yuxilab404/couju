/**
 * 记牌器：两副牌减去自己的手牌、减去本副已经打出的牌，按点数数出还在别人手里的张数。
 * 进贡、还贡的牌换了主人：进来的已经在自己手里，送出去的在别人手里，照样算得对。
 * 只用视图里本来就能看到的信息，不泄露隐藏信息。
 */
import { makeDeck, rankOf } from './cards.ts';
import type { View } from './rules.ts';

/** 从大到小：大王、小王、A、K … 2（级牌在记牌器里仍按点数摆，格子会标出来） */
export const COUNTER_RANKS = [17, 16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;

const deckCounts = new Array<number>(18).fill(0);
for (const id of makeDeck()) deckCounts[rankOf(id)]++;

/** 下标是点数（2..17），值是别人手里还剩几张 */
export function outstanding(v: Pick<View, 'hand' | 'history'>): number[] {
  const left = deckCounts.slice();
  for (const id of v.hand) left[rankOf(id)]--;
  for (const h of v.history) for (const id of h.cards ?? []) left[rankOf(id)]--;
  return left;
}
