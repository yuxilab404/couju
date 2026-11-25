/** 邮件通道：Resend。都没配时只在 COUJU_DEV=1 下把内容打到日志（ADR-0004）。 */
import type { Config } from './config.ts';

export interface Mailer {
  send(to: string, subject: string, html: string): Promise<boolean>;
  /** 仅 COUJU_DEV=1：最近发给每个邮箱的邮件，供本地开发和端到端测试取验证码 */
  devOutbox?: Map<string, string>;
}

export function createMailer(cfg: Config, log: (msg: string) => void = console.log): Mailer {
  const devOutbox = cfg.dev ? new Map<string, string>() : undefined;
  return {
    devOutbox,
    async send(to, subject, html) {
      if (cfg.resendApiKey) {
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: cfg.mailFrom, to: [to], subject, html }),
            signal: AbortSignal.timeout(15_000),
          });
          if (res.ok) return true;
          log(`[mailer] Resend 发送失败: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
          return false;
        } catch (e) {
          log(`[mailer] Resend 发送异常: ${(e as Error).message}`);
          return false;
        }
      }
      if (cfg.dev) {
        devOutbox!.set(to, html);
        log(`[mailer:dev] to=${to} subject=${subject}\n${html}`);
        return true;
      }
      // 不输出内容（含验证码），让调用方对用户报错
      log(`[mailer:未配置] 邮件已丢弃（主题: ${subject}）`);
      return false;
    },
  };
}

export function loginCodeMail(code: string): [string, string] {
  return [
    '凑局登录验证码',
    `<p>你的登录验证码是：</p>` +
      `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>` +
      `<p>10 分钟内有效。若非本人操作请忽略本邮件。</p>`,
  ];
}

export function invitationMail(baseUrl: string): [string, string] {
  const url = escapeHtml(baseUrl);
  return [
    '你被邀请加入凑局',
    `<p>你好，你的邮箱已加入凑局的登录白名单，可以和朋友们一起开桌玩小游戏了。</p>` +
      `<p><a href="${url}">进入凑局</a></p>` +
      `<p>地址：${url}</p>` +
      `<p>请用收到这封邮件的邮箱获取登录验证码。若你不认识发件人，请忽略本邮件。</p>`,
  ];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
