/**
 * 记牌器：一副牌减去自己的手牌、减去已经打出的牌，按点数数出还在别人手里的张数。
 * 只用视图里本来就能看到的信息（自己的手牌 + 公开的出牌记录），不泄露任何隐藏信息。
 */
import { makeDeck, rankOf } from './cards.ts';
import type { View } from './rules.ts';

/** 从大到小：大王、小王、2、A、K … 3 */
export const COUNTER_RANKS = [17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3] as const;

/** 下标是点数（3..17），值是别人手里还剩几张 */
export function outstanding(v: Pick<View, 'hand' | 'history'>): number[] {
  const left = new Array<number>(18).fill(0);
  for (const id of makeDeck()) left[rankOf(id)]++;
  for (const id of v.hand) left[rankOf(id)]--;
  for (const h of v.history) for (const id of h.cards ?? []) left[rankOf(id)]--;
  return left;
}
