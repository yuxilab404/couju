import { useEffect, useState } from 'react';
import type { Me } from '@couju/protocol';
import { api } from './api.ts';

export function Login({ onLogin }: { onLogin(me: Me): void }) {
  const [email, setEmail] = useState(() => localStorageGet('couju.email'));
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/auth/code', { email });
      localStorageSet('couju.email', email.trim());
      setSent(true);
      setCooldown(60);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ me: Me }>('POST', '/api/auth/verify', { email, code });
      onLogin(r.me);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form
        className="card login"
        onSubmit={(e) => {
          e.preventDefault();
          if (sent && code) void verify();
          else void sendCode();
        }}
      >
        <h1>凑局</h1>
        <p className="muted">几个朋友凑一桌，人不够有机器人补上。</p>
        <label>
          邮箱
          <input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {sent && (
          <label>
            验证码
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </label>
        )}
        {sent && <p className="muted small">如果邮箱在白名单里，验证码已经发出，10 分钟内有效。没收到可以看看垃圾邮件。</p>}
        {error && <p className="error">{error}</p>}
        <div className="row">
          {sent && (
            <button type="submit" className="primary" disabled={busy || code.length !== 6}>
              登录
            </button>
          )}
          <button
            type={sent ? 'button' : 'submit'}
            className={sent ? '' : 'primary'}
            disabled={busy || !email || cooldown > 0}
            onClick={sent ? () => void sendCode() : undefined}
          >
            {cooldown > 0 ? `重新获取（${cooldown}）` : sent ? '重新获取' : '获取验证码'}
          </button>
        </div>
        <p className="muted small">只有被邀请的邮箱能登录。</p>
      </form>
    </div>
  );
}

function localStorageGet(k: string): string {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
}
function localStorageSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 隐私模式 */
  }
}
