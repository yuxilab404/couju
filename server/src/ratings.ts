/**
 * 账号积分（ADR-0007）。服务端不认识游戏，只按房主报来的"哪些真人赢、哪些真人输"算分。
 *
 * 唯一真源是 rating_changes 里每局每人的增减：当前积分 = 初始分 + 历史增减之和，
 * 某局前后的分数也由累加得出，不另存，免得两份数对不上。
 */
import { RATING, type MatchRating, type MatchReport, type RatingHistoryEntry, type UserId } from '@couju/protocol';
import type { Db } from './db.ts';

/** 给 users 查询拼的列：当前积分 */
export const RATING_COL = `(${RATING.initial} + COALESCE((SELECT SUM(delta) FROM rating_changes WHERE user_id = users.id), 0)) AS rating`;

export class ReportError extends Error {}

/**
 * 两两比较的多人 Elo：每个赢家和每个输家算一场，分量 weight。
 * 每场的 K 按参与人数摊薄（2K/N），这样 1v1、1v2（斗地主）、2v2（掼蛋）、一赢多输（大乱斗）都零和，
 * 而且一个人要赢的对手越多，赢一局拿得越多。队友之间不比较。
 */
export function eloDeltas(
  winners: { id: UserId; rating: number }[],
  losers: { id: UserId; rating: number }[],
  weight: number,
): Map<UserId, number> {
  const out = new Map<UserId, number>();
  const n = winners.length + losers.length;
  if (winners.length === 0 || losers.length === 0 || weight <= 0) return out;
  const pairK = (RATING.k * weight * 2) / n;
  const raw = new Map<UserId, number>();
  for (const w of winners) {
    for (const l of losers) {
      const expected = 1 / (1 + 10 ** ((l.rating - w.rating) / 400));
      const d = pairK * (1 - expected);
      raw.set(w.id, (raw.get(w.id) ?? 0) + d);
      raw.set(l.id, (raw.get(l.id) ?? 0) - d);
    }
  }
  // 先赢家后输家，按上报顺序
  for (const { id } of [...winners, ...losers]) out.set(id, Math.round(raw.get(id)!));
  return out;
}

function idList(v: unknown): UserId[] | null {
  if (!Array.isArray(v) || v.length > RATING.maxPlayers) return null;
  const ids = v.map(Number);
  return ids.every((x) => Number.isSafeInteger(x) && x > 0) ? [...new Set(ids)] : null;
}

/** 校验上报的外层形状；不合法抛 ReportError */
export function parseReport(raw: unknown): MatchReport {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const matchId = typeof r.matchId === 'string' ? r.matchId : '';
  const gameId = typeof r.gameId === 'string' ? r.gameId : '';
  if (!/^[\w-]{8,64}$/.test(matchId)) throw new ReportError('matchId 不合法');
  if (!/^[\w-]{1,32}$/.test(gameId)) throw new ReportError('gameId 不合法');
  const weight = Number(r.weight);
  if (!Number.isFinite(weight)) throw new ReportError('weight 不合法');
  const winners = idList(r.winners);
  const losers = idList(r.losers);
  if (!winners || !losers) throw new ReportError('winners/losers 不合法');
  if (winners.some((id) => losers.includes(id))) throw new ReportError('同一个人不能既赢又输');
  return { matchId, gameId, weight: Math.max(0, Math.min(RATING.maxWeight, weight)), winners, losers };
}

export class Ratings {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  /** 记下一局并返回每人积分变化。同一个 matchId 第二次报来时不重算，回第一次的结果 */
  record(report: MatchReport): MatchRating {
    const existing = this.db.get<{ id: number }>('SELECT id FROM matches WHERE match_key=?', report.matchId);
    if (existing) return this.resultOf(existing.id, report.matchId);

    const ids = [...report.winners, ...report.losers];
    const ratings = this.current(ids);
    // 不存在的用户（理论上不会有）直接略过
    const side = (list: UserId[]) => list.filter((id) => ratings.has(id)).map((id) => ({ id, rating: ratings.get(id)! }));
    const deltas = eloDeltas(side(report.winners), side(report.losers), report.weight);
    const winners = new Set(report.winners);

    this.db.raw.exec('BEGIN IMMEDIATE');
    try {
      const { lastId } = this.db.run(
        'INSERT INTO matches(match_key, game_id, weight, created_at) VALUES (?,?,?,?)',
        report.matchId, report.gameId, report.weight, this.now(),
      );
      for (const [userId, delta] of deltas) {
        this.db.run(
          'INSERT INTO rating_changes(match_id, user_id, won, delta) VALUES (?,?,?,?)',
          lastId, userId, winners.has(userId) ? 1 : 0, delta,
        );
      }
      this.db.raw.exec('COMMIT');
      return {
        matchId: report.matchId,
        changes: [...deltas].map(([userId, delta]) => {
          const before = ratings.get(userId)!;
          return { userId, before, after: before + delta };
        }),
      };
    } catch (e) {
      this.db.raw.exec('ROLLBACK');
      throw e;
    }
  }

  current(ids: UserId[]): Map<UserId, number> {
    const out = new Map<UserId, number>();
    if (ids.length === 0) return out;
    const rows = this.db.all<{ id: number; rating: number }>(
      `SELECT id, ${RATING_COL} FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    for (const r of rows) out.set(r.id, r.rating);
    return out;
  }

  /** 最近的积分记录，新→旧 */
  history(userId: UserId, limit = 20): RatingHistoryEntry[] {
    return this.db
      .all<{ match_key: string; game_id: string; created_at: number; won: number; delta: number; total: number }>(
        `SELECT m.match_key, m.game_id, m.created_at, c.won, c.delta,
                SUM(c.delta) OVER (ORDER BY c.match_id) AS total
         FROM rating_changes c JOIN matches m ON m.id = c.match_id
         WHERE c.user_id = ?
         ORDER BY c.match_id DESC LIMIT ?`,
        userId, limit,
      )
      .map((r) => {
        const after = RATING.initial + r.total;
        return { matchId: r.match_key, gameId: r.game_id, at: r.created_at, won: !!r.won, before: after - r.delta, after };
      });
  }

  /** 计过分的局数和赢的局数 */
  stats(userId: UserId): { games: number; wins: number } {
    const r = this.db.get<{ games: number; wins: number | null }>(
      'SELECT COUNT(*) AS games, SUM(won) AS wins FROM rating_changes WHERE user_id=?',
      userId,
    )!;
    return { games: r.games, wins: r.wins ?? 0 };
  }

  private resultOf(matchRowId: number, matchId: string): MatchRating {
    // 每人到这一局为止的累计（含这一局）
    const rows = this.db.all<{ user_id: number; delta: number; total: number }>(
      `SELECT user_id, delta, total FROM (
         SELECT match_id, user_id, delta, SUM(delta) OVER (PARTITION BY user_id ORDER BY match_id) AS total
         FROM rating_changes
         WHERE user_id IN (SELECT user_id FROM rating_changes WHERE match_id = ?)
       ) WHERE match_id = ?`,
      matchRowId, matchRowId,
    );
    return {
      matchId,
      changes: rows.map((r) => {
        const after = RATING.initial + r.total;
        return { userId: r.user_id, before: after - r.delta, after };
      }),
    };
  }
}
