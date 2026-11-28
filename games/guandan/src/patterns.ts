/**
 * 掼蛋牌型识别与比较（含逢人配）。
 *
 * 牌型：单张、对子、三张、三带二、顺子（5 张）、木板（3 连对）、钢板（2 连三）；
 * 炸弹：4~10 张同点数、同花顺（5 张同花色的顺子）、天王炸（四张王）。
 * 炸弹之间：4 张 < 5 张 < 同花顺 < 6 张 < … < 10 张 < 天王炸；同档比点数。
 */
import { isJoker, isWild, rankOf, suitOf, valueOfRank } from './cards.ts';

export type Kind =
  | 'single' | 'pair' | 'triple' | 'fullHouse' | 'straight' | 'tube' | 'plate'
  | 'bomb' | 'straightFlush' | 'jokerBomb';

export interface Pattern {
  kind: Kind;
  /**
   * 比较用的主值。单张/对子/三张/炸弹：按级牌算的大小（级牌 15）；三带二：三张的大小；
   * 顺子/木板/钢板/同花顺：最高一节的自然位置（A2345 是 5，10JQKA 是 14）。
   */
  main: number;
  size: number;
}

export const KIND_NAME: Record<Kind, string> = {
  single: '单张', pair: '对子', triple: '三张', fullHouse: '三带二', straight: '顺子',
  tube: '木板', plate: '钢板', bomb: '炸弹', straightFlush: '同花顺', jokerBomb: '天王炸',
};

export function isBomb(p: Pick<Pattern, 'kind'>): boolean {
  return p.kind === 'bomb' || p.kind === 'straightFlush' || p.kind === 'jokerBomb';
}

/** 炸弹的档：4 张 = 4，5 张 = 5，同花顺 = 5.5，6 张 = 6 …，天王炸最大 */
export function bombTier(p: Pattern): number {
  if (p.kind === 'jokerBomb') return 100;
  if (p.kind === 'straightFlush') return 5.5;
  return p.size;
}

/** a 能否压过 b */
export function beats(a: Pattern, b: Pattern): boolean {
  const ab = isBomb(a), bb = isBomb(b);
  if (ab && !bb) return true;
  if (!ab && bb) return false;
  if (ab && bb) {
    const ta = bombTier(a), tb = bombTier(b);
    return ta !== tb ? ta > tb : a.main > b.main;
  }
  return a.kind === b.kind && a.size === b.size && a.main > b.main;
}

/** 位置 p（1..14，1 = 当 1 用的 A）对应的自然点数 */
export function rankAt(p: number): number {
  return p === 1 ? 14 : p;
}

/**
 * 连续段：从 start 起 len 节、每节 w 张。naturals 是非配牌的自然点数计数，wilds 是配牌张数。
 * 段外不能有牌，每节不能超过 w 张。返回需要的配牌张数，放不下返回 -1。
 */
function runNeed(c: readonly number[], total: number, start: number, len: number, w: number): number {
  let need = 0, inside = 0;
  for (let p = start; p < start + len; p++) {
    const have = c[rankAt(p)];
    if (have > w) return -1;
    need += w - have;
    inside += have;
  }
  return inside === total ? need : -1;
}

/** 列出这组牌所有合法的牌型解释（同牌型同主值去重） */
export function parse(cards: readonly string[], level: number): Pattern[] {
  const n = cards.length;
  if (n === 0 || n > 10) return [];
  if (n === 1) return [{ kind: 'single', main: valueOfRank(rankOf(cards[0]), level), size: 1 }];
  const naturals = cards.filter((id) => !isWild(id, level));
  const w = n - naturals.length;
  const c = new Array<number>(18).fill(0);
  for (const id of naturals) c[rankOf(id)]++;
  const jokers = c[16] + c[17];
  const distinct: number[] = [];
  for (let r = 2; r <= 17; r++) if (c[r] > 0) distinct.push(r);
  const out: Pattern[] = [];
  const seen = new Set<string>();
  const push = (kind: Kind, main: number) => {
    const k = `${kind}|${main}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, main, size: n });
  };
  const v = (r: number) => valueOfRank(r, level);

  // 同点数的一组：单张、对子、三张、炸弹
  const sameRank = (): number | null => {
    if (distinct.length === 0) return level; // 全是配牌：当级牌本身
    if (distinct.length !== 1) return null;
    const r = distinct[0];
    if (r >= 16 && w > 0) return null; // 配牌不能当王
    return r;
  };
  const r0 = sameRank();
  if (r0 !== null) {
    if (n === 1) push('single', v(r0));
    if (n === 2) push('pair', v(r0));
    if (n === 3 && r0 < 16) push('triple', v(r0));
    if (n >= 4 && r0 < 16) push('bomb', v(r0));
  }
  if (n === 4 && c[16] === 2 && c[17] === 2) push('jokerBomb', 17);

  // 最多两张配牌，三张的点数一定在真牌里。只有一种真牌时，余下两张配牌可作对子。
  if (n === 5 && distinct.length <= 2) {
    for (const t of distinct) {
      if (t >= 16 || c[t] > 3) continue;
      const p = distinct.find((r) => r !== t);
      if (p !== undefined && (c[p] > 2 || (p >= 16 && c[p] !== 2))) continue;
      push('fullHouse', v(t));
    }
  }

  // 顺子 / 同花顺：5 个连续位置各一张
  if (n === 5 && jokers === 0) {
    const suits = new Set(naturals.map(suitOf));
    for (let s = 1; s <= 10; s++) {
      if (runNeed(c, naturals.length, s, 5, 1) !== w) continue;
      push('straight', s + 4);
      if (suits.size <= 1) push('straightFlush', s + 4);
    }
  }
  // 木板：3 连对；钢板：2 连三
  if (n === 6 && jokers === 0) {
    for (let s = 1; s <= 12; s++) if (runNeed(c, naturals.length, s, 3, 2) === w) push('tube', s + 2);
    for (let s = 1; s <= 13; s++) if (runNeed(c, naturals.length, s, 2, 3) === w) push('plate', s + 1);
  }
  return out;
}

/** 越强越靠前：炸弹按档和点数，普通牌型按点数 */
export function strength(p: Pattern): number {
  return isBomb(p) ? 1000 + bombTier(p) * 20 + p.main : p.main;
}

/**
 * 选这手牌的解释。
 * - 指定了 as：必须是合法解释之一（有上家时还得压得过）。
 * - 有上家：优先和上家同牌型（不浪费成炸弹），再看炸弹；同类取最大。
 * - 领出：取最强的解释（5 张同点数优先当炸弹，345 + 配 + 配 当最大的顺子）。
 * 不合法或压不过返回 null。
 */
export function interpret(
  cards: readonly string[],
  level: number,
  prev: Pattern | null,
  as?: { kind: Kind; main: number },
): Pattern | null {
  let ps = parse(cards, level);
  if (prev) ps = ps.filter((p) => beats(p, prev));
  if (as) return ps.find((p) => p.kind === as.kind && p.main === as.main) ?? null;
  if (ps.length === 0) return null;
  if (prev) {
    const same = ps.filter((p) => p.kind === prev.kind);
    if (same.length) ps = same;
    else {
      // 压不过时只能用炸弹：用最小的那个解释
      return ps.slice().sort((a, b) => strength(a) - strength(b))[0];
    }
  }
  return ps.slice().sort((a, b) => strength(b) - strength(a))[0];
}

/**
 * 给人看的一句话："顺子 10–A"、"6 张炸弹 8"、"三带二 7"。
 * 给了 level 时，级牌（主值 15）写成它的点数，比如打 5 时的"对子 5"。
 */
export function describe(p: Pattern, level?: number): string {
  const label = (r: number) =>
    r === 15 ? (level ? RANK_SHORT[level] : '级牌') : r === 16 ? '小王' : r === 17 ? '大王' : r === 1 ? 'A' : RANK_SHORT[r];
  switch (p.kind) {
    case 'straight':
    case 'straightFlush':
      return `${KIND_NAME[p.kind]} ${label(p.main - 4)}–${label(p.main)}`;
    case 'tube':
      return `木板 ${label(p.main - 2)}–${label(p.main)}`;
    case 'plate':
      return `钢板 ${label(p.main - 1)}–${label(p.main)}`;
    case 'bomb':
      return `${p.size} 张炸弹 ${label(p.main)}`;
    case 'jokerBomb':
      return '天王炸';
    default:
      return `${KIND_NAME[p.kind]} ${label(p.main)}`;
  }
}

const RANK_SHORT: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export { isJoker };
