/** 牌型识别与比较。只看点数，不看花色。 */
import { countRanks } from './cards.ts';

export type Kind =
  | 'single' | 'pair' | 'triple' | 'triple1' | 'triple2'
  | 'straight' | 'pairs' | 'plane' | 'plane1' | 'plane2'
  | 'four2' | 'four22' | 'bomb' | 'rocket';

export interface Pattern {
  kind: Kind;
  /** 比较用的主值：链取最高点，带牌取主体点数 */
  main: number;
  /** 链的节数（顺子张数、连对对数、飞机三张数），其余为 1 */
  len: number;
  size: number;
}

export const KIND_NAME: Record<Kind, string> = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带对',
  straight: '顺子', pairs: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
  four2: '四带二', four22: '四带两对', bomb: '炸弹', rocket: '王炸',
};

/** 领出时多种解释的优先顺序 */
const PRIORITY: Kind[] = [
  'rocket', 'bomb', 'straight', 'pairs', 'plane', 'plane2', 'plane1',
  'four22', 'four2', 'triple2', 'triple1', 'triple', 'pair', 'single',
];

export function isBomb(p: Pattern): boolean {
  return p.kind === 'bomb' || p.kind === 'rocket';
}

/** 连续段 [top-len+1, top] 上每个点数都至少 w 张 */
function runOk(c: number[], top: number, len: number, w: number): boolean {
  if (top > 14 || top - len + 1 < 3) return false;
  for (let r = top - len + 1; r <= top; r++) if (c[r] < w) return false;
  return true;
}

/** 列出这组点数所有合法的牌型解释 */
export function parse(ranks: readonly number[]): Pattern[] {
  const n = ranks.length;
  if (n === 0) return [];
  const c = countRanks(ranks);
  const distinct: number[] = [];
  for (let r = 3; r <= 17; r++) if (c[r] > 0) distinct.push(r);
  const out: Pattern[] = [];
  const push = (kind: Kind, main: number, len = 1) => out.push({ kind, main, len, size: n });
  const maxC = Math.max(...distinct.map((r) => c[r]));
  const consecutive = distinct[distinct.length - 1] - distinct[0] === distinct.length - 1;
  const top = distinct[distinct.length - 1];

  if (n === 1) push('single', distinct[0]);
  if (n === 2) {
    if (c[16] === 1 && c[17] === 1) push('rocket', 17);
    else if (distinct.length === 1) push('pair', distinct[0]);
  }
  if (n === 3 && distinct.length === 1) push('triple', distinct[0]);
  if (n === 4 && distinct.length === 1) push('bomb', distinct[0]);
  if (n === 4 && distinct.length === 2) {
    const t = distinct.find((r) => c[r] === 3);
    if (t !== undefined) push('triple1', t);
  }
  if (n === 5 && distinct.length === 2) {
    const t = distinct.find((r) => c[r] === 3);
    const p = distinct.find((r) => c[r] === 2);
    if (t !== undefined && p !== undefined) push('triple2', t);
  }
  if (n >= 5 && maxC === 1 && consecutive && top <= 14) push('straight', top, n);
  if (n >= 6 && n % 2 === 0 && distinct.every((r) => c[r] === 2) && consecutive && top <= 14) push('pairs', top, n / 2);
  if (n >= 6 && n % 3 === 0 && distinct.every((r) => c[r] === 3) && consecutive && top <= 14) push('plane', top, n / 3);

  // 飞机带单：k 个连续三张 + k 张任意（不能同时带大小王）
  if (n >= 8 && n % 4 === 0) {
    const k = n / 4;
    for (let t = 14; t >= 3 + k - 1; t--) {
      if (!runOk(c, t, k, 3)) continue;
      const rest = c.slice();
      for (let r = t - k + 1; r <= t; r++) rest[r] -= 3;
      if (rest[16] && rest[17]) continue;
      push('plane1', t, k);
    }
  }
  // 飞机带对：k 个连续三张 + k 对（不含王）
  if (n >= 10 && n % 5 === 0) {
    const k = n / 5;
    for (let t = 14; t >= 3 + k - 1; t--) {
      if (!runOk(c, t, k, 3)) continue;
      const rest = c.slice();
      for (let r = t - k + 1; r <= t; r++) rest[r] -= 3;
      if (rest[16] || rest[17]) continue;
      if (rest.every((x) => x % 2 === 0)) push('plane2', t, k);
    }
  }
  // 四带二（两张任意，不能是大小王）/ 四带两对
  for (const f of distinct) {
    if (c[f] !== 4 || f > 15) continue;
    const rest = c.slice();
    rest[f] = 0;
    if (n === 6 && !(rest[16] && rest[17])) push('four2', f);
    if (n === 8 && !rest[16] && !rest[17] && rest.every((x) => x % 2 === 0)) push('four22', f);
  }
  return out;
}

/** a 能否压过 b */
export function beats(a: Pattern, b: Pattern): boolean {
  if (b.kind === 'rocket') return false;
  if (a.kind === 'rocket') return true;
  if (a.kind === 'bomb') return b.kind !== 'bomb' || a.main > b.main;
  if (b.kind === 'bomb') return false;
  return a.kind === b.kind && a.len === b.len && a.size === b.size && a.main > b.main;
}

/**
 * 选这手牌的解释：有上家时取能压过上家的解释，领出时按优先顺序。
 * 不合法或压不过返回 null。
 */
export function interpret(ranks: readonly number[], prev: Pattern | null): Pattern | null {
  let ps = parse(ranks);
  if (prev) {
    const same = ps.filter((p) => beats(p, prev) && p.kind === prev.kind);
    ps = same.length ? same : ps.filter((p) => beats(p, prev));
  }
  if (ps.length === 0) return null;
  ps.sort((x, y) => PRIORITY.indexOf(x.kind) - PRIORITY.indexOf(y.kind) || y.main - x.main);
  return ps[0];
}
