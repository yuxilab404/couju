/**
 * 牌：K、Q、A 三种点数各若干张，加 2 张王（万能牌，算作任何点数）。
 * 牌 id 形如 "K3"、"W1"；只在一轮之内唯一，每轮重新洗发。
 */
export type Rank = 'K' | 'Q' | 'A';
/** 翻开时公开的点数；W = 王 */
export type Face = Rank | 'W';

export const RANKS: readonly Rank[] = ['K', 'Q', 'A'];
export const JOKERS = 2;
export const HAND_SIZE = 5;

/** 3–4 人每种 6 张（共 20 张），5 人每种 8 张（共 26 张），保证每人 5 张发得出 */
export function perRank(numPlayers: number): number {
  return numPlayers <= 4 ? 6 : 8;
}

export function makeDeck(numPlayers: number): string[] {
  const out: string[] = [];
  for (const r of RANKS) for (let i = 1; i <= perRank(numPlayers); i++) out.push(`${r}${i}`);
  for (let i = 1; i <= JOKERS; i++) out.push(`W${i}`);
  return out;
}

export function faceOf(id: string): Face {
  return id[0] as Face;
}

/** 这张牌算不算本轮的点数（王永远算） */
export function matches(id: string, table: Rank): boolean {
  const f = faceOf(id);
  return f === 'W' || f === table;
}

/** 整副牌里能当作某个点数出的牌一共几张 */
export function matchingTotal(numPlayers: number): number {
  return perRank(numPlayers) + JOKERS;
}

const ORDER: Record<Face, number> = { W: 0, A: 1, K: 2, Q: 3 };
export function sortCards(ids: readonly string[]): string[] {
  return ids.slice().sort((a, b) => ORDER[faceOf(a)] - ORDER[faceOf(b)] || Number(a.slice(1)) - Number(b.slice(1)));
}

export const FACE_LABEL: Record<Face, string> = { K: 'K', Q: 'Q', A: 'A', W: '王' };
