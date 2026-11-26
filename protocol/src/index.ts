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
  /** 账号积分（ADR-0007），初始 RATING.initial */
  rating: number;
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

/**
 * 房主上报的一局输赢（ADR-0007）。服务端只按"谁赢谁输"算积分，不认识游戏：
 * gameId 只是记进历史的标签。
 */
export interface MatchReport {
  /** 房主开局时生成，进快照；同一个 matchId 只记一次，换房主后重报也不会重复计分 */
  matchId: string;
  gameId: string;
  /** 本局分量，平台已夹到 [0, RATING.maxWeight]；服务端会再夹一次 */
  weight: number;
  /** 赢的真人；bot 不参与积分 */
  winners: UserId[];
  /** 输的真人 */
  losers: UserId[];
}

export interface RatingChange {
  userId: UserId;
  before: number;
  after: number;
}

/** 服务端记下一局后回给房主的结果；重复上报回同一份 */
export interface MatchRating {
  matchId: string;
  changes: RatingChange[];
}

/** 一条积分历史（个人资料页） */
export interface RatingHistoryEntry {
  matchId: string;
  gameId: string;
  at: number;
  won: boolean;
  before: number;
  after: number;
}

export const RATING = {
  initial: 1200,
  /** 两个真人对局、分量 1、水平相当时，赢家拿 K/2 */
  k: 32,
  maxWeight: 3,
  maxPlayers: 12,
} as const;

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
  /** 仅房主；一局结束时上报输赢 */
  | { t: 'rating.report'; report: MatchReport }
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
  /** 回给上报的房主 */
  | { t: 'rating.result'; result: MatchRating }
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
