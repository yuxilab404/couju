import { useRef, useState } from 'react';
import type { Me } from '@couju/protocol';
import { href } from '../base.ts';
import { api } from './api.ts';
import { usePlatform } from './App.tsx';
import { Avatar } from './Avatar.tsx';

const SIZE = 128;

/** 在浏览器里裁成正方形并缩到 128×128（ADR-0004：算力推到玩家电脑上） */
async function toAvatarBlob(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  const tryType = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  for (const [type, q] of [['image/webp', 0.85], ['image/webp', 0.6], ['image/png', undefined]] as const) {
    const b = await tryType(type, q);
    if (b && b.type === type && b.size <= 64 * 1024) return b;
  }
  throw new Error('图片压不到 64 KB 以下，换一张试试');
}

export function Profile() {
  const { me, setMe } = usePlatform();
  const [nickname, setNickname] = useState(me.nickname);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<{ me: Me }>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      setMe((await fn()).me);
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile">
      <section className="card">
        <h2>我的资料</h2>
        <div className="row">
          <Avatar name={me.nickname} url={me.avatarUrl} id={me.id} size={72} />
          <div className="col">
            <button disabled={busy} onClick={() => fileRef.current?.click()}>
              换头像
            </button>
            {me.avatarUrl && (
              <button className="small" disabled={busy} onClick={() => run(() => api('DELETE', '/api/me/avatar'), '已恢复默认头像')}>
                用默认头像
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void run(async () => api('PUT', '/api/me/avatar', undefined, await toAvatarBlob(f)), '头像已更新');
            }}
          />
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api('PATCH', '/api/me', { nickname }), '昵称已保存');
          }}
        >
          <label className="grow">
            昵称
            <input value={nickname} maxLength={16} onChange={(e) => setNickname(e.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={busy || !nickname.trim() || nickname === me.nickname}>
            保存
          </button>
        </form>
        <p className="muted small">登录邮箱：{me.email}</p>
        {msg && <p className="small">{msg}</p>}
      </section>
      <button
        onClick={async () => {
          await api('POST', '/api/auth/logout');
          location.href = href('/');
        }}
      >
        退出登录
      </button>
    </div>
  );
}
