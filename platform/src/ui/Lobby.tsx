import { useEffect, useState } from 'react';
import type { RoomSummary } from '@couju/protocol';
import type { LobbyMeta } from '../wire.ts';
import { usePlatform } from './App.tsx';
import { Avatar } from './Avatar.tsx';
import { navigate } from './router.ts';

const PHASE: Record<string, string> = { waiting: '等人中', playing: '游戏中', ended: '结算中' };

export function Lobby() {
  const { conn, games } = usePlatform();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [joinId, setJoinId] = useState('');

  useEffect(() => {
    const off = conn.onMessage((m) => {
      if (m.t === 'lobby.rooms') setRooms(m.rooms);
    });
    const offOpen = conn.onOpen(() => conn.send({ t: 'lobby.watch' }));
    return () => {
      off();
      offOpen();
      conn.send({ t: 'lobby.unwatch' });
    };
  }, [conn]);

  return (
    <div className="lobby">
      <section className="card">
        <div className="row between">
          <h2>开一桌</h2>
          <button className="primary" onClick={() => navigate('/room/new')}>
            建房
          </button>
        </div>
        <p className="muted small">现在能玩：{games.map((g) => `${g.name}（${playersText(g.players)}）`).join('、')}。空位可以放机器人。</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const id = joinId.trim().toLowerCase();
            if (id) navigate(`/room/${id}`);
          }}
        >
          <input placeholder="输入房间号加入" value={joinId} onChange={(e) => setJoinId(e.target.value)} maxLength={6} />
          <button type="submit" disabled={!joinId.trim()}>
            加入
          </button>
        </form>
      </section>

      <section className="card">
        <h2>正在进行</h2>
        {rooms === null ? (
          <p className="muted">加载中…</p>
        ) : rooms.length === 0 ? (
          <p className="muted">现在没有房间，建一个叫朋友进来吧。</p>
        ) : (
          <ul className="room-list">
            {rooms.map((r) => {
              const meta = r.meta as LobbyMeta | null;
              return (
                <li key={r.id}>
                  <button className="room-item" onClick={() => navigate(`/room/${r.id}`)}>
                    <span className="room-title">
                      {meta?.gameName ?? '新房间'}
                      <span className="tag">{meta ? PHASE[meta.phase] : '等人中'}</span>
                    </span>
                    <span className="muted small">
                      房间 {r.id} · 房主 {r.hostName}
                      {meta && ` · ${meta.humans}/${meta.seats} 人`}
                    </span>
                    <span className="avatars">
                      {r.members.map((u) => (
                        <Avatar key={u.id} name={u.nickname} url={u.avatarUrl} id={u.id} size={24} />
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function playersText(p: { min: number; max: number }): string {
  return p.min === p.max ? `${p.min} 人` : `${p.min}–${p.max} 人`;
}
