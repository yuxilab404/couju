/**
 * 规则 bot：把手牌拆成尽量少的手数，领出先走小牌、留控制牌，
 * 跟牌优先不拆牌，队友的牌不压，对手快走完时不惜代价（含炸弹）。
 * 只看 view。
 */
import type { Bot, Seat } from '@couju/sdk';
import { countCards, pickCards, rankOf } from './cards.ts';
import { interpret, isBomb, type Kind, type Pattern } from './patterns.ts';
import type { Action, View } from './rules.ts';

export interface Combo extends Pattern {
  ranks: number[];
}

const LOW = 15; // < 15 才当带牌；2 和王留作控制牌

function combo(kind: Kind, ranks: number[], main: number, len = 1): Combo {
  return { kind, ranks, main, len, size: ranks.length };
}

function rep(r: number, k: number): number[] {
  return new Array<number>(k).fill(r);
}

function run(top: number, len: number, w: number): number[] {
  const out: number[] = [];
  for (let r = top - len + 1; r <= top; r++) out.push(...rep(r, w));
  return out;
}

// ---------- 拆牌 ----------

const NODE_LIMIT = 3000;

/** 把手牌拆成若干手，返回尽量少的拆法 */
export function plan(cnt0: readonly number[]): Combo[] {
  const cnt = cnt0.slice();
  const fixed: Combo[] = [];
  if (cnt[16] && cnt[17]) {
    fixed.push(combo('rocket', [16, 17], 17));
    cnt[16] = cnt[17] = 0;
  }
  for (let r = 3; r <= 15; r++) {
    if (cnt[r] === 4) {
      fixed.push(combo('bomb', rep(r, 4), r));
      cnt[r] = 0;
    }
  }

  const chains: Combo[] = [];
  const left = new Array<number>(18).fill(0);
  for (let r = 15; r <= 17; r++) left[r] = cnt[r];
  let best: { cost: number; chains: Combo[]; left: number[] } | null = null;
  let nodes = 0;

  const dfs = (r: number) => {
    nodes++;
    while (r <= 14 && cnt[r] === 0) r++;
    if (r > 14) {
      const cost = leafCost(chains, left);
      if (!best || cost < best.cost) best = { cost, chains: chains.slice(), left: left.slice() };
      return;
    }
    if (nodes < NODE_LIMIT) {
      for (const [w, minLen, kind] of [[3, 2, 'plane'], [2, 3, 'pairs'], [1, 5, 'straight']] as const) {
        if (cnt[r] < w) continue;
        let L = 0;
        while (r + L <= 14 && cnt[r + L] >= w) L++;
        for (let len = L; len >= minLen; len--) {
          for (let i = r; i < r + len; i++) cnt[i] -= w;
          chains.push(combo(kind, run(r + len - 1, len, w), r + len - 1, len));
          dfs(r);
          chains.pop();
          for (let i = r; i < r + len; i++) cnt[i] += w;
        }
      }
    }
    const save = cnt[r];
    left[r] += save;
    cnt[r] = 0;
    dfs(r + 1);
    cnt[r] = save;
    left[r] -= save;
  };
  dfs(3);
  const b = best!;
  return [...attachKickers(b.chains, b.left), ...fixed];
}

function leafCost(chains: Combo[], left: number[]): number {
  let singles = 0, pairs = 0, triples = 0, lowSingles = 0, smallSingles = 0;
  for (let r = 3; r <= 17; r++) {
    if (left[r] === 1) { singles++; if (r < LOW) lowSingles++; if (r <= 10) smallSingles++; }
    else if (left[r] === 2) pairs++;
    else if (left[r] === 3) triples++;
  }
  const slots = triples + chains.reduce((n, c) => n + (c.kind === 'plane' ? c.len : 0), 0);
  const absorbed = Math.min(slots, lowSingles + pairs);
  return chains.length + singles + pairs + triples - absorbed + 0.1 * Math.max(0, smallSingles - absorbed);
}

function attachKickers(chains: Combo[], left: number[]): Combo[] {
  const singles: number[] = [];
  const pairs: number[] = [];
  const triples: number[] = [];
  for (let r = 3; r <= 17; r++) {
    if (left[r] === 1) singles.push(r);
    else if (left[r] === 2) pairs.push(r);
    else if (left[r] === 3) triples.push(r);
  }
  const lowS = () => singles.filter((r) => r < LOW);
  const lowP = () => pairs.filter((r) => r < LOW);
  const take = (arr: number[], vals: number[]) => vals.forEach((v) => arr.splice(arr.indexOf(v), 1));
  const out: Combo[] = [];
  const planes = chains.filter((c) => c.kind === 'plane').sort((a, b) => b.len - a.len);
  for (const p of planes) {
    const s = lowS(), q = lowP();
    if (s.length >= p.len) {
      const k = s.slice(0, p.len); take(singles, k);
      out.push(combo('plane1', [...p.ranks, ...k], p.main, p.len));
    } else if (q.length >= p.len) {
      const k = q.slice(0, p.len); take(pairs, k);
      out.push(combo('plane2', [...p.ranks, ...k.flatMap((r) => [r, r])], p.main, p.len));
    } else out.push(p);
  }
  out.push(...chains.filter((c) => c.kind !== 'plane'));
  for (const t of triples) {
    const s = lowS(), q = lowP();
    if (s.length) { take(singles, [s[0]]); out.push(combo('triple1', [t, t, t, s[0]], t)); }
    else if (q.length) { take(pairs, [q[0]]); out.push(combo('triple2', [t, t, t, q[0], q[0]], t)); }
    else out.push(combo('triple', rep(t, 3), t));
  }
  for (const p of pairs) out.push(combo('pair', [p, p], p));
  for (const s of singles) out.push(combo('single', [s], s));
  return out;
}

export function handCost(cnt: readonly number[]): number {
  if (cnt.every((x) => x === 0)) return 0;
  return plan(cnt).length;
}

// ---------- 枚举能压过上家的出法 ----------

function kickers(cnt: number[], n: number, w: 1 | 2, exclude: Set<number>): number[] | null {
  const out: number[] = [];
  const c = cnt.slice();
  for (const r of exclude) c[r] = 0;
  const maxRank = w === 2 ? 15 : 17;
  // 先取正好 w 张的点数（不拆牌），再拆多的，再拆炸弹，最后允许同一点数取多次
  const passes = [(x: number) => x === w, (x: number) => x > w && x < 4, (x: number) => x === 4, (x: number) => x >= w];
  for (const [i, ok] of passes.entries()) {
    for (let r = 3; r <= maxRank && out.length < n; r++) {
      while (out.length < n && c[r] >= w && ok(c[r])) {
        if (w === 1 && r >= 16 && out.some((x) => x >= 16)) break; // 不能同时带大小王
        out.push(r);
        c[r] -= w;
        if (i < passes.length - 1) break;
      }
    }
  }
  if (out.length < n) return null;
  return w === 2 ? out.flatMap((r) => [r, r]) : out;
}

/** 手里所有能压过 prev 的出法（点数多重集），带牌只取最省的一种 */
export function beatsOf(cnt: readonly number[], prev: Pattern): Combo[] {
  const c = cnt.slice();
  const out: Combo[] = [];
  const { kind, main, len } = prev;
  const w = kind === 'straight' ? 1 : kind === 'pairs' ? 2 : 3;
  switch (kind) {
    case 'single':
      for (let r = main + 1; r <= 17; r++) if (c[r] >= 1) out.push(combo('single', [r], r));
      break;
    case 'pair':
      for (let r = main + 1; r <= 15; r++) if (c[r] >= 2) out.push(combo('pair', [r, r], r));
      break;
    case 'triple':
    case 'triple1':
    case 'triple2':
      for (let r = main + 1; r <= 15; r++) {
        if (c[r] < 3) continue;
        if (kind === 'triple') out.push(combo('triple', rep(r, 3), r));
        else {
          const k = kickers(c, 1, kind === 'triple1' ? 1 : 2, new Set([r]));
          if (k) out.push(combo(kind, [...rep(r, 3), ...k], r));
        }
      }
      break;
    case 'straight':
    case 'pairs':
    case 'plane':
      for (let top = main + 1; top <= 14; top++) {
        if (top - len + 1 < 3) continue;
        let ok = true;
        for (let r = top - len + 1; r <= top; r++) if (c[r] < w) ok = false;
        if (ok) out.push(combo(kind, run(top, len, w), top, len));
      }
      break;
    case 'plane1':
    case 'plane2':
      for (let top = main + 1; top <= 14; top++) {
        if (top - len + 1 < 3) continue;
        let ok = true;
        const ex = new Set<number>();
        for (let r = top - len + 1; r <= top; r++) { if (c[r] < 3) ok = false; ex.add(r); }
        if (!ok) continue;
        const k = kickers(c, len, kind === 'plane1' ? 1 : 2, ex);
        if (k) out.push(combo(kind, [...run(top, len, 3), ...k], top, len));
      }
      break;
    case 'four2':
    case 'four22':
      for (let r = main + 1; r <= 15; r++) {
        if (c[r] !== 4) continue;
        const k = kickers(c, 2, kind === 'four2' ? 1 : 2, new Set([r]));
        if (k) out.push(combo(kind, [...rep(r, 4), ...k], r));
      }
      break;
    case 'bomb':
      for (let r = main + 1; r <= 15; r++) if (c[r] === 4) out.push(combo('bomb', rep(r, 4), r));
      break;
    case 'rocket':
      return [];
  }
  if (kind !== 'bomb') for (let r = 3; r <= 15; r++) if (c[r] === 4) out.push(combo('bomb', rep(r, 4), r));
  if (c[16] && c[17]) out.push(combo('rocket', [16, 17], 17));
  // 防御：只保留真正合法且能压的
  return out.filter((x) => {
    const p = interpret(x.ranks, prev);
    return p !== null;
  });
}

// ---------- 决策 ----------

function minus(cnt: readonly number[], ranks: readonly number[]): number[] {
  const c = cnt.slice();
  for (const r of ranks) c[r]--;
  return c;
}

interface Ctx {
  me: Seat;
  hand: string[];
  cnt: number[];
  landlord: Seat;
  isLandlord: boolean;
  teammate: Seat | null;
  /** 对手里最少的剩余张数 */
  oppMin: number;
  /** 下家是不是对手 */
  nextIsOpp: boolean;
}

function ctxOf(v: View): Ctx {
  const me = v.me!;
  const landlord = v.landlord!;
  const isLandlord = me === landlord;
  const teammate = isLandlord ? null : ([0, 1, 2].find((i) => i !== me && i !== landlord) as Seat);
  const opps = [0, 1, 2].filter((i) => i !== me && i !== teammate);
  const next = (me + 1) % 3;
  return {
    me, hand: v.hand, cnt: countCards(v.hand), landlord, isLandlord, teammate,
    oppMin: Math.min(...opps.map((i) => v.counts[i])),
    nextIsOpp: next !== teammate,
  };
}

function toAction(hand: string[], c: Combo): Action {
  return { type: 'play', cards: pickCards(hand, c.ranks)! };
}

function isControl(c: Combo): boolean {
  return isBomb(c) || ((c.kind === 'single' || c.kind === 'pair') && c.main >= 15);
}

/** 领出时的候选顺序（最想先出的在前） */
export function leadOrder(v: View): Combo[] {
  const x = ctxOf(v);
  const p = plan(x.cnt);
  const score = (c: Combo) => {
    let s = c.main - 0.8 * c.size;
    if (isControl(c)) s += 30;
    if (isBomb(c)) s += 30;
    // 对手只剩一张：不出单；剩两张：尽量不出对
    if (x.oppMin === 1 && c.kind === 'single') s += 50 - c.main;
    if (x.oppMin === 2 && c.kind === 'pair') s += 40;
    return s;
  };
  return p.slice().sort((a, b) => score(a) - score(b));
}

function lead(v: View): Action {
  const x = ctxOf(v);
  const whole = interpret(x.hand.map(rankOf), null);
  if (whole) return { type: 'play', cards: x.hand.slice() };
  const p = plan(x.cnt);
  // 队友只剩一张：送一张最小的单牌
  if (x.teammate !== null && v.counts[x.teammate] === 1 && x.oppMin > 1) {
    const r = x.hand.map(rankOf).sort((a, b) => a - b)[0];
    return { type: 'play', cards: pickCards(x.hand, [r])! };
  }
  // 只剩两手：先出控制牌，回来再走最后一手
  if (p.length === 2) {
    const strong = p.find(isControl);
    if (strong) return toAction(x.hand, strong);
  }
  return toAction(x.hand, leadOrder(v)[0]);
}

function follow(v: View): Action {
  const x = ctxOf(v);
  const prev = v.lastPlay!;
  const whole = interpret(x.hand.map(rankOf), prev);
  if (whole) return { type: 'play', cards: x.hand.slice() };

  const cands = beatsOf(x.cnt, prev);
  if (cands.length === 0) return { type: 'pass' };
  const before = handCost(x.cnt);
  const scored = cands.map((c) => ({ c, after: handCost(minus(x.cnt, c.ranks)) }));
  const fromTeammate = prev.seat === x.teammate;
  const danger = x.oppMin <= 2;

  if (fromTeammate) {
    // 队友的牌原则上不压；除非压了自己马上能走完
    const fin = scored.find((s) => !isBomb(s.c) && s.after <= 1);
    return fin ? toAction(x.hand, fin.c) : { type: 'pass' };
  }

  const normal = scored.filter((s) => !isBomb(s.c)).sort((a, b) => a.after - b.after || a.c.main - b.c.main);
  const bombs = scored.filter((s) => isBomb(s.c)).sort((a, b) => a.c.main - b.c.main);
  const best = normal[0];
  if (best) {
    const breaks = best.after - (before - 1); // 0 = 不拆牌
    const wasteful = isControl(best.c) && prev.main < 11 && x.hand.length > 8 && !danger;
    const ok = danger || breaks <= 0 || (breaks <= 1 && (x.hand.length <= 8 || !x.isLandlord));
    if (ok && !wasteful) return toAction(x.hand, best.c);
  }
  if (bombs.length) {
    const b = bombs[0];
    // 对手快走完、炸完能很快走完、或对手出了一大手
    if (danger || b.after <= 2 || prev.size >= 8) return toAction(x.hand, b.c);
  }
  if (best && danger) return toAction(x.hand, best.c);
  return { type: 'pass' };
}

function bid(v: View): Action {
  const cnt = countCards(v.hand);
  let score = 0;
  if (cnt[17]) score += 4;
  if (cnt[16]) score += 3;
  score += cnt[15] * 2;
  score += cnt[14] * 0.5;
  for (let r = 3; r <= 14; r++) if (cnt[r] === 4) score += 4;
  score += (9 - plan(cnt).length) * 0.6;
  const want = score >= 11 ? 3 : score >= 8.5 ? 2 : score >= 6.5 ? 1 : 0;
  return { type: 'bid', score: (want > v.maxBid ? want : 0) as 0 | 1 | 2 | 3 };
}

export function decide(v: View): Action {
  if (v.phase === 'bidding') return bid(v);
  return v.lastPlay ? follow(v) : lead(v);
}

/** "提示"按钮的内容：bot 建不建议不要，以及能出的牌（最推荐的在前） */
export interface Hint {
  /** bot 自己会选"不要"（比如牌是队友出的，或者压了要拆好牌） */
  pass: boolean;
  /** 队友出的牌 */
  fromTeammate: boolean;
  moves: string[][];
}

function bombCount(cnt: readonly number[]): number {
  return plan(cnt).filter(isBomb).length;
}

/**
 * 给"提示"按钮用。第一条是 bot 自己会出的；其余按人的习惯排：
 * 不拆牌的在前、拆牌的在后，拆炸弹的再往后，同一档里从小到大；2 和王算控制牌往后放；炸弹、王炸最后。
 */
export function hints(v: View): Hint {
  const none: Hint = { pass: false, fromTeammate: false, moves: [] };
  if (v.me === null || v.phase !== 'playing' || v.turn !== v.me) return none;
  const x = ctxOf(v);
  const first = decide(v);
  const fromTeammate = !!v.lastPlay && v.lastPlay.seat === x.teammate;
  let combos: Combo[];
  if (v.lastPlay) {
    const before = handCost(x.cnt);
    const bombs = bombCount(x.cnt);
    const rank = (c: Combo) => {
      if (isBomb(c)) return 1000 + c.main;
      const after = minus(x.cnt, c.ranks);
      const breaks = Math.max(0, handCost(after) - (before - 1));
      const brokenBombs = Math.max(0, bombs - bombCount(after));
      const tier = breaks + 3 * brokenBombs + (isControl(c) ? 1 : 0);
      return tier * 100 + c.main;
    };
    combos = beatsOf(x.cnt, v.lastPlay)
      .map((c) => ({ c, k: rank(c) }))
      .sort((a, b) => a.k - b.k)
      .map((s) => s.c);
  } else combos = leadOrder(v);
  const list = combos.map((c) => pickCards(x.hand, c.ranks)!);
  if (first.type !== 'play') return { pass: true, fromTeammate, moves: list };
  const key = first.cards.slice().sort().join();
  return { pass: false, fromTeammate, moves: [first.cards, ...list.filter((l) => l.slice().sort().join() !== key)] };
}

export const bot: Bot<View, Action> = {
  decide: (v) => decide(v),
};
