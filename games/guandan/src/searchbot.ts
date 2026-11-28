/**
 * 残局搜索：把看不见的牌随机分给另外三家（张数对得上、进贡换过手的牌放到收贡的人手里），
 * 每个候选出法都在同一批假想牌局里用规则 bot 打完这一副，取平均结果最好的出法。
 * 只看 view；随机数从局面算出来，同一局面总是同一个决定。
 */
import { SeededRng, type Bot, type Seat } from '@couju/sdk';
import { makeDeck } from './cards.ts';
import { beatsOf, bombsOf, decide as ruleDecide, leadOrder, type Move } from './bot.ts';
import { isBomb, strength } from './patterns.ts';
import { apply, teamOf, type Action, type State, type View } from './rules.ts';

/**
 * 参数是用 scripts/arena.sh 对打调出来的（2026-11）：
 * 牌多时规则 bot 推演得不准，搜了反而更差，所以全场剩 CARD_LIMIT 张以内才搜。
 */
/** 最多比较几个候选出法 */
const MAX_CANDS = 6;
/** 全场剩几张牌以内才搜 */
const CARD_LIMIT = 50;
/** 每个候选先打几次 */
const FIRST = 12;
/** 粗筛后留几个候选 */
const KEEP = 3;
/** 一步一共大约推演几次 */
const BUDGET = 128;
/** 平均每副要比规则 bot 的选择好出这么多级才换 */
const MARGIN = 0.2;

function hashOf(v: View): number {
  let h = 2166136261;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  mix(v.hand.join());
  mix(String(v.history.length));
  mix(String(v.me));
  return h >>> 0;
}

/** 别人手里的牌：随机分一种和张数对得上的 */
export function deal(v: View, rng: SeededRng): string[][] {
  const me = v.me!;
  const gone = new Set<string>([...v.hand]);
  for (const h of v.history) for (const id of h.cards ?? []) gone.add(id);
  const hands: string[][] = [[], [], [], []];
  hands[me] = v.hand.slice();
  // 进贡、还贡是公开的：收到的那张还没出过就一定在收的人手里。
  // 同一张牌可能进贡后又被原样还回来，以最后一次转手为准
  const t = v.tribute;
  if (t) {
    const holder = new Map<string, Seat>();
    for (const x of [...t.pairs, ...t.returns]) holder.set(x.card, x.to);
    for (const [card, to] of holder) {
      if (to === me || gone.has(card) || v.counts[to] <= hands[to].length) continue;
      hands[to].push(card);
      gone.add(card);
    }
  }
  const pool = rng.shuffle(makeDeck().filter((id) => !gone.has(id)));
  let k = 0;
  for (let i = 0; i < 4; i++) {
    if (i === me) continue;
    while (hands[i].length < v.counts[i]) hands[i].push(pool[k++]);
  }
  return hands;
}

function stateOf(v: View, hands: string[][]): State {
  let passes = 0;
  if (v.lastPlay) for (let i = v.history.length - 1; i >= 0 && v.history[i].cards === null; i--) passes++;
  return {
    opts: { ...v.opts, length: 'one' }, phase: 'playing', hand: v.handNo, level: v.level, levelTeam: v.levelTeam,
    teamLevels: v.teamLevels, aFails: v.aFails, hands, turn: v.turn, lastPlay: v.lastPlay, passes,
    recent: v.recent.slice(), history: v.history.slice(), finished: v.finished.slice(), tribute: v.tribute,
    lastHand: v.lastHand, ready: v.ready.slice(), winnerTeam: null,
  };
}

/** 用规则 bot 把这一副打完，返回我方净升级数 */
function rollout(s: State, team: number, rng: SeededRng): number {
  let guard = 0;
  while (s.phase === 'playing' && guard++ < 400) {
    const seat = s.turn;
    s = apply(s, seat, ruleDecide(viewFor(s, seat)), { rng });
  }
  const h = s.lastHand;
  if (s.phase === 'playing' || !h) return 0;
  return h.winTeam === team ? h.up : -h.up;
}

function viewFor(s: State, seat: Seat): View {
  return {
    me: seat, opts: s.opts, phase: s.phase, hand: s.hands[seat], counts: s.hands.map((h) => h.length), handNo: s.hand,
    level: s.level, levelTeam: s.levelTeam, teamLevels: s.teamLevels, aFails: s.aFails, turn: s.turn,
    lastPlay: s.lastPlay, recent: s.recent, history: s.history, finished: s.finished, tribute: s.tribute,
    lastHand: s.lastHand, ready: s.ready, winnerTeam: s.winnerTeam,
  };
}

// 同一组牌可能有几种出法（顺子 / 同花顺），牌型和主值也算进去
const keyOf = (a: Action) => (a.type === 'play' ? `${a.cards.slice().sort().join()}|${a.as?.kind}|${a.as?.main}` : a.type);
const toAction = (m: Move): Action => ({ type: 'play', cards: m.cards, as: m.as });

export function candidates(v: View, first: Action): Action[] {
  const list: Action[] = [first];
  const seen = new Set([keyOf(first)]);
  const add = (a: Action) => {
    const k = keyOf(a);
    if (seen.has(k) || list.length >= MAX_CANDS) return;
    seen.add(k);
    list.push(a);
  };
  if (v.lastPlay) {
    add({ type: 'pass' });
    const ms = beatsOf(v.hand, v.level, v.lastPlay);
    const normal = ms.filter((m) => !isBomb(m.p)).sort((a, b) => strength(a.p) - strength(b.p));
    const bombs = ms.filter((m) => isBomb(m.p)).sort((a, b) => strength(a.p) - strength(b.p));
    if (bombs[0]) add(toAction(bombs[0]));
    for (const m of normal) add(toAction(m));
  } else {
    for (const m of leadOrder(v)) add(toAction(m));
    for (const m of bombsOf(v.hand, v.level)) add(toAction(m));
  }
  return list;
}

/** 让出主线程：房主的浏览器还要画动画，算久了不能卡住画面 */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 先给每个候选打 FIRST 次，只留前 KEEP 名（规则 bot 的选择总留着）再接着打，
 * 一共打 BUDGET 次左右。
 */
export async function decide(v: View, signal?: AbortSignal): Promise<Action> {
  const first = ruleDecide(v);
  if (v.phase !== 'playing' || v.me === null) return first;
  const total = v.counts.reduce((a, b) => a + b, 0);
  if (total > CARD_LIMIT) return first;
  const cands = candidates(v, first);
  if (cands.length < 2) return first;
  const me = v.me;
  const rng = SeededRng.fromSeed(hashOf(v));
  const team = teamOf(me);
  const sum = new Array<number>(cands.length).fill(0);
  let alive = cands.map((_, i) => i);
  let n = 0;
  const sample = () => {
    const base = stateOf(v, deal(v, rng));
    const seed = rng.int(1 << 30);
    for (const i of alive) {
      const s = apply(base, me, cands[i], { rng: SeededRng.fromSeed(seed) });
      sum[i] += rollout(s, team, SeededRng.fromSeed(seed));
    }
    n++;
  };
  for (let k = 0; k < FIRST; k++) {
    sample();
    if (k % 4 === 3) await yieldNow();
    if (signal?.aborted) return first;
  }
  if (alive.length > KEEP) {
    const rest = alive.slice(1).sort((a, b) => sum[b] - sum[a]).slice(0, KEEP - 1);
    alive = [0, ...rest];
    for (const i of cands.keys()) if (!alive.includes(i)) sum[i] = -Infinity;
  }
  const more = Math.max(0, Math.floor((BUDGET - FIRST * cands.length) / alive.length));
  for (let k = 0; k < more; k++) {
    sample();
    if (k % 4 === 3) await yieldNow();
    if (signal?.aborted) return first;
  }
  // 规则 bot 的选择有个小优势：平均每副要好出 MARGIN 级才换，免得为抽样噪声换掉它
  let best = 0;
  for (let i = 1; i < cands.length; i++) if (sum[i] > sum[best] + MARGIN * n) best = i;
  return cands[best];
}

export const bot: Bot<View, Action> = {
  decide: (v, ctx) => decide(v, ctx.signal),
};
