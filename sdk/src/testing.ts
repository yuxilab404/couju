/**
 * 游戏一致性测试工具：用 bot 自己跟自己打，检查 ADR-0002 的硬约束。
 * 每个游戏在自己的测试里调用 runConformance(game)。
 */
import type { Seat, TurnGameDef } from './game.ts';
import { defaultOptions } from './game.ts';
import { SeededRng } from './rng.ts';

export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export interface ConformanceOptions {
  games?: number;
  seed?: number;
  numPlayers?: number[];
  maxSteps?: number;
}

interface Played {
  seat: Seat;
  action: unknown;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function jsonRoundtrip(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

/** 用同一个种子和动作序列重放，返回最终状态 JSON */
export function replay<S, A, V, O>(
  game: TurnGameDef<S, A, V, O>,
  seed: number,
  numPlayers: number,
  options: O,
  actions: Played[],
): string {
  const rng = SeededRng.fromSeed(seed);
  let s = game.setup({ numPlayers, options, rng });
  for (const p of actions) s = game.turn.apply(s, p.seat, p.action as A, { rng });
  return JSON.stringify(s);
}

export async function runConformance<S, A, V, O>(
  game: TurnGameDef<S, A, V, O>,
  opts: ConformanceOptions = {},
): Promise<{ games: number; avgSteps: number }> {
  const total = opts.games ?? 200;
  const counts = opts.numPlayers ?? range(game.players.min, game.players.max);
  const maxSteps = opts.maxSteps ?? 5000;
  const options = defaultOptions(game) as O;
  let steps = 0;

  for (let g = 0; g < total; g++) {
    const seed = (opts.seed ?? 1) * 100003 + g;
    const n = counts[g % counts.length];
    const rng = SeededRng.fromSeed(seed);
    const botRng = SeededRng.fromSeed(seed ^ 0x5bd1e995);
    let s = deepFreeze(game.setup({ numPlayers: n, options, rng }));
    const log: Played[] = [];
    const ctx = (seat: Seat) => ({ seat, rng: botRng, signal: new AbortController().signal });

    let i = 0;
    while (game.result(s) === null) {
      assert(++i <= maxSteps, `${game.id} 第 ${g} 局 ${maxSteps} 步内没有结束`);
      const active = game.turn.active(s);
      assert(active.length > 0, `${game.id} 第 ${g} 局没有结束却没有人能动`);
      checkState(game, s, n, g);
      const seat = active[botRng.int(active.length)];
      const view = game.view(s, seat);
      const action = await game.bot.decide(jsonRoundtrip(view) as V, ctx(seat));
      const reason = game.turn.validate(s, seat, action);
      assert(reason === null, `${game.id} 第 ${g} 局 bot 出了不合法的动作：${reason} ${JSON.stringify(action)}`);
      log.push({ seat, action: jsonRoundtrip(action) });
      s = deepFreeze(game.turn.apply(s, seat, action, { rng }));
    }
    checkState(game, s, n, g);
    const result = game.result(s)!;
    if (result.scores) assert(result.scores.length === n, `${game.id} scores 长度应为 ${n}`);
    const again = replay(game, seed, n, options, log);
    assert(again === JSON.stringify(s), `${game.id} 第 ${g} 局不确定：同种子同动作重放结果不同`);
    steps += i;
  }
  return { games: total, avgSteps: steps / total };
}

function checkState<S, A, V, O>(game: TurnGameDef<S, A, V, O>, s: S, n: number, g: number) {
  const json = JSON.stringify(s);
  assert(JSON.stringify(JSON.parse(json)) === json, `${game.id} 第 ${g} 局状态不能 JSON 往返`);
  if (!game.privateTokens) return;
  for (let owner = 0; owner < n; owner++) {
    const tokens = game.privateTokens(s, owner).map((t) => JSON.stringify(t));
    const viewers: (Seat | null)[] = [...range(0, n - 1).filter((x) => x !== owner), null];
    for (const viewer of viewers) {
      const v = JSON.stringify(game.view(s, viewer));
      for (const t of tokens) {
        assert(!v.includes(t), `${game.id} 第 ${g} 局：座位 ${viewer} 的视图泄露了座位 ${owner} 的 ${t}`);
      }
    }
  }
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
