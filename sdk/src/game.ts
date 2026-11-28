/**
 * 游戏模块接口。游戏只依赖这个文件（及 rng）。
 * 形状和理由见 ARCHITECTURE.md §3 与 docs/adr/0002-game-interface.md。
 */
import type { ComponentType } from 'react';
import type { Rng } from './rng.ts';

/** 0..n-1，座位就是游戏里的玩家编号 */
export type Seat = number;

export interface Result {
  winners: Seat[];
  /** 本局每个座位的得分变化，平台在房间里累计 */
  scores?: number[];
  /** 给人看的一句话，例如 "地主获胜 · 春天 · ×8" */
  summary: string;
  /**
   * 账号积分的分量（ADR-0007），默认 1。输赢有大有小的游戏按这局的大小给（斗地主按倍数），
   * 平台夹到 [0, 3]；0 表示这局不计积分。赢的是 winners 里的真人，输的是其余座位上的真人。
   */
  weight?: number;
}

export interface OptionChoice<T = unknown> {
  value: T;
  label: string;
}

/** 建房时的可选规则，平台据此画通用表单 */
export interface OptionSpec<O> {
  key: keyof O & string;
  label: string;
  choices: OptionChoice[];
  default: unknown;
}

export interface SetupCtx<O> {
  numPlayers: number;
  options: O;
  rng: Rng;
}

export interface TurnRules<S, A> {
  /** 现在谁能动；可以多人同时 */
  active(s: S): Seat[];
  /** null 合法；否则返回给人看的原因 */
  validate(s: S, seat: Seat, a: A): string | null;
  /** 纯函数：返回新状态，不改入参 */
  apply(s: S, seat: Seat, a: A, ctx: { rng: Rng }): S;
  /**
   * 需要倒计时的局面。默认每应用一个动作就重新计时；
   * 给了 key 且与上一次相同则沿用原截止时刻（狼人杀一个阶段内多人陆续投票）。
   */
  timer?(s: S): { ms: number; seats: Seat[]; key?: string } | null;
  /** 超时的默认动作；不提供则让 bot 替这个座位出 */
  onTimeout?(s: S, seat: Seat): A;
  /**
   * 进入这个局面后桌上要停多久（毫秒），让人看清刚发生的事（翻牌、结算一墩）。
   * 平台在这段时间里不让 bot 出手，倒计时也顺延这么久；不提供就是 0。
   * 只影响节奏，不进规则：回放和交接都不需要它。平台把它夹在 [0, 10000]。
   */
  pause?(s: S): number;
}

export interface RealtimeRules<S, I> {
  tickHz: number;
  step(s: S, inputs: (I | null)[], ctx: { rng: Rng; tick: number }): S;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface LlmRequest {
  messages: LlmMessage[];
  /** 抽象档位，服务端映射到具体模型 */
  tier?: 'cheap' | 'strong';
}
export interface LlmReply {
  content: string;
}

export interface BotCtx {
  seat: Seat;
  rng: Rng;
  signal: AbortSignal;
  /** 只有 needsLlm 的 bot 拿得到，经服务端代理 */
  llm?: (req: LlmRequest) => Promise<LlmReply>;
}

export interface Bot<V, Out> {
  decide(view: V, ctx: BotCtx): Out | Promise<Out>;
  needsLlm?: boolean;
}

export interface SeatInfo {
  seat: Seat;
  name: string;
  avatarUrl: string | null;
  kind: 'human' | 'bot';
  /** 真人掉线后、或自己点了托管，由 bot 替他出 */
  hosted: boolean;
  connected: boolean;
  team: number | null;
}

export interface TimerInfo {
  seats: Seat[];
  /** 本机时钟的截止时刻（ms） */
  deadline: number;
}

export interface TurnUIProps<V, A> {
  view: V;
  /** 我坐的位置；旁观者为 null */
  seat: Seat | null;
  seats: SeatInfo[];
  act(a: A): void;
  /** 已发出操作、等待房主回应 */
  pending: boolean;
  /** 上一次操作被拒的原因 */
  error: string | null;
  timer: TimerInfo | null;
  result: Result | null;
}

export interface Frame<V> {
  tick: number;
  /** 本机收到时刻 */
  at: number;
  view: V;
}
export interface RealtimeUIProps<V, I> {
  /** 最近若干帧，旧→新；画面在两帧之间插值 */
  frames: () => readonly Frame<V>[];
  seat: Seat | null;
  seats: SeatInfo[];
  setInput(i: I): void;
  result: Result | null;
}

interface GameBase<S, V, O> {
  /** 进快照和大厅元数据，例如 'doudizhu' */
  id: string;
  /** 规则或状态结构变了就加一；交接时版本不一致则拒绝接手 */
  version: number;
  name: string;
  players: { min: number; max: number };
  /** 每个座位的队伍号；有固定队伍的游戏声明 */
  teams?(n: number): number[];
  options?: OptionSpec<O>[];
  setup(ctx: SetupCtx<O>): S;
  /** 这个座位能看到的东西；null = 旁观者 */
  view(s: S, seat: Seat | null): V;
  /** 所有座位视图相同 → 平台只广播一份 */
  publicView?: boolean;
  /** 非 null 即结束 */
  result(s: S): Result | null;
}

export interface TurnGameDef<S, A, V, O = Record<string, never>> extends GameBase<S, V, O> {
  mode: 'turn';
  turn: TurnRules<S, A>;
  bot: Bot<V, A>;
  ui: ComponentType<TurnUIProps<V, A>>;
  /** 给 conformance 测试用：只有 seat 自己能看到的标识（如手牌 id） */
  privateTokens?(s: S, seat: Seat): string[];
}

export interface RealtimeGameDef<S, I, V, O = Record<string, never>> extends GameBase<S, V, O> {
  mode: 'realtime';
  realtime: RealtimeRules<S, I>;
  bot: Bot<V, I>;
  ui: ComponentType<RealtimeUIProps<V, I>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameDef = TurnGameDef<any, any, any, any> | RealtimeGameDef<any, any, any, any>;

/** 帮助推断类型的恒等函数 */
export function defineTurnGame<S, A, V, O = Record<string, never>>(def: TurnGameDef<S, A, V, O>) {
  return def;
}
export function defineRealtimeGame<S, I, V, O = Record<string, never>>(def: RealtimeGameDef<S, I, V, O>) {
  return def;
}

export function defaultOptions(game: AnyGameDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of game.options ?? []) out[o.key] = o.default;
  return out;
}
