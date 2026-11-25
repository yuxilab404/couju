/** 平台界面外壳入口：登录检查、连接、路由。web/ 只负责挂载它并传入游戏注册表。 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Me } from '@couju/protocol';
import { Connection } from '../connection.ts';
import type { GameRegistry } from '../registry.ts';
import { Admin } from './Admin.tsx';
import { fetchMe } from './api.ts';
import { Avatar } from './Avatar.tsx';
import { Lobby } from './Lobby.tsx';
import { Login } from './Login.tsx';
import { Profile } from './Profile.tsx';
import { Room } from './Room.tsx';
import { navigate, parseRoute, usePath } from './router.ts';
import './app.css';

export interface PlatformCtx {
  me: Me;
  setMe(me: Me): void;
  conn: Connection;
  games: GameRegistry;
  buildId: string;
}

const Ctx = createContext<PlatformCtx | null>(null);
export function usePlatform(): PlatformCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePlatform 必须在 PlatformApp 里用');
  return c;
}

export function PlatformApp({ games, buildId }: { games: GameRegistry; buildId: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then(setMe, (e: Error) => setLoadError(e.message));
  }, []);

  if (loadError) return <div className="center-page">连不上服务器：{loadError}</div>;
  if (me === undefined) return <div className="center-page">加载中…</div>;
  if (me === null) return <Login onLogin={setMe} />;
  return <Authed me={me} setMe={setMe} games={games} buildId={buildId} />;
}

function Authed({ me, setMe, games, buildId }: { me: Me; setMe(m: Me | null): void; games: GameRegistry; buildId: string }) {
  const conn = useMemo(() => new Connection(), []);
  useEffect(() => {
    conn.start();
    return () => conn.stop();
  }, [conn]);
  const cs = useSyncExternalStore(conn.state.subscribe, conn.state.get);
  const path = usePath();
  const route = parseRoute(path);

  useEffect(() => {
    if (cs.status === 'unauthorized') setMe(null);
  }, [cs.status, setMe]);
  useEffect(() => {
    if (route.name === 'login') navigate('/', true);
  }, [route.name]);

  const ctx: PlatformCtx = { me, setMe, conn, games, buildId };
  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <header className="topbar">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            凑局
          </a>
          {cs.status !== 'open' && <span className="conn-badge">{cs.status === 'connecting' ? '连接中…' : '断线重连中…'}</span>}
          <span className="spacer" />
          {me.isAdmin && (
            <a href="/admin" onClick={(e) => (e.preventDefault(), navigate('/admin'))}>
              管理
            </a>
          )}
          <a className="me-link" href="/me" onClick={(e) => (e.preventDefault(), navigate('/me'))}>
            <Avatar name={me.nickname} url={me.avatarUrl} id={me.id} size={28} />
            <span className="me-name">{me.nickname}</span>
          </a>
        </header>
        <main className="content">
          {route.name === 'room' ? (
            <Room key={route.roomId ?? 'new'} roomId={route.roomId} />
          ) : route.name === 'me' ? (
            <Profile />
          ) : route.name === 'admin' && me.isAdmin ? (
            <Admin />
          ) : (
            <Lobby />
          )}
        </main>
      </div>
    </Ctx.Provider>
  );
}
