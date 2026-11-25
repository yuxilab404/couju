/**
 * 平台层自己的消息，装在 relay.data 里，服务端看不懂也不需要看懂（ARCHITECTURE.md §5）。
 */
import type { Result, Seat } from '@couju/sdk';
import type { UserId } from '@couju/protocol';

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
}

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
}

export function scoreKey(slot: SeatSlot, seat: Seat): string {
  return slot.kind === 'human' ? `u${slot.userId}` : `b${seat}`;
}
