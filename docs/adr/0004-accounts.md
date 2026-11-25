# ADR-0004 账号：邮箱验证码 + 白名单

状态：已采纳 · 2026-11-25

## 背景

账号只为两件事：朋友之间认得出谁是谁（改名、换头像），以及链接被转出去了陌生人也进不来。Owner 要求照 yuxilab404/auto-tiandao-sign 的 `web/auth.py` 和白名单流程做。

## 决定

沿用 auto-tiandao-sign 的流程和参数，用 TypeScript 重写在 `server/src/auth.ts`。

### 登录

| 项 | 值 | 来源 |
|---|---|---|
| 验证码 | 6 位数字，`crypto.randomInt` | 同 auth.py |
| 有效期 | 10 分钟；用过即失效；同一验证码最多试错 5 次 | 同 |
| 限频 | 同邮箱重发间隔 60 秒、每日 10 次；同 IP 每日 20 次；全站每日 50 次（保护邮件额度） | 同 |
| 不在白名单 | 返回和成功完全一样的 `{ok:true}`，不发信（防枚举） | 同 |
| 发信失败 | 明确报错，不假装成功 | 同 |
| 会话 | 32 字节随机 token，库里只存 SHA-256；HttpOnly + SameSite=Lax cookie（HTTPS 下 Secure），30 天 | 改：库泄露也拿不到可用的会话 |
| 邮件通道 | Resend；没配时只在 `COUJU_DEV=1` 下把验证码打到日志 | 改：不做 SMTP 兜底（要多一个依赖，Owner 已有 Resend） |
| 时间 | 库里存 UTC 毫秒时间戳，显示时按北京时间 | 改：避免字符串比较时区 |

### 准入

- **白名单表 `allowed_emails(email, enabled, remark, added_by, created_at)`**。管理员添加时同时发一封邀请邮件，里面只有站点地址和"用这个邮箱登录"的说明。
- `remark` 记"谁带来的"，Owner 要求能知道每个人的来路；`added_by` 记是哪个管理员加的。
- **管理员只认环境变量 `COUJU_ADMIN_EMAILS`**。管理员邮箱不需要在白名单里也能登录。
- 和 auth.py 的一处不同：auth.py 在白名单为空时放行所有人（方便起步）。这里不这样做——AGENTS.md 明确不开放自助注册，起步时管理员邮箱本来就能登录，不需要这个口子。
- 停用白名单 = 立即删除这个人的所有会话。

### 资料

- 用户表 `users(id, email, nickname, avatar, avatar_ver, is_admin, created_at)`。首次登录时昵称默认取邮箱 @ 前面部分，可改，1–16 个字符，去首尾空白，不查重（朋友之间撞名自己会改）。
- 头像：浏览器里裁成 128×128、压成 WebP（不支持就 PNG）再上传，服务端只校验格式和大小（≤ 64 KB），存成 SQLite 的 BLOB。地址 `/avatars/<userId>?v=<avatar_ver>`，可长缓存。没传头像时前端用昵称首字 + 由 userId 算出的底色画一个。
- 存 BLOB 而不是文件：几十个人、每人几 KB，一个数据库文件就是全部数据，备份最简单。

### 不做

等级、好友、权限分级、第三方登录、密码、注销账号自助（Owner 停用白名单即可）。

## 什么时候重新考虑

- 邮件通道被封或额度不够：换通道只改 `server/src/mailer.ts`。
