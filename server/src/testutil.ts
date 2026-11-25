import type { Config } from './config.ts';
import type { Mailer } from './mailer.ts';

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1', port: 0, dataDir: '', webDir: '/nonexistent', baseUrl: 'http://127.0.0.1',
    adminEmails: new Set(['admin@x.com']), resendApiKey: '', mailFrom: 'test', dev: false, buildId: 'test',
    ...over,
  };
}

export class FakeMailer implements Mailer {
  sent: { to: string; subject: string; html: string }[] = [];
  fail = false;
  async send(to: string, subject: string, html: string) {
    if (this.fail) return false;
    this.sent.push({ to, subject, html });
    return true;
  }
  lastCode(to: string): string {
    const m = [...this.sent].reverse().find((x) => x.to === to && x.subject.includes('验证码'));
    return /(\d{6})/.exec(m?.html ?? '')?.[1] ?? '';
  }
}
