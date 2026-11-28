/**
 * 掼蛋规则 bot：把手牌拆成尽量少的手数（炸弹整组留着），配牌按最能减少手数的方式去配；
 * 领出先走小牌、大牌型，记牌算出别人压不过的牌留着收尾；跟牌优先不拆牌、不为普通牌拆炸弹，
 * 对家的牌不压，下家出的牌（对家已经不要）更舍得接，对手快走完时舍得用炸弹。
 * 只看 view。牌桌上坐的是 searchbot.ts：残局在它上面再做一层搜索，规则 bot 给搜索当推演策略和"提示"按钮用。
 */
import type { Seat } from '@couju/sdk';
import { countNatural, isWild, rankOf, suitOf, SUITS, valueOf, valueOfRank, wildsOf } from './cards.ts';
import { beats, interpret, isBomb, parse, rankAt, strength, type Kind, type Pattern } from './patterns.ts';
import { outstanding } from './counter.ts';
import { chooseOpening } from './opening.ts';
import { partnerOf, returnable, tributeValue, type Action, type View } from './rules.ts';

/** 拆牌里的一手：ranks 是每张牌的自然点数（A = 14），用到配牌时也写它当的点数 */
export interface Combo extends Pattern {
  ranks: number[];
}

/** 一个具体的出法 */
export interface Move {
  cards: string[];
  as: { kind: Kind; main: number };
  p: Pattern;
}

const NODE_LIMIT = 1500;
const BOMB_BREAK = 2;
// 推演里同一手牌会以不同花色/顺序反复出现；拆牌只取决于点数。
// 有界缓存避免长时间开着牌桌时持续占内存。缓存结果只在内部读取，对外返回副本。
const PLAN_CACHE_LIMIT = 4096;
const planCache = new Map<string, Combo[]>();
const handPlanCache = new Map<string, Combo[]>();

function countKey(cnt: readonly number[], level: number, wilds = 0): string {
  return String.fromCharCode(level, wilds, ...cnt.slice(2, 18));
}

function remember(cache: Map<string, Combo[]>, key: string, combos: Combo[]): Combo[] {
  if (cache.size >= PLAN_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, combos);
  return combos;
}

function copyPlan(combos: readonly Combo[]): Combo[] {
  return combos.map((c) => ({ ...c, ranks: c.ranks.slice() }));
}

function rep(r: number, k: number): number[] {
  return new Array<number>(k).fill(r);
}

// ---------- 拆牌 ----------

/** 把点数计数（下标 2..17，配牌已经换成它要当的点数）拆成若干手 */
export function plan(cnt0: readonly number[], level: number): Combo[] {
  return copyPlan(cachedPlan(cnt0, level));
}

function cachedPlan(cnt0: readonly number[], level: number): Combo[] {
  const key = countKey(cnt0, level);
  const cached = planCache.get(key);
  if (cached) return cached;
  const v = (r: number) => valueOfRank(r, level);
  const cnt = cnt0.slice();
  const fixed: Combo[] = [];
  if (cnt[16] === 2 && cnt[17] === 2) {
    fixed.push({ kind: 'jokerBomb', main: 17, size: 4, ranks: [16, 16, 17, 17] });
    cnt[16] = cnt[17] = 0;
  }
  for (let r = 2; r <= 14; r++) {
    if (cnt[r] >= 4) {
      fixed.push({ kind: 'bomb', main: v(r), size: cnt[r], ranks: rep(r, cnt[r]) });
      cnt[r] = 0;
    }
  }

  const chains: Combo[] = [];
  const left = new Array<number>(18).fill(0);
  left[16] = cnt[16];
  left[17] = cnt[17];
  let best: { cost: number; chains: Combo[]; left: number[] } | null = null;
  let nodes = 0;

  const tryChains = (p: number, again: (p: number) => void) => {
    for (const [w, len, kind] of [[3, 2, 'plate'], [2, 3, 'tube'], [1, 5, 'straight']] as const) {
      if (p + len - 1 > 14) continue;
      let ok = true;
      for (let q = p; q < p + len; q++) if (cnt[rankAt(q)] < w) ok = false;
      if (!ok) continue;
      const ranks: number[] = [];
      for (let q = p; q < p + len; q++) {
        cnt[rankAt(q)] -= w;
        ranks.push(...rep(rankAt(q), w));
      }
      chains.push({ kind, main: p + len - 1, size: ranks.length, ranks });
      again(p);
      chains.pop();
      for (let q = p; q < p + len; q++) cnt[rankAt(q)] += w;
    }
  };

  const dfs = (p: number) => {
    nodes++;
    if (p === 1) {
      // A 当 1：只试从 A 开始的连牌，剩下的 A 在 14 那里处理
      if (nodes < NODE_LIMIT) tryChains(1, dfs);
      dfs(2);
      return;
    }
    while (p <= 14 && cnt[p] === 0) p++;
    if (p > 14) {
      const cost = leafCost(chains, left, level);
      if (!best || cost < best.cost) best = { cost, chains: chains.slice(), left: left.slice() };
      return;
    }
    if (nodes < NODE_LIMIT) tryChains(p, dfs);
    const save = cnt[p];
    left[p] += save;
    cnt[p] = 0;
    dfs(p + 1);
    cnt[p] = save;
    left[p] -= save;
  };
  dfs(1);
  const b = best!;
  return remember(planCache, key, [...groups(b.chains, b.left, level), ...fixed]);
}

function leafCost(chains: Combo[], left: number[], level: number): number {
  let singles = 0, pairs = 0, lowPairs = 0, triples = 0, lowSingles = 0;
  for (let r = 2; r <= 17; r++) {
    const v = valueOfRank(r, level);
    if (left[r] === 1) { singles++; if (v <= 10) lowSingles++; }
    else if (left[r] === 2) { pairs++; if (v < 15) lowPairs++; }
    else if (left[r] === 3) triples++;
  }
  return chains.length + singles + pairs + triples - Math.min(triples, lowPairs) + 0.1 * lowSingles;
}

function groups(chains: Combo[], left: number[], level: number): Combo[] {
  const v = (r: number) => valueOfRank(r, level);
  const byValue = (a: number, b: number) => v(a) - v(b);
  const singles: number[] = [], pairs: number[] = [], triples: number[] = [];
  for (let r = 2; r <= 17; r++) {
    if (left[r] === 1) singles.push(r);
    else if (left[r] === 2) pairs.push(r);
    else if (left[r] === 3) triples.push(r);
  }
  singles.sort(byValue);
  pairs.sort(byValue);
  triples.sort(byValue);
  const out: Combo[] = chains.slice();
  for (const t of triples) {
    const i = pairs.findIndex((p) => v(p) < 15);
    if (i >= 0) {
      const p = pairs.splice(i, 1)[0];
      out.push({ kind: 'fullHouse', main: v(t), size: 5, ranks: [t, t, t, p, p] });
    } else out.push({ kind: 'triple', main: v(t), size: 3, ranks: rep(t, 3) });
  }
  for (const p of pairs) out.push({ kind: 'pair', main: v(p), size: 2, ranks: [p, p] });
  for (const s of singles) out.push({ kind: 'single', main: v(s), size: 1, ranks: [s] });
  return out;
}

export function planCost(combos: readonly Combo[], level: number): number {
  let lowSingles = 0;
  for (const c of combos) if (c.kind === 'single' && c.main <= 10) lowSingles++;
  return combos.length + 0.1 * lowSingles;
}

/** 手牌（含配牌）的拆法：一起分配两张配牌，能发现必须同时补两处的连牌。 */
export function planHand(hand: readonly string[], level: number): Combo[] {
  const cnt = countNatural(hand, level);
  const wilds = wildsOf(hand, level).length;
  if (wilds === 0) return copyPlan(cachedPlan(cnt, level));
  const key = countKey(cnt, level, wilds);
  const cached = handPlanCache.get(key);
  if (cached) return copyPlan(cached);
  // 同分时仍优先保留级牌；两张配牌不分先后，最多只需试 91 种。
  const ranks = [level, ...ALL_RANKS.filter((r) => r <= 14 && r !== level)];
  let best: Combo[] = [];
  let bestCost = Infinity;
  const assign = (left: number, start: number) => {
    if (left === 0) {
      const combos = cachedPlan(cnt, level);
      const cost = planCost(combos, level);
      if (cost < bestCost - 1e-9) { bestCost = cost; best = combos; }
      return;
    }
    for (let i = start; i < ranks.length; i++) {
      cnt[ranks[i]]++;
      assign(left - 1, i);
      cnt[ranks[i]]--;
    }
  };
  assign(wilds, 0);
  return copyPlan(remember(handPlanCache, key, best));
}

/** 不算配牌时的手数（跟牌时比较各种出法用，便宜） */
export function naturalCost(hand: readonly string[], level: number): number {
  return naturalShape(hand, level).cost;
}

/** 不算配牌时的手数和其中炸弹的个数 */
export function naturalShape(hand: readonly string[], level: number): { cost: number; bombs: number } {
  const cnt = countNatural(hand, level);
  if (cnt.every((x) => x === 0)) return { cost: 0, bombs: 0 };
  const combos = cachedPlan(cnt, level);
  return { cost: planCost(combos, level), bombs: combos.filter(isBomb).length };
}

// ---------- 把点数换成具体的牌 ----------

/** 按 (点数, 张数) 的要求从手里取牌：先取真牌，不够的用配牌（王不能配） */
export function takeCards(hand: readonly string[], level: number, reqs: readonly [number, number][], suit?: string): string[] | null {
  const used = new Set<string>();
  const out: string[] = [];
  let need = 0;
  for (const [r, k] of reqs) {
    let got = 0;
    for (const id of hand) {
      if (got >= k) break;
      if (used.has(id) || isWild(id, level) || rankOf(id) !== r) continue;
      if (suit && suitOf(id) !== suit) continue;
      used.add(id);
      out.push(id);
      got++;
    }
    if (got < k && r >= 16) return null;
    need += k - got;
  }
  const wilds = wildsOf(hand, level);
  if (need > wilds.length) return null;
  return [...out, ...wilds.slice(0, need)];
}

function moveOf(cards: string[] | null, level: number, want: Pattern, prev: Pattern | null): Move | null {
  if (!cards) return null;
  const as = { kind: want.kind, main: want.main };
  const p = interpret(cards, level, prev, as);
  return p ? { cards, as, p } : null;
}

export function comboMove(hand: readonly string[], level: number, c: Combo, prev: Pattern | null = null): Move | null {
  const reqs = new Map<number, number>();
  for (const r of c.ranks) reqs.set(r, (reqs.get(r) ?? 0) + 1);
  return moveOf(takeCards(hand, level, [...reqs]), level, c, prev);
}

// ---------- 枚举能压过上家的出法 ----------

const ALL_RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17];

/** 手里所有能压过 prev 的出法（每种牌型每个大小取最省配牌的一种） */
export function beatsOf(hand: readonly string[], level: number, prev: Pattern): Move[] {
  const v = (r: number) => valueOfRank(r, level);
  const out: Move[] = [];
  const add = (reqs: [number, number][], want: Pattern, suit?: string) => {
    const m = moveOf(takeCards(hand, level, reqs, suit), level, want, prev);
    if (m) out.push(m);
  };
  const run = (s: number, len: number, w: number): [number, number][] =>
    Array.from({ length: len }, (_, i) => [rankAt(s + i), w] as [number, number]);

  switch (prev.kind) {
    case 'single': {
      for (const r of ALL_RANKS) if (v(r) > prev.main) add([[r, 1]], { kind: 'single', main: v(r), size: 1 });
      // 手里只有配牌能当级牌单张
      if (15 > prev.main && !out.some((m) => m.p.main === 15)) {
        const w = wildsOf(hand, level)[0];
        if (w) out.push({ cards: [w], as: { kind: 'single', main: 15 }, p: { kind: 'single', main: 15, size: 1 } });
      }
      break;
    }
    case 'pair':
      for (const r of ALL_RANKS) if (v(r) > prev.main) add([[r, 2]], { kind: 'pair', main: v(r), size: 2 });
      break;
    case 'triple':
      for (let r = 2; r <= 14; r++) if (v(r) > prev.main) add([[r, 3]], { kind: 'triple', main: v(r), size: 3 });
      break;
    case 'fullHouse': {
      const cnt = countNatural(hand, level);
      let beforeBombs: number | undefined;
      for (let t = 2; t <= 14; t++) {
        if (v(t) <= prev.main) continue;
        const opts = ALL_RANKS.filter((p) => p !== t)
          .map((p) => ({ rank: p, cards: takeCards(hand, level, [[t, 3], [p, 2]]) }))
          .filter((x): x is { rank: number; cards: string[] } => x.cards !== null)
          // 带牌不拆炸弹；用配牌一样多时，先带低对，保留级牌和王对作控制。
          .sort((a, b) => Number(cnt[a.rank] >= 4) - Number(cnt[b.rank] >= 4)
            || wildsOf(a.cards, level).length - wildsOf(b.cards, level).length || v(a.rank) - v(b.rank));
        if (opts.length === 0) continue;
        // 两张配牌可声明成不同点数的带对，但实际是同一手牌，只评一次。
        const seen = new Set<string>();
        const moves = opts.filter(({ cards }) => {
          const key = cards.join();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(({ cards }) => moveOf(cards, level, { kind: 'fullHouse', main: v(t), size: 5 }, prev))
          .filter((m): m is Move => m !== null);
        if (moves.length === 0) continue;
        let best = moves[0];
        if (moves.length > 1) {
          beforeBombs ??= naturalShape(hand, level).bombs;
          let bestCost = remainingCost(hand, level, best, beforeBombs);
          for (let i = 1; i < moves.length; i++) {
            const cost = remainingCost(hand, level, moves[i], beforeBombs);
            if (cost < bestCost) { best = moves[i]; bestCost = cost; }
          }
        }
        // 不只看带对大小：带掉小对若会拆散连对/顺子，宁可带另一对。
        out.push(best);
      }
      break;
    }
    case 'straight':
      for (let s = 1; s <= 10; s++) if (s + 4 > prev.main) add(run(s, 5, 1), { kind: 'straight', main: s + 4, size: 5 });
      break;
    case 'tube':
      for (let s = 1; s <= 12; s++) if (s + 2 > prev.main) add(run(s, 3, 2), { kind: 'tube', main: s + 2, size: 6 });
      break;
    case 'plate':
      for (let s = 1; s <= 13; s++) if (s + 1 > prev.main) add(run(s, 2, 3), { kind: 'plate', main: s + 1, size: 6 });
      break;
    default:
      break;
  }
  out.push(...bombsOf(hand, level, prev));
  return out;
}

/**
 * 手里能组成的、压得过 prev 的炸弹（prev 为 null 时不限）：
 * 每个点数取压得过的最小张数（不拆开同点数的真牌，不够再加配牌）和加满配牌的最大张数、同花顺、天王炸。
 */
export function bombsOf(hand: readonly string[], level: number, prev: Pattern | null = null): Move[] {
  const cnt = countNatural(hand, level);
  const w = wildsOf(hand, level).length;
  const out: Move[] = [];
  for (let r = 2; r <= 14; r++) {
    if (cnt[r] === 0) continue;
    const bomb = (size: number) =>
      moveOf(takeCards(hand, level, [[r, size]]), level, { kind: 'bomb', main: valueOfRank(r, level), size }, prev);
    let smallest = 0;
    for (let size = Math.max(4, cnt[r]); size <= cnt[r] + w && !smallest; size++) {
      const m = bomb(size);
      if (m) {
        out.push(m);
        smallest = size;
      }
    }
    // 把配牌全加上的最大那个也列出来：可能正好一手走完
    if (smallest && smallest < cnt[r] + w) out.push(bomb(cnt[r] + w)!);
  }
  for (const suit of SUITS) {
    const has = new Array<boolean>(15).fill(false);
    for (const id of hand) if (suitOf(id) === suit && !isWild(id, level)) has[rankOf(id)] = true;
    for (let s = 1; s <= 10; s++) {
      let missing = 0;
      for (let q = s; q < s + 5; q++) if (!has[rankAt(q)]) missing++;
      if (missing > w) continue;
      const reqs = Array.from({ length: 5 }, (_, i) => [rankAt(s + i), 1] as [number, number]);
      const m = moveOf(takeCards(hand, level, reqs, suit), level, { kind: 'straightFlush', main: s + 4, size: 5 }, prev);
      if (m) out.push(m);
    }
  }
  if (cnt[16] === 2 && cnt[17] === 2) {
    const m = moveOf(hand.filter((id) => rankOf(id) >= 16), level, { kind: 'jokerBomb', main: 17, size: 4 }, prev);
    if (m) out.push(m);
  }
  return out;
}

// ---------- 决策 ----------

function minus(hand: readonly string[], cards: readonly string[]): string[] {
  const s = new Set(cards);
  return hand.filter((c) => !s.has(c));
}

/** 跟出后的结构代价：带牌选择和跟牌决策共用同一标准。 */
export function remainingCost(hand: readonly string[], level: number, move: Move, beforeBombs: number): number {
  const after = naturalShape(minus(hand, move.cards), level);
  // 跟普通牌时拆炸弹，比单纯多留一手牌更伤。
  const broken = isBomb(move.p) ? 0 : Math.max(0, beforeBombs - after.bombs);
  return after.cost + 0.8 * wildsOf(move.cards, level).length + BOMB_BREAK * broken;
}

function isControl(p: Pattern): boolean {
  return isBomb(p) || ((p.kind === 'single' || p.kind === 'pair') && p.main >= 15);
}

/** 记牌：别人手里还剩的牌（按自然点数，下标 2..17，配牌单独数） */
interface Unseen {
  nat: number[];
  wilds: number;
}

function unseenOf(v: View): Unseen {
  const out = outstanding(v);
  const wildId = (id: string) => isWild(id, v.level);
  let seenWilds = v.hand.filter(wildId).length;
  for (const h of v.history) seenWilds += (h.cards ?? []).filter(wildId).length;
  const wilds = 2 - seenWilds;
  out[v.level] -= wilds;
  return { nat: out, wilds };
}

/**
 * 按记牌，别人还能不能用同牌型的普通牌压过 c（炸弹不算）。
 * 把别人的牌当成一手看，偏保守：说"压不过"时是真的压不过。
 */
function isTop(c: Pattern, u: Unseen, level: number): boolean {
  if (isBomb(c)) return true;
  const v = (r: number) => valueOfRank(r, level);
  const group = (r: number, k: number) => (r >= 16 ? u.nat[r] >= k : u.nat[r] + u.wilds >= k && (u.nat[r] > 0 || r === level));
  const run = (s: number, len: number, w: number) => {
    let need = 0;
    for (let q = s; q < s + len; q++) need += Math.max(0, w - u.nat[rankAt(q)]);
    return need <= u.wilds;
  };
  switch (c.kind) {
    case 'single':
      return !ALL_RANKS.some((r) => v(r) > c.main && u.nat[r] + (r === level ? u.wilds : 0) > 0);
    case 'pair':
      return !ALL_RANKS.some((r) => v(r) > c.main && group(r, 2));
    case 'triple':
    case 'fullHouse':
      return !ALL_RANKS.some((r) => r <= 14 && v(r) > c.main && group(r, 3));
    case 'straight':
      for (let s = c.main - 3; s <= 10; s++) if (run(s, 5, 1)) return false;
      return true;
    case 'tube':
      for (let s = c.main - 1; s <= 12; s++) if (run(s, 3, 2)) return false;
      return true;
    case 'plate':
      for (let s = c.main; s <= 13; s++) if (run(s, 2, 3)) return false;
      return true;
    default:
      return false;
  }
}

interface Ctx {
  me: Seat;
  hand: string[];
  level: number;
  partner: Seat;
  partnerCount: number;
  /** 还有牌的对手里最少的张数 */
  oppMin: number;
}

function ctxOf(v: View): Ctx {
  const me = v.me!;
  const partner = partnerOf(me);
  const opps = [(me + 1) % 4, (me + 3) % 4].filter((i) => v.counts[i] > 0);
  return {
    me, hand: v.hand, level: v.level, partner, partnerCount: v.counts[partner],
    oppMin: opps.length ? Math.min(...opps.map((i) => v.counts[i])) : 99,
  };
}

/** 领出时的候选顺序（最想先出的在前） */
export function leadOrder(v: View): Move[] {
  const x = ctxOf(v);
  const u = unseenOf(v);
  const combos = planHand(x.hand, x.level);
  const tops = combos.filter((c) => isTop(c, u, x.level));
  // 除了一手，其余都是别人压不过的：先走压不过的，最后一手留到收回牌权后再出
  const closing = combos.length >= 2 && combos.length - tops.length <= 1 && tops.some((c) => !isBomb(c));
  const score = (c: Combo) => {
    let s = c.main - 0.8 * c.size;
    if (isControl(c)) s += 30;
    if (isBomb(c)) s += 40;
    if (closing && !isBomb(c)) s += tops.includes(c) ? -200 : 0;
    if (x.oppMin === 1 && c.kind === 'single') return 50 - c.main;
    if (x.oppMin === 2 && c.kind === 'pair') s += 30;
    return s;
  };
  const moves: Move[] = [];
  for (const c of combos.slice().sort((a, b) => score(a) - score(b))) {
    const m = comboMove(x.hand, x.level, c);
    if (m) moves.push(m);
  }
  return moves;
}

function act(m: Move): Action {
  return { type: 'play', cards: m.cards, as: m.as };
}

function lead(v: View): Action {
  const x = ctxOf(v);
  const whole = interpret(x.hand, x.level, null);
  if (whole) return { type: 'play', cards: x.hand.slice(), as: { kind: whole.kind, main: whole.main } };
  const order = leadOrder(v);
  // 对家只剩一张、对手还多：送一张最小的单张
  if (x.partnerCount === 1 && x.oppMin > 1) {
    const low = x.hand.filter((c) => !isWild(c, x.level)).sort((a, b) => valueOf(a, x.level) - valueOf(b, x.level))[0];
    if (low) return { type: 'play', cards: [low], as: { kind: 'single', main: valueOf(low, x.level) } };
  }
  // 只剩两手：先出大的那手，收回来再走最后一手
  if (order.length === 2) {
    const strong = order.find((m) => isControl(m.p));
    if (strong) return act(strong);
  }
  if (order.length >= 3 && x.partnerCount > 2 && v.counts.reduce((n, count) => n + count, 0) > 50) {
    return act(chooseOpening(v, order, planHand));
  }
  if (order.length) return act(order[0]);
  const low = x.hand.slice().sort((a, b) => valueOf(a, x.level) - valueOf(b, x.level))[0];
  return { type: 'play', cards: [low], as: { kind: 'single', main: valueOf(low, x.level) } };
}

function follow(v: View): Action {
  const x = ctxOf(v);
  const prev = v.lastPlay!;
  const cands = beatsOf(x.hand, x.level, prev);
  const fin = cands.find((m) => m.cards.length === x.hand.length);
  if (fin) return act(fin);
  if (cands.length === 0) return { type: 'pass' };
  // 对家的牌不压
  if (prev.seat === x.partner) return { type: 'pass' };
  const nextOpp = (x.me + 1) % 4;

  const shape = naturalShape(x.hand, x.level);
  const before = shape.cost;
  const scored = cands.map((m) => ({ m, after: remainingCost(x.hand, x.level, m, shape.bombs) }));
  const normal = scored
    .filter((s) => !isBomb(s.m.p))
    .sort((a, b) => {
      // 对手报单时先封住单张，不能为了保留一对大牌而放小单张让他跑。
      if (prev.kind === 'single' && x.oppMin === 1) return b.m.p.main - a.m.p.main || a.after - b.after;
      return a.after - b.after || strength(a.m.p) - strength(b.m.p);
    });

  const prevSeatCount = v.counts[prev.seat];
  const danger = x.oppMin <= 4 || prevSeatCount <= 6;
  // 上家出的牌对家还能接；下家出的牌，对家已经不要了，我不管就回到他手里
  const lastLine = prev.seat === nextOpp || x.partnerCount === 0;

  const bombs = scored.filter((s) => isBomb(s.m.p)).sort((a, b) => strength(a.m.p) - strength(b.m.p));
  const best = normal[0];
  if (best) {
    // 我是最后一道关：不减少手数也接
    const breaks = best.after - (before - 1) - (lastLine ? 0.5 : 0);
    const wasteful = isControl(best.m.p) && prev.main < 11 && x.hand.length > 10 && !danger;
    const ok = danger || breaks <= 0.5 || (breaks <= 1.5 && x.hand.length <= 12);
    if (ok && !wasteful) return act(best.m);
  }
  if (bombs.length) {
    const b = bombs[0];
    if (danger || b.after <= 2 || (prev.size >= 5 && !isBomb(prev) && x.hand.length <= 14)) return act(b.m);
  }
  return { type: 'pass' };
}

function tribute(v: View): Action {
  const target = tributeValue(v.hand, v.level);
  const options = v.hand.filter((c) => !isWild(c, v.level) && valueOf(c, v.level) === target);
  return { type: 'tribute', card: chooseGift(v, options) };
}

/** 同点数也要看花色：送出其中一张可能刚好拆掉同花顺。进还贡每副只算一次。 */
function chooseGift(v: View, options: string[]): string {
  if (options.length === 1) return options[0];
  const hasFlush = bombsOf(v.hand, v.level).some((m) => m.p.kind === 'straightFlush');
  let best = options[0];
  let bestCost = Infinity;
  for (const c of options) {
    const left = minus(v.hand, [c]);
    const shape = naturalShape(left, v.level);
    const losesFlush = hasFlush && !bombsOf(left, v.level).some((m) => m.p.kind === 'straightFlush');
    const value = valueOf(c, v.level);
    const cost = shape.cost - BOMB_BREAK * shape.bombs + Number(losesFlush) * BOMB_BREAK
      + Number(isWild(c, v.level)) * 4 + Number(value >= 15) + value * 0.01;
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  return best;
}

function giveBack(v: View): Action {
  return { type: 'return', card: chooseGift(v, returnable(v.hand)) };
}

export function decide(v: View): Action {
  switch (v.phase) {
    case 'handOver':
      return { type: 'ready' };
    case 'tribute':
      return tribute(v);
    case 'return':
      return giveBack(v);
    default:
      return v.lastPlay ? follow(v) : lead(v);
  }
}

/** 给"提示"按钮用：能出的组合，最推荐的在前 */
export function hints(v: View): Move[] {
  if (v.me === null || v.phase !== 'playing' || v.turn !== v.me) return [];
  const x = ctxOf(v);
  let list: Move[];
  if (v.lastPlay) {
    list = beatsOf(x.hand, x.level, v.lastPlay)
      .map((m) => ({ m, k: Number(isBomb(m.p)) * 100 + naturalCost(minus(x.hand, m.cards), x.level) + wildsOf(m.cards, x.level).length }))
      .sort((a, b) => a.k - b.k || strength(a.m.p) - strength(b.m.p))
      .map((s) => s.m);
  } else list = leadOrder(v);
  const first = decide(v);
  if (first.type === 'play') {
    const key = first.cards.slice().sort().join();
    const p = interpret(first.cards, x.level, v.lastPlay, first.as)!;
    return [{ cards: first.cards, as: first.as ?? { kind: p.kind, main: p.main }, p }, ...list.filter((m) => m.cards.slice().sort().join() !== key)];
  }
  return list;
}

export { parse };
