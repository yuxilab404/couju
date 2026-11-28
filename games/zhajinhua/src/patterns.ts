/**
 * 炸金花的牌和牌型，纯函数。
 *
 * 一副 52 张（不要大小王）。牌 id 形如 "S14"：花色 S/H/C/D + 点数 2..14（11=J，12=Q，13=K，14=A）。
 * 牌型从大到小：豹子 > 同花顺 > 同花 > 顺子 > 对子 > 单张。不比花色。
 * 顺子里 Q-K-A 最大，A-2-3 最小。可选规则"235 吃豹子"：不同花色的 2、3、5 只压得过豹子，别的都压不过。
 */
export type Suit = 'S' | 'H' | 'C' | 'D';
export const SUITS: readonly Suit[] = ['S', 'H', 'C', 'D'];
export const RANKS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const HAND_SIZE = 3;

export function makeDeck(): string[] {
  return SUITS.flatMap((s) => RANKS.map((r) => `${s}${r}`));
}

export function suitOf(id: string): Suit {
  return id[0] as Suit;
}
export function rankOf(id: string): number {
  return Number(id.slice(1));
}

const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export function rankLabel(r: number): string {
  return RANK_LABEL[r] ?? String(r);
}

export type Kind = 'high' | 'pair' | 'straight' | 'flush' | 'straightFlush' | 'trips';
/** 从小到大 */
export const KINDS: readonly Kind[] = ['high', 'pair', 'straight', 'flush', 'straightFlush', 'trips'];
export const KIND_LABEL: Record<Kind, string> = {
  trips: '豹子',
  straightFlush: '同花顺',
  flush: '同花',
  straight: '顺子',
  pair: '对子',
  high: '单张',
};

export interface HandValue {
  kind: Kind;
  /** 同牌型内按字典序比大小 */
  key: number[];
  /** 不同花色的 2、3、5（"235 吃豹子"用） */
  is235: boolean;
}

export function classify(ids: readonly string[]): HandValue {
  const r = ids.map(rankOf).sort((a, b) => b - a);
  const flush = ids.every((c) => suitOf(c) === suitOf(ids[0]));
  const is235 = !flush && r[0] === 5 && r[1] === 3 && r[2] === 2;
  if (r[0] === r[2]) return { kind: 'trips', key: [r[0]], is235 };
  // A-2-3 是最小的顺子，按 3 带头算
  const a23 = r[0] === 14 && r[1] === 3 && r[2] === 2;
  const straight = a23 || (r[0] - r[1] === 1 && r[1] - r[2] === 1);
  if (straight) return { kind: flush ? 'straightFlush' : 'straight', key: [a23 ? 3 : r[0]], is235 };
  if (flush) return { kind: 'flush', key: r, is235 };
  if (r[0] === r[1]) return { kind: 'pair', key: [r[0], r[2]], is235 };
  if (r[1] === r[2]) return { kind: 'pair', key: [r[1], r[0]], is235 };
  return { kind: 'high', key: r, is235 };
}

/** 不算 235 特例的大小顺序：>0 是 a 大，<0 是 b 大，0 一样大 */
export function compareValues(a: HandValue, b: HandValue): number {
  const k = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
  if (k !== 0) return k;
  for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
  return 0;
}

/** 两手牌比大小：>0 是 a 大，<0 是 b 大，0 一样大（谁输由规则定：主动比牌的人输） */
export function compareHands(a: readonly string[], b: readonly string[], beat235: boolean): number {
  const va = classify(a);
  const vb = classify(b);
  if (beat235) {
    if (va.kind === 'trips' && vb.is235) return -1;
    if (vb.kind === 'trips' && va.is235) return 1;
  }
  return compareValues(va, vb);
}

/** 给人看的牌型说明，如"对子 · 一对 K"、"顺子 · Q-K-A" */
export function describe(ids: readonly string[]): string {
  const v = classify(ids);
  switch (v.kind) {
    case 'trips':
      return `豹子 · 三个 ${rankLabel(v.key[0])}`;
    case 'pair':
      return `对子 · 一对 ${rankLabel(v.key[0])}`;
    case 'straight':
    case 'straightFlush': {
      const top = v.key[0];
      const seq = top === 3 ? [14, 2, 3] : [top - 2, top - 1, top];
      return `${KIND_LABEL[v.kind]} · ${seq.map(rankLabel).join('-')}`;
    }
    case 'flush':
      return `同花 · ${rankLabel(v.key[0])} 带头`;
    default:
      return v.is235 ? '单张 · 235' : `单张 · ${rankLabel(v.key[0])} 带头`;
  }
}

/** 手牌按点数从大到小排（同点按花色） */
export function sortHand(ids: readonly string[]): string[] {
  return ids.slice().sort((a, b) => rankOf(b) - rankOf(a) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)));
}
