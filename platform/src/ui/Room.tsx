/** 房间页：等人（选游戏、规则、座位）→ 对局（游戏画面）→ 结算。 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react';
import type { Member } from '@couju/protocol';
import type { AnyGameDef, SeatInfo, TurnGameDef } from '@couju/sdk';
import { findGame } from '../registry.ts';
import { RoomSession, type GameState, type RoomState } from '../session.ts';
import { scoreKey, type RoomPublic, type SeatSlot } from '../wire.ts';
import { usePlatform } from './App.tsx';
import { Avatar } from './Avatar.tsx';
import { href } from '../base.ts';
import { navigate } from './router.ts';
import { tableActivity } from '../update.ts';

const TEAM_COLORS = ['#e76f51', '#2a9d8f', '#8e7dbe', '#e9c46a'];

export function Room({ roomId }: { roomId: string | null }) {
  const { conn, me, games, buildId } = usePlatform();
  const session = useMemo(() => new RoomSession(conn, me.id, games, buildId, roomId), [conn, me.id, games, buildId, roomId]);
  useEffect(() => () => session.leave(), [session]);
  const st = useSyncExternalStore(session.state.subscribe, session.state.get);
  // 对局中先不弹"有新版本"，这局打完再说
  const playing = st.status === 'in' && st.room?.phase === 'playing';
  useEffect(() => {
    tableActivity.set({ playing });
    return () => tableActivity.set({ playing: false });
  }, [playing]);

  // 新建的房间拿到房号后改地址，方便复制给朋友
  useEffect(() => {
    if (roomId === null && st.roomId) history.replaceState(null, '', href(`/room/${st.roomId}`));
  }, [roomId, st.roomId]);

  if (st.status === 'gone') {
    return (
      <div className="card">
        <p>{st.goneReason ?? '已离开房间'}</p>
        <button onClick={() => navigate('/')}>回大厅</button>
      </div>
    );
  }
  if (!st.room || !st.roomId) return <div className="card muted">正在进入房间…</div>;

  const def = findGame(games, st.room.config.gameId);
  return (
    <div className="room">
      <RoomBar st={st} def={def} session={session} />
      {st.notice && <div className="notice">{st.notice}</div>}
      {!def ? (
        <div className="card">这个房间的游戏在你的版本里没有，请刷新页面。</div>
      ) : st.room.phase === 'waiting' ? (
        <Waiting st={st} session={session} def={def} />
      ) : (
        <Playing st={st} session={session} def={def} />
      )}
    </div>
  );
}

/** 我在这一局里的座位，以及它是不是托管中；不在局里（旁观、等人、已结束）时为 null */
function myPlayingSeat(st: RoomState): { seat: number; hosted: boolean } | null {
  const seat = st.game?.seat ?? null;
  if (st.room?.phase !== 'playing' || seat === null) return null;
  return { seat, hosted: st.room.hosted.includes(seat) };
}

function RoomBar({ st, def, session }: { st: RoomState; def: AnyGameDef | undefined; session: RoomSession }) {
  const [copied, setCopied] = useState(false);
  const host = st.members.find((m) => m.id === st.hostId);
  const mine = myPlayingSeat(st);
  return (
    <div className="room-bar">
      <strong>{def?.name ?? '房间'}</strong>
      <span className="muted small">
        房间 {st.roomId} · 房主 {host?.nickname ?? '?'}
        {st.amHost && '（你）'}
      </span>
      <button
        className="small"
        onClick={() => {
          void navigator.clipboard?.writeText(location.href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? '已复制' : '复制邀请链接'}
      </button>
      <span className="spacer" />
      {/* 托管中时"取消托管"在牌桌上方的提示条里 */}
      {mine && !mine.hosted && (
        <button className="small" title="让机器人替你出牌，随时可以取消" onClick={() => session.setAuto(true)}>
          托管
        </button>
      )}
      <button className="small" onClick={() => navigate('/')}>
        离开
      </button>
    </div>
  );
}

function memberMap(members: Member[]): Map<number, Member> {
  return new Map(members.map((m) => [m.id, m]));
}

function seatInfos(room: RoomPublic, members: Member[], def: AnyGameDef): SeatInfo[] {
  const mm = memberMap(members);
  const teams = def.teams?.(room.seats.length);
  return room.seats.map((slot, seat) => {
    const m = slot.kind === 'human' ? mm.get(slot.userId) : undefined;
    return {
      seat,
      name: slot.kind === 'human' ? (m?.nickname ?? '离开的玩家') : `机器人 ${seat + 1}`,
      avatarUrl: m?.avatarUrl ?? null,
      kind: slot.kind === 'human' ? 'human' : 'bot',
      hosted: room.hosted.includes(seat),
      connected: slot.kind === 'human' ? !!m?.connected : true,
      team: teams ? teams[seat] : null,
    };
  });
}

function Waiting({ st, session, def }: { st: RoomState; session: RoomSession; def: AnyGameDef }) {
  const { me, games } = usePlatform();
  const room = st.room!;
  const engine = session.engine;
  const mm = memberMap(st.members);
  const mySeat = room.seats.findIndex((s) => s.kind === 'human' && s.userId === me.id);
  const teams = def.teams?.(room.seats.length);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const standing = st.members.filter((m) => !room.seats.some((s) => s.kind === 'human' && s.userId === m.id));
  const startBlock = engine?.canStart() ?? null;

  return (
    <div className="waiting">
      {st.amHost && engine ? (
        <section className="card">
          <h3>玩什么</h3>
          <div className="row wrap">
            <label>
              游戏
              <select value={room.config.gameId} onChange={(e) => engine.selectGame(e.target.value)}>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            {def.players.min !== def.players.max && (
              <label>
                人数
                <select value={room.seats.length} onChange={(e) => engine.setSeatCount(Number(e.target.value))}>
                  {range(def.players.min, def.players.max).map((n) => (
                    <option key={n} value={n}>
                      {n} 人
                    </option>
                  ))}
                </select>
              </label>
            )}
            {def.options?.map((o) => (
              <label key={o.key}>
                {o.label}
                <select
                  value={String(o.choices.findIndex((c) => c.value === room.config.options[o.key]))}
                  onChange={(e) => engine.setOption(o.key, o.choices[Number(e.target.value)].value)}
                >
                  {o.choices.map((c, i) => (
                    <option key={i} value={i}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      ) : (
        <section className="card">
          <h3>{def.name}</h3>
          <p className="muted small">
            {room.seats.length} 人 · 由房主选游戏和规则
            {def.options?.map((o) => {
              const c = o.choices.find((x) => x.value === room.config.options[o.key]);
              return c ? ` · ${o.label}：${c.label}` : '';
            })}
          </p>
        </section>
      )}

      <section className="card">
        <h3>座位</h3>
        <p className="muted small">
          {teams
            ? '按座位分队，同色边框的是队友：坐到空位或请房主换座来选队友，再来一局不换'
            : '每局开局时随机排座：这里只决定谁上桌、谁旁观，不决定坐哪儿'}
        </p>
        <div className="seats">
          {room.seats.map((slot, i) => {
            const m = slot.kind === 'human' ? mm.get(slot.userId) : undefined;
            const team = teams?.[i];
            return (
              <div
                key={i}
                className={`seat ${swapFrom === i ? 'selected' : ''}`}
                style={team !== undefined ? { borderColor: TEAM_COLORS[team % TEAM_COLORS.length] } : undefined}
              >
                <div className="seat-no">
                  {i + 1} 号位{team !== undefined && <span className="muted small"> · 队伍 {team + 1}</span>}
                </div>
                <SlotView slot={slot} member={m} seat={i} />
                <div className="seat-actions">
                  {slot.kind === 'empty' && mySeat !== i && (
                    <button className="small" onClick={() => session.sit(i)}>
                      坐这里
                    </button>
                  )}
                  {slot.kind === 'human' && slot.userId === me.id && (
                    <button className="small" onClick={() => session.sit(null)}>
                      站起来
                    </button>
                  )}
                  {st.amHost && engine && (
                    <>
                      {slot.kind !== 'bot' && (
                        <button className="small" onClick={() => engine.setSlot(i, { kind: 'bot' })}>
                          放机器人
                        </button>
                      )}
                      {slot.kind !== 'empty' && !(slot.kind === 'human' && slot.userId === me.id) && (
                        <button className="small" onClick={() => engine.setSlot(i, { kind: 'empty' })}>
                          {slot.kind === 'bot' ? '撤掉' : '请下座'}
                        </button>
                      )}
                      {teams && room.seats.length > 1 && (
                        <button
                          className="small"
                          onClick={() => {
                            if (swapFrom === null) setSwapFrom(i);
                            else {
                              if (swapFrom !== i) engine.swapSeats(swapFrom, i);
                              setSwapFrom(null);
                            }
                          }}
                        >
                          {swapFrom === null ? '换座' : swapFrom === i ? '取消' : '换到这'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {standing.length > 0 && (
          <p className="muted small">
            旁观：{standing.map((m) => m.nickname + (m.connected ? '' : '（离线）')).join('、')}
          </p>
        )}
        <div className="row">
          {st.amHost && engine ? (
            <>
              <button className="primary" disabled={startBlock !== null} onClick={() => engine.start()}>
                开始
              </button>
              {startBlock ? (
                <span className="muted small">{startBlock}</span>
              ) : (
                room.seats.some((s) => s.kind === 'empty') && <span className="muted small">空位会自动放机器人</span>
              )}
            </>
          ) : (
            <span className="muted">等房主开始…</span>
          )}
        </div>
      </section>
      <Scoreboard st={st} />
    </div>
  );
}

function SlotView({ slot, member, seat }: { slot: SeatSlot; member: Member | undefined; seat: number }) {
  if (slot.kind === 'empty') return <div className="slot muted">空位</div>;
  if (slot.kind === 'bot')
    return (
      <div className="slot">
        <Avatar name="机" url={null} id={`bot${seat}`} />
        <span>机器人</span>
      </div>
    );
  return (
    <div className="slot">
      <Avatar name={member?.nickname ?? '?'} url={member?.avatarUrl ?? null} id={slot.userId} />
      <span>
        {member?.nickname ?? '离开的玩家'}
        {member && !member.connected && <span className="muted small">（离线）</span>}
        {member && <span className="muted small rating-tag">{member.rating} 分</span>}
      </span>
    </div>
  );
}

/** 到了本机时刻 at 才返回 true */
function useReached(at: number): boolean {
  const [reached, setReached] = useState(() => Date.now() >= at);
  useEffect(() => {
    const left = at - Date.now();
    setReached(left <= 0);
    if (left <= 0) return;
    const t = setTimeout(() => setReached(true), left);
    return () => clearTimeout(t);
  }, [at]);
  return reached;
}

function Playing({ st, session, def }: { st: RoomState; session: RoomSession; def: AnyGameDef }) {
  const room = st.room!;
  const game = st.game;
  const settled = useReached(game?.settleAt ?? 0);
  const seats = seatInfos(room, st.members, def);
  if (!game) return <div className="card muted">等待房主同步…</div>;
  if (def.mode !== 'turn') return <div className="card">实时游戏还没有实现</div>;
  const Ui = (def as TurnGameDef<unknown, unknown, unknown, unknown>).ui;
  // 最后一下的动画（比如翻牌、枪响）放完再弹结算
  const ended = room.phase === 'ended' && settled;
  const mine = myPlayingSeat(st);
  return (
    <div className="playing">
      {game.seat === null && <div className="notice">你在旁观这一局</div>}
      {mine?.hosted && (
        <div className="notice autoplay" role="status">
          <span>托管中，机器人替你出牌</span>
          <button className="small primary" onClick={() => session.setAuto(false)}>
            取消托管
          </button>
        </div>
      )}
      {st.error && <div className="notice error">{st.error}</div>}
      <div className="board">
        {/* 每局换一个 key：新开一局画面从头挂载，发牌之类的入场动画重新放 */}
        <Ui
          key={room.round}
          view={game.view}
          seat={game.seat}
          seats={seats}
          act={(a) => session.act(a)}
          pending={st.pending}
          error={st.error}
          timer={game.timer}
          result={game.result}
        />
      </div>
      {ended && game.result && (
        <DraggableResult>
          <h3 className="drag-handle" data-drag-handle title="按住拖到别处">
            本局结束 <span className="muted small">（可拖动）</span>
          </h3>
          <p>{game.result.summary}</p>
          <ResultTable room={room} game={game} seats={seats} />
          <div className="row">
            {st.amHost && session.engine ? (
              <>
                <button className="primary" onClick={() => session.engine!.rematch()}>
                  再来一局
                </button>
                <button onClick={() => session.engine!.backToRoom()}>回到房间（换人/换游戏）</button>
              </>
            ) : (
              <span className="muted">等房主决定下一局…</span>
            )}
          </div>
        </DraggableResult>
      )}
    </div>
  );
}

/** 结算表：本局得分、房间累计、账号积分变化（ADR-0007） */
function ResultTable({ room, game, seats }: { room: RoomPublic; game: GameState; seats: SeatInfo[] }) {
  const result = game.result!;
  const rating = game.rating;
  const changes = rating && rating !== 'pending' ? new Map(rating.changes.map((c) => [c.userId, c])) : null;
  const ratingCell = (slot: SeatSlot) => {
    if (rating === null || slot.kind !== 'human') return <td />;
    const ch = changes?.get(slot.userId);
    if (!ch) return <td className="num muted">{rating === 'pending' ? '积分…' : ''}</td>;
    const d = ch.after - ch.before;
    return (
      <td className="num">
        积分 {ch.after}
        <span className={d > 0 ? 'delta up' : d < 0 ? 'delta down' : 'delta'}>（{fmt(d)}）</span>
      </td>
    );
  };
  return (
    <>
      {(result.scores || rating !== null) && (
        <table>
          <tbody>
            {seats.map((s) => (
              <tr key={s.seat} className={result.winners.includes(s.seat) ? 'win' : ''}>
                <td>{s.name}</td>
                {result.scores && (
                  <>
                    <td className="num">{fmt(result.scores[s.seat])}</td>
                    <td className="num muted">累计 {fmt(room.scoreboard[scoreKey(room.seats[s.seat], s.seat)] ?? 0)}</td>
                  </>
                )}
                {ratingCell(room.seats[s.seat])}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rating === 'pending' && <p className="muted small">积分结算中…</p>}
      {rating === null && <p className="muted small">本局不计积分（要有真人赢、也有真人输才计）</p>}
    </>
  );
}

/**
 * 结算弹窗：不加遮罩，按住标题拖到别处，免得挡住牌桌上摊开的牌。
 * 位移只在这个组件里，下一局重新出现时回到中间。
 */
function DraggableResult({ children }: { children: ReactNode }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    let x = d.ox + e.clientX - d.x;
    let y = d.oy + e.clientY - d.y;
    // 至少留一截标题在屏幕里，拖出去也能拖回来；上边界是吸顶导航栏的下沿，否则标题会被它盖住
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const keep = 48;
      const ceiling = Math.max(0, document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0);
      const left = r.left - offset.x + x;
      const top = r.top - offset.y + y;
      x += Math.max(0, keep - (left + r.width)) - Math.max(0, left - (innerWidth - keep));
      y += Math.max(0, ceiling - top) - Math.max(0, top - (innerHeight - keep));
    }
    setOffset({ x, y });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div className="result-overlay">
      <div
        ref={box}
        className="card result"
        role="dialog"
        aria-label="本局结束"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}

function Scoreboard({ st }: { st: RoomState }) {
  const room = st.room!;
  const mm = memberMap(st.members);
  const entries = Object.entries(room.scoreboard);
  if (entries.length === 0) return null;
  const name = (k: string) => (k.startsWith('u') ? (mm.get(Number(k.slice(1)))?.nickname ?? '离开的玩家') : `机器人 ${Number(k.slice(1)) + 1}`);
  return (
    <section className="card">
      <h3>本房间累计（{room.round} 局）</h3>
      <table>
        <tbody>
          {entries
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <tr key={k}>
                <td>{name(k)}</td>
                <td className="num">{fmt(v)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}

function fmt(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
