/**
 * 服务端 ⇄ 浏览器的 WebSocket 消息（ARCHITECTURE.md §5）。
 * 服务端只看这里的外层字段；relay.data / meta / checkpoint 对服务端是不透明的。
 */

export type UserId = number;

export interface PublicUser {
  id: UserId;
  nickname: string;
  /** 没有头像时为 null，前端画首字 */
  avatarUrl: string | null;
}

export interface Me extends PublicUser {
  email: string;
  isAdmin: boolean;
}

export interface Member extends PublicUser {
  connected: boolean;
  /** 入房顺序，选新房主时用 */
  joinedAt: number;
}

export interface RoomSummary {
  id: string;
  hostId: UserId;
  hostName: string;
  members: PublicUser[];
  /** 房主写的不透明摘要，平台层大厅解释 */
  meta: unknown;
  createdAt: number;
}

export type RelayTarget = 'host' | 'all' | UserId[];

/** 浏览器 → 服务端 */
export type ClientMsg =
  | { t: 'ping' }
  | { t: 'lobby.watch' }
  | { t: 'lobby.unwatch' }
  | { t: 'room.create'; meta: unknown }
  | { t: 'room.join'; roomId: string }
  | { t: 'room.leave' }
  | { t: 'room.meta'; meta: unknown }
  | { t: 'room.checkpoint'; data: string | null }
  | { t: 'relay'; to: RelayTarget; data: unknown };

/** 服务端 → 浏览器 */
export type ServerMsg =
  | { t: 'pong' }
  | { t: 'hello'; me: Me }
  | { t: 'lobby.rooms'; rooms: RoomSummary[] }
  | { t: 'room.state'; roomId: string; hostId: UserId; members: Member[]; meta: unknown }
  /** 换房主：发给所有人；给新房主的那份带最新快照 */
  | { t: 'room.host'; roomId: string; hostId: UserId; checkpoint?: string | null }
  | { t: 'room.left'; roomId: string; reason: 'leave' | 'closed' | 'replaced' }
  | { t: 'relay'; from: UserId; data: unknown }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode = 'bad_request' | 'not_found' | 'not_host' | 'not_in_room' | 'too_large' | 'rate_limited';

/** 服务端兜底上限，防程序出错，不是防作弊 */
export const LIMITS = {
  maxMessageBytes: 64 * 1024,
  /** 每个连接每秒最多消息数（实时游戏输入约 30/s，留余量） */
  maxMessagesPerSecond: 120,
  /** 房主掉线多久后换人（ms） */
  hostGraceMs: 15_000,
  pingIntervalMs: 10_000,
  /** 这么久没收到任何消息视为掉线 */
  deadAfterMs: 30_000,
} as const;

export const WS_PATH = '/ws';
