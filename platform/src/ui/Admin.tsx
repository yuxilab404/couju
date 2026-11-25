import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

interface Entry {
  email: string;
  enabled: boolean;
  remark: string;
  addedBy: string;
  createdAt: number;
  registered: boolean;
  nickname: string | null;
}

export function Admin() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [admins, setAdmins] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [remark, setRemark] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ entries: Entry[]; admins: string[] }>('GET', '/api/admin/whitelist');
    setEntries(r.entries);
    setAdmins(r.admins);
  }, []);
  useEffect(() => {
    load().catch((e: Error) => setMsg(e.message));
  }, [load]);

  async function patch(e: Entry, body: { enabled?: boolean; remark?: string }) {
    try {
      await api('PATCH', `/api/admin/whitelist/${encodeURIComponent(e.email)}`, body);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="admin">
      <section className="card">
        <h2>邀请朋友</h2>
        <form
          className="row wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg(null);
            try {
              const r = await api<{ mailSent: boolean }>('POST', '/api/admin/whitelist', { email, remark });
              setMsg(r.mailSent ? `已加入白名单，邀请邮件已发给 ${email}` : `已加入白名单，但邀请邮件没发出去，可以直接把网址告诉 ${email}`);
              setEmail('');
              setRemark('');
              await load();
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        >
          <input type="email" placeholder="邮箱" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="备注（谁带来的）" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={100} />
          <button className="primary" type="submit">
            加入并发邀请
          </button>
        </form>
        {msg && <p className="small">{msg}</p>}
        <p className="muted small">管理员（配置里写死，不需要在白名单里）：{admins.join('、') || '无'}</p>
      </section>
      <section className="card">
        <h2>白名单</h2>
        {entries === null ? (
          <p className="muted">加载中…</p>
        ) : entries.length === 0 ? (
          <p className="muted">还没有人。</p>
        ) : (
          <table className="wl">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>昵称</th>
                <th>备注</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.email} className={e.enabled ? '' : 'disabled'}>
                  <td>{e.email}</td>
                  <td>{e.nickname ?? <span className="muted">未登录过</span>}</td>
                  <td>
                    <RemarkCell entry={e} onSave={(remark) => patch(e, { remark })} />
                  </td>
                  <td>
                    <button className="small" onClick={() => patch(e, { enabled: !e.enabled })}>
                      {e.enabled ? '停用' : '启用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">停用后这个人会立即被登出，也收不到验证码。</p>
      </section>
    </div>
  );
}

function RemarkCell({ entry, onSave }: { entry: Entry; onSave(remark: string): void }) {
  const [v, setV] = useState(entry.remark);
  return (
    <input
      className="inline"
      value={v}
      maxLength={100}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== entry.remark && onSave(v)}
      title={`由 ${entry.addedBy || '?'} 添加于 ${new Date(entry.createdAt).toLocaleDateString('zh-CN')}`}
    />
  );
}
