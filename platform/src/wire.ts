/**
 * 平台层自己的消息，装在 relay.data 里，服务端看不懂也不需要看懂（ARCHITECTURE.md §5）。
 */
import type { Result, Seat } from '@couju/sdk';
import type { MatchRating, MatchReport, UserId } from '@couju/protocol';

export type SeatSlot =
  | { kind: 'empty' }
  | { kind: 'human'; userId: UserId }
  | { kind: 'bot' };

export type RoomPhase = 'waiting' | 'playing' | 'ended';

export interface RoomConfig {
  gameId: string;
  options: Record<string, unknown>;
}

/** 房主广播给所有人的房间公开信息 */
export interface RoomPublic {
  config: RoomConfig;
  seats: SeatSlot[];
  /** 掉线托管中的座位 */
  hosted: Seat[];
  phase: RoomPhase;
  /** 键：`u<userId>` 或 `b<seat>` */
  scoreboard: Record<string, number>;
  round: number;
  /** 房主前端版本，新老版本混用时提示刷新 */
  buildId: string;
}

export interface GamePublic {
  seat: Seat | null;
  view: unknown;
  seq: number;
  /** 距截止还剩多少毫秒；接收方换算成本机时刻 */
  timer: { seats: Seat[]; remainingMs: number } | null;
  result: Result | null;
  rating: RatingStatus;
  /** 这个局面还要停多少毫秒（TurnRules.pause 剩下的部分）；结算弹窗等它停完再出来。旧版本房主不发 */
  pauseMs?: number;
}

/** 这局的账号积分：null = 不计分；'pending' = 已结束、等服务端记分；否则是服务端回的结果 */
export type RatingStatus = MatchRating | 'pending' | null;

/** 普通成员 → 房主 */
export type ToHost =
  | { k: 'hello' }
  | { k: 'sit'; seat: Seat | null }
  | { k: 'act'; seq: number; action: unknown };

/** 房主 → 成员 */
export type ToMember =
  | { k: 'sync'; room: RoomPublic; game: GamePublic | null }
  | { k: 'reject'; seq: number; reason: string };

/** 大厅里显示的摘要（房主写进 room.meta） */
export interface LobbyMeta {
  gameId: string;
  gameName: string;
  seats: number;
  humans: number;
  phase: RoomPhase;
}

/** 交接快照（服务端暂存，不解析） */
export interface Checkpoint {
  v: 1;
  buildId: string;
  config: RoomConfig;
  seats: SeatSlot[];
  phase: RoomPhase;
  scoreboard: Record<string, number>;
  round: number;
  game: GameEnvelope | null;
  /**
   * 已结束、服务端还没回执的积分上报（ADR-0007）。不只当前这局：断线时打完又开了下一局，
   * 上一局的上报也在这里，换房主或刷新后接着报；服务端按 matchId 去重。
   * TODO(del-when: 积分上线一周后，旧版本写的快照都已过期)：旧快照没有这个字段，按空处理
   */
  unrated?: MatchReport[];
}

export interface GameEnvelope {
  gameId: string;
  gameVersion: number;
  numPlayers: number;
  options: Record<string, unknown>;
  state: unknown;
  rng: [number, number, number, number];
  seq: number;
  /** 开局时座位后面是谁，结算记分用 */
  seatKeys: string[];
  /** 开局时生成，上报积分时去重用（ADR-0007） */
  matchId: string;
  /** 服务端记完分回来的结果，下发给大家看 */
  rating: MatchRating | null;
}

export function scoreKey(slot: SeatSlot, seat: Seat): string {
  return slot.kind === 'human' ? `u${slot.userId}` : `b${seat}`;
}
