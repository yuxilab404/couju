/**
 * 斗地主的牌。id 形如 "S03"（花色 + 两位点数），大小王为 "J16"/"J17"。
 * 点数：3..14 = 3..A，15 = 2，16 = 小王，17 = 大王。
 * 加引号后任意两个 id 互不包含，方便 conformance 的私有信息检查。
 */
import type { CardFace } from '@couju/kit-cards';

export const SUITS = ['S', 'H', 'C', 'D'] as const;
const SUIT_ORDER: Record<string, number> = { J: 0, S: 1, H: 2, C: 3, D: 4 };

export const RANK_LABEL: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

export function rankOf(id: string): number {
  return Number(id.slice(1));
}

export function makeDeck(): string[] {
  const deck: string[] = [];
  for (const s of SUITS) for (let r = 3; r <= 15; r++) deck.push(`${s}${String(r).padStart(2, '0')}`);
  deck.push('J16', 'J17');
  return deck;
}

/** 大到小排序（同点数按花色） */
export function sortCards(ids: readonly string[]): string[] {
  return ids.slice().sort((a, b) => rankOf(b) - rankOf(a) || SUIT_ORDER[a[0]] - SUIT_ORDER[b[0]]);
}

/** 按点数计数，下标 0..17 */
export function countRanks(ranks: readonly number[]): number[] {
  const c = new Array<number>(18).fill(0);
  for (const r of ranks) c[r]++;
  return c;
}

export function countCards(ids: readonly string[]): number[] {
  return countRanks(ids.map(rankOf));
}

/** 从手牌里按点数多重集取出具体的牌 id；取不到返回 null */
export function pickCards(hand: readonly string[], ranks: readonly number[]): string[] | null {
  const pool = hand.slice();
  const out: string[] = [];
  for (const r of ranks) {
    const i = pool.findIndex((id) => rankOf(id) === r);
    if (i < 0) return null;
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

export function faceOf(id: string): CardFace {
  const r = rankOf(id);
  if (r === 16) return { id, label: '小王', suit: 'JB' };
  if (r === 17) return { id, label: '大王', suit: 'JR' };
  return { id, label: RANK_LABEL[r], suit: id[0] as CardFace['suit'] };
}

export function cardsText(ids: readonly string[]): string {
  return sortCards(ids).map((id) => RANK_LABEL[rankOf(id)]).join(' ');
}
