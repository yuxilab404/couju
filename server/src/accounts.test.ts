import { beforeEach, describe, expect, it } from 'vitest';
import { Accounts, toPublic } from './accounts.ts';
import { Db } from './db.ts';
import { HttpError } from './errors.ts';
import { FakeMailer, testConfig } from './testutil.ts';

let now = 1_700_000_000_000;
let db: Db, mailer: FakeMailer, acc: Accounts;

beforeEach(() => {
  now = 1_700_000_000_000;
  db = new Db(':memory:');
  mailer = new FakeMailer();
  acc = new Accounts(db, testConfig(), mailer, () => now);
});

async function login(email: string) {
  await acc.requestCode(email, '1.1.1.1');
  return acc.verifyCode(email, mailer.lastCode(email.trim().toLowerCase()));
}

describe('登录', () => {
  it('管理员邮箱不在白名单也能登录，并成为管理员', async () => {
    const { token, user } = await login('Admin@X.com ');
    expect(user.is_admin).toBe(1);
    expect(user.nickname).toBe('admin');
    expect(acc.userBySession(token)?.id).toBe(user.id);
  });

  it('不在白名单：返回成功但不发信', async () => {
    await acc.requestCode('stranger@x.com', '');
    expect(mailer.sent).toHaveLength(0);
  });

  it('白名单为空时也不放行（与 auth.py 不同，ADR-0004）', async () => {
    await acc.requestCode('a@x.com', '');
    expect(mailer.sent).toHaveLength(0);
  });

  it('白名单用户登录；停用后会话立即失效', async () => {
    const admin = (await login('admin@x.com')).user;
    await acc.addToWhitelist('friend@x.com', '老王带来的', admin);
    expect(mailer.sent.at(-1)?.subject).toContain('邀请');
    now += 61_000;
    const { token } = await login('friend@x.com');
    expect(acc.userBySession(token)).not.toBeNull();
    acc.updateWhitelist('friend@x.com', { enabled: false });
    expect(acc.userBySession(token)).toBeNull();
    const wl = acc.whitelist();
    expect(wl[0]).toMatchObject({ email: 'friend@x.com', enabled: false, remark: '老王带来的', registered: true });
  });

  it('重发间隔 60 秒', async () => {
    await acc.requestCode('admin@x.com', '');
    await expect(acc.requestCode('admin@x.com', '')).rejects.toThrow('太频繁');
    now += 60_000;
    await acc.requestCode('admin@x.com', '');
  });

  it('错 5 次后要重新获取；过期不可用；用过不可再用', async () => {
    await acc.requestCode('admin@x.com', '');
    const code = mailer.lastCode('admin@x.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(() => acc.verifyCode('admin@x.com', wrong)).toThrow('不正确');
    expect(() => acc.verifyCode('admin@x.com', code)).toThrow('次数过多');

    now += 61_000;
    await acc.requestCode('admin@x.com', '');
    const c2 = mailer.lastCode('admin@x.com');
    now += 10 * 60_000 + 1;
    expect(() => acc.verifyCode('admin@x.com', c2)).toThrow('过期');

    await acc.requestCode('admin@x.com', '');
    const c3 = mailer.lastCode('admin@x.com');
    acc.verifyCode('admin@x.com', c3);
    expect(() => acc.verifyCode('admin@x.com', c3)).toThrow('过期');
  });

  it('同邮箱每日 10 次上限，按北京时间换日', async () => {
    for (let i = 0; i < 10; i++) {
      await acc.requestCode('admin@x.com', `ip${i}`);
      now += 61_000;
    }
    await expect(acc.requestCode('admin@x.com', 'ipx')).rejects.toThrow('上限');
    now += 86_400_000;
    await acc.requestCode('admin@x.com', 'ipx');
  });

  it('发信失败要报错', async () => {
    mailer.fail = true;
    await expect(acc.requestCode('admin@x.com', '')).rejects.toBeInstanceOf(HttpError);
  });

  it('管理员权限随配置变化，已有会话立即生效', async () => {
    const cfg = testConfig();
    const a = new Accounts(db, cfg, mailer, () => now);
    const admin = (await (async () => {
      await a.requestCode('admin@x.com', '');
      return a.verifyCode('admin@x.com', mailer.lastCode('admin@x.com'));
    })());
    await a.addToWhitelist('admin@x.com', '', admin.user);
    expect(a.userBySession(admin.token)?.is_admin).toBe(1);
    cfg.adminEmails.delete('admin@x.com');
    expect(a.userBySession(admin.token)?.is_admin).toBe(0);
    cfg.adminEmails.add('admin@x.com');
    expect(a.userBySession(admin.token)?.is_admin).toBe(1);
  });

  it('停用白名单和退出登录会通知 WebSocket 层', async () => {
    let revoked = 0;
    acc.onSessionsRevoked = () => revoked++;
    const admin = await login('admin@x.com');
    await acc.addToWhitelist('f@x.com', '', admin.user);
    acc.updateWhitelist('f@x.com', { enabled: false });
    expect(revoked).toBe(1);
    acc.logout(admin.token);
    expect(revoked).toBe(2);
  });

  it('会话 30 天过期', async () => {
    const { token } = await login('admin@x.com');
    now += 30 * 86_400_000 + 1;
    expect(acc.userBySession(token)).toBeNull();
  });
});

describe('资料', () => {
  it('改昵称', async () => {
    const { user } = await login('admin@x.com');
    expect(acc.setNickname(user.id, '  小  明 ').nickname).toBe('小 明');
    expect(() => acc.setNickname(user.id, '')).toThrow();
    expect(() => acc.setNickname(user.id, '一二三四五六七八九十一二三四五六七')).toThrow();
  });

  it('头像：只收图片，版本递增', async () => {
    const { user } = await login('admin@x.com');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
    expect(acc.setAvatar(user.id, png).avatar_ver).toBe(1);
    expect(acc.avatar(user.id)?.type).toBe('image/png');
    expect(acc.setAvatar(user.id, png).avatar_ver).toBe(2);
    expect(() => acc.setAvatar(user.id, new Uint8Array([1, 2, 3, 4, 5]))).toThrow('只支持');
    expect(toPublic(acc.setAvatar(user.id, null)).avatarUrl).toBeNull();
    // 删掉再传：版本号接着涨，不复用浏览器里已缓存的旧地址
    expect(toPublic(acc.setAvatar(user.id, png)).avatarUrl).toBe(`avatars/${user.id}?v=3`);
  });
});
