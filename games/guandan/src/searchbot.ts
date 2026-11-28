/**
 * 残局搜索：把看不见的牌随机分给另外三家（张数对得上、进贡换过手的牌放到收贡的人手里），
 * 每个候选出法都在同一批假想牌局里用规则 bot 打完这一副，取平均结果最好的出法。
 * 只看 view；随机数从局面算出来，同一局面总是同一个决定。
 */
import { SeededRng, type Bot, type Seat } from '@couju/sdk';
import { isWild, makeDeck, rankOf, valueOf } from './cards.ts';
import { chooseContest } from './contest.ts';
import { beatsOf, bombsOf, decide as ruleDecide, leadOrder, naturalCost, type Move } from './bot.ts';
import { isBomb, strength } from './patterns.ts';
import { preserveFlush } from './preserve-flush.ts';
import { apply, teamOf, type Action, type HandSummary, type State, type View } from './rules.ts';

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
  return dealer(v)(rng);
}

/** 同一步会取几十次样本，公开牌和进贡约束只整理一次。 */
function dealer(v: View): (rng: SeededRng) => string[][] {
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
  const unseen = makeDeck().filter((id) => !gone.has(id));
  // 贡牌是原手中最大的非配牌；收回来的牌已经按转手记录固定，不受这个上限限制。
  const caps = new Array<number>(4).fill(Infinity);
  for (const gift of t?.gifts ?? []) caps[gift.from] = valueOf(gift.card, v.level);
  const seats = [0, 1, 2, 3].filter((i) => i !== me).sort((a, b) => caps[a] - caps[b]);
  const { jokers, rest, placements } = jokerPlacements(v, hands, unseen, caps, seats);
  const placementWeight = placements.reduce((sum, p) => sum + p.weight, 0);
  return (rng) => {
    const sampled = hands.map((h) => h.slice());
    if (jokers.length) {
      let choice = rng.next() * placementWeight;
      const placement = placements.find((p) => (choice -= p.weight) < 0) ?? placements[placements.length - 1];
      for (let i = 0; i < jokers.length; i++) sampled[placement.owners[i]].push(jokers[i]);
    }
    let pool = rng.shuffle(rest);
    let previousCap = caps[seats[0]];
    // 允许牌的集合按大小嵌套：先给限制最严的一家，避免把它能拿的牌先分光。
    for (const seat of seats) {
      // 前一家跳过的大牌会停在池子前部；放宽上限时重排，否则下家会特别容易拿大牌。
      if (caps[seat] > previousCap) pool = rng.shuffle(pool);
      previousCap = caps[seat];
      for (let k = 0; k < pool.length && sampled[seat].length < v.counts[seat];) {
        const card = pool[k];
        if (isWild(card, v.level) || valueOf(card, v.level) <= caps[seat]) {
          sampled[seat].push(card);
          pool.splice(k, 1);
        } else k++;
      }
    }
    return sampled;
  };
}

/** 抗贡约束只涉及两张大王，最多枚举 3² 种归属，不靠反复重发碰运气。 */
function jokerPlacements(v: View, hands: string[][], unseen: string[], caps: number[], seats: Seat[]) {
  const t = v.tribute;
  const jokers = t ? unseen.filter((c) => rankOf(c) === 17) : [];
  const rest = jokers.length ? unseen.filter((c) => rankOf(c) !== 17) : unseen;
  const placements: { owners: Seat[]; weight: number }[] = [];
  if (!t || !jokers.length) return { jokers, rest, placements };
  // 抗贡看发牌时的大王归属。贡牌 / 还贡可能改了现在的持有者，按第一次转手还原来源。
  const origin = new Map<string, Seat>();
  for (const h of v.history) for (const c of h.cards ?? []) origin.set(c, h.seat);
  for (const seat of [0, 1, 2, 3]) for (const c of hands[seat]) origin.set(c, seat);
  const transferred = new Set<string>();
  for (const x of [...t.pairs, ...t.returns]) {
    if (!transferred.has(x.card)) origin.set(x.card, x.from);
    transferred.add(x.card);
  }
  const knownGivers = ['J17a', 'J17b'].filter((c) => {
    const seat = origin.get(c);
    return !jokers.includes(c) && seat !== undefined && t.givers.includes(seat);
  }).length;
  const visit = (owners: Seat[]) => {
    if (owners.length < jokers.length) {
      for (const seat of seats) {
        const occupied = hands[seat].length + owners.filter((x) => x === seat).length;
        if (caps[seat] >= 17 && occupied < v.counts[seat]) visit([...owners, seat]);
      }
      return;
    }
    const giverJokers = knownGivers + owners.filter((seat) => t.givers.includes(seat)).length;
    if (t.resisted ? giverJokers !== 2 : giverJokers === 2) return;
    // 按剩余普通牌的合法分法数加权，不能平均挑座位，否则会偏向牌少的人。
    let weight = 1, assigned = 0;
    for (const seat of seats) {
      const need = v.counts[seat] - hands[seat].length - owners.filter((x) => x === seat).length;
      const available = rest.filter((c) => isWild(c, v.level) || valueOf(c, v.level) <= caps[seat]).length - assigned;
      weight *= combinations(available, need);
      assigned += need;
    }
    if (weight > 0) placements.push({ owners, weight });
  };
  visit([]);
  return { jokers, rest, placements };
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) result = result * (n - i + 1) / i;
  return result;
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

/** 单副比净升级；整场优先过 A，其次避免本队从 A 退回 2。 */
export function handValue(h: HandSummary, team: number, fullMatch: boolean): number {
  const sign = h.winTeam === team ? 1 : -1;
  if (!fullMatch) return sign * h.up;
  if (h.passedA) return sign * 20;
  return sign * h.up + (h.resetTeam === null ? 0 : h.resetTeam === team ? -8 : 8);
}

/** 用规则 bot 把这一副打完，返回我方收益。 */
function rollout(s: State, team: number, rng: SeededRng, fullMatch: boolean): number {
  let guard = 0;
  while (s.phase === 'playing' && guard++ < 400) {
    const seat = s.turn;
    s = apply(s, seat, ruleDecide(viewFor(s, seat)), { rng });
  }
  const h = s.lastHand;
  if (s.phase === 'playing' || !h) return 0;
  return handValue(h, team, fullMatch);
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
    // 只从小到大截断会漏掉 A / 王这样的封顶牌，残局恰恰常需要它截住对手。
    if (normal.length) {
      add(toAction(normal[0]));
      add(toAction(normal[normal.length - 1]));
      // 同样能管上的牌，选一个最不伤剩余结构的；不要让几张邻近小牌占满名额。
      const bestShape = normal.map((m) => {
        const used = new Set(m.cards);
        return { m, cost: naturalCost(v.hand.filter((c) => !used.has(c)), v.level) };
      }).sort((a, b) => a.cost - b.cost || strength(a.m.p) - strength(b.m.p))[0];
      add(toAction(bestShape.m));
    }
    for (const m of normal) add(toAction(m));
  } else {
    const ordered = leadOrder(v);
    // 喂对家一张 / 一对可能需要拆开现成组合，不能只搜同一份拆牌里的先后顺序。
    const partnerCount = v.counts[(v.me! + 2) % 4];
    if (partnerCount === 1 || partnerCount === 2) {
      const kind = partnerCount === 1 ? 'single' : 'pair';
      const feeds = beatsOf(v.hand, v.level, { kind, main: 0, size: partnerCount })
        .filter((m) => m.p.kind === kind).sort((a, b) => strength(a.p) - strength(b.p));
      if (feeds[0]) add(toAction(feeds[0]));
    }
    for (const m of ordered) add(toAction(m));
    for (const m of bombsOf(v.hand, v.level)) add(toAction(m));
  }
  return list;
}

/** 让出主线程：房主的浏览器还要画动画，算久了不能卡住画面 */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 换牌门槛只相对规则首选比较，不能让候选的遍历顺序改变最终赢家。 */
export function bestCandidate(sum: readonly number[], samples: number): number {
  let best = 0;
  for (let i = 1; i < sum.length; i++) if (sum[i] > sum[best]) best = i;
  return sum[best] > sum[0] + MARGIN * samples ? best : 0;
}

/**
 * 先给每个候选打 FIRST 次，只留前 KEEP 名（规则 bot 的选择总留着）再接着打，
 * 一共打 BUDGET 次左右。
 */
async function searchDecision(v: View, signal?: AbortSignal): Promise<Action> {
  const first = ruleDecide(v);
  if (signal?.aborted || v.phase !== 'playing' || v.me === null) return first;
  if (first.type === 'play' && first.cards.length === v.hand.length) {
    // 对家已经头游时立即锁定双上；只剩两家时直接拿三游。
    // 对手开单、自己最后一张能拿头游，也别让一次有噪声的推演把确定的胜局让出去。
    const team = teamOf(v.me);
    const winFirst = !v.finished.length && v.hand.length === 1 && v.lastPlay && teamOf(v.lastPlay.seat) !== team;
    if (winFirst || v.finished.length === 2 || v.finished.some(seat => teamOf(seat) === team)) return first;
  }
  const total = v.counts.reduce((a, b) => a + b, 0);
  if (total > CARD_LIMIT) return chooseContest(v, first);
  const cands = candidates(v, first);
  if (cands.length < 2) return first;
  const me = v.me;
  const rng = SeededRng.fromSeed(hashOf(v));
  const sampleHands = dealer(v);
  const team = teamOf(me);
  const sum = new Array<number>(cands.length).fill(0);
  let alive = cands.map((_, i) => i);
  let n = 0;
  // 时间只决定何时把主线程还给浏览器。抽样数量和选牌结果与设备速度无关。
  let yieldAt = performance.now() + 8;
  const sample = async () => {
    const base = stateOf(v, sampleHands(rng));
    const seed = rng.int(1 << 30);
    for (const i of alive) {
      const s = apply(base, me, cands[i], { rng: SeededRng.fromSeed(seed) });
      sum[i] += rollout(s, team, SeededRng.fromSeed(seed), v.opts.length === 'full');
      if (performance.now() >= yieldAt) {
        await yieldNow();
        if (signal?.aborted) return false;
        yieldAt = performance.now() + 8;
      }
    }
    n++;
    return true;
  };
  for (let k = 0; k < FIRST; k++) {
    if (signal?.aborted || !await sample()) return first;
  }
  if (alive.length > KEEP) {
    const rest = alive.slice(1).sort((a, b) => sum[b] - sum[a]).slice(0, KEEP - 1);
    alive = [0, ...rest];
    for (const i of cands.keys()) if (!alive.includes(i)) sum[i] = -Infinity;
  }
  const more = Math.max(0, Math.floor((BUDGET - FIRST * cands.length) / alive.length));
  for (let k = 0; k < more; k++) {
    if (signal?.aborted || !await sample()) return first;
  }
  // 规则 bot 的选择有个小优势：平均每副要好出 MARGIN 级才换，免得为抽样噪声换掉它
  return cands[bestCandidate(sum, n)];
}

/** 真实出口才换等价花色；内部规则推演保留便宜的按点数策略。 */
export async function decide(v: View, signal?: AbortSignal): Promise<Action> {
  const action = await searchDecision(v, signal);
  return signal?.aborted ? action : preserveFlush(v, action);
}

export const bot: Bot<View, Action> = {
  decide: (v, ctx) => decide(v, ctx.signal),
};
