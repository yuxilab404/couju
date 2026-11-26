/**
 * 掼蛋的牌：两副 108 张。id 形如 "S05a"（花色 + 两位点数 + 第几副），大小王是 "J16a"/"J17b"。
 * 点数：2..14 = 2..A，16 = 小王，17 = 大王。加引号后任意两个 id 互不包含（conformance 私有信息检查用）。
 *
 * 大小要看本副的级牌 L：单张、对子、三张、三带二和炸弹里，级牌排在 A 之上、小王之下（记作 15）；
 * 顺子、木板、钢板、同花顺里，级牌回到自己本来的位置，A 既可以当 1 也可以当 14。
 * 红桃级牌是"逢人配"（配牌），能当除大小王以外的任何牌。
 */
import type { CardFace } from '@couju/kit-cards';

export const SUITS = ['S', 'H', 'C', 'D'] as const;
export type SuitCode = (typeof SUITS)[number] | 'J';
const SUIT_ORDER: Record<string, number> = { J: 0, H: 1, S: 2, C: 3, D: 4 };

export const RANK_LABEL: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王',
};

export function rankOf(id: string): number {
  return Number(id.slice(1, 3));
}
export function suitOf(id: string): SuitCode {
  return id[0] as SuitCode;
}
export function isJoker(id: string): boolean {
  return id[0] === 'J';
}
/** 红桃级牌：配牌 */
export function isWild(id: string, level: number): boolean {
  return id[0] === 'H' && rankOf(id) === level;
}

/** 单张、对子、三张、炸弹里的大小：级牌 = 15 */
export function valueOfRank(rank: number, level: number): number {
  return rank === level ? 15 : rank;
}
export function valueOf(id: string, level: number): number {
  return valueOfRank(rankOf(id), level);
}

export function makeDeck(): string[] {
  const deck: string[] = [];
  for (const d of ['a', 'b']) {
    for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push(`${s}${String(r).padStart(2, '0')}${d}`);
    deck.push(`J16${d}`, `J17${d}`);
  }
  return deck;
}

/** 大到小：大小王、级牌（配牌在前）、A、K …；同点数按花色 */
export function sortCards(ids: readonly string[], level: number): string[] {
  return ids
    .slice()
    .sort((a, b) => valueOf(b, level) - valueOf(a, level) || SUIT_ORDER[a[0]] - SUIT_ORDER[b[0]] || (a < b ? -1 : 1));
}

/** 按自然点数计数（下标 0..17），不含配牌 */
export function countNatural(ids: readonly string[], level: number): number[] {
  const c = new Array<number>(18).fill(0);
  for (const id of ids) if (!isWild(id, level)) c[rankOf(id)]++;
  return c;
}

export function wildsOf(ids: readonly string[], level: number): string[] {
  return ids.filter((id) => isWild(id, level));
}

export function faceOf(id: string, level: number): CardFace {
  const r = rankOf(id);
  if (r === 16) return { id, label: '小王', suit: 'JB' };
  if (r === 17) return { id, label: '大王', suit: 'JR' };
  const face: CardFace = { id, label: RANK_LABEL[r], suit: id[0] as CardFace['suit'] };
  if (isWild(id, level)) face.badge = '配';
  else if (r === level) face.badge = '级';
  return face;
}

export function cardsText(ids: readonly string[], level: number): string {
  return sortCards(ids, level)
    .map((id) => (isWild(id, level) ? '配' : RANK_LABEL[rankOf(id)]))
    .join(' ');
}
