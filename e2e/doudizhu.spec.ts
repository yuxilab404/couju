import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByLabel('验证码')).toBeVisible();
  const { code } = await (await page.request.get(`/api/dev/last-code?email=${encodeURIComponent(email)}`)).json();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('验证码').fill(code);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开一桌' })).toBeVisible();
}

/** 轮到自己就操作：叫分阶段叫 3 分或不叫；出牌阶段按提示出，提示不了就不要 */
async function playUntilEnd(page: Page, maxSteps = 400) {
  const result = page.getByRole('heading', { name: '本局结束' });
  for (let i = 0; i < maxSteps; i++) {
    if (await result.isVisible()) return;
    const bid3 = page.getByRole('button', { name: '3 分' });
    const play = page.getByRole('button', { name: '出牌' });
    if (await bid3.isVisible()) {
      if (await bid3.isEnabled()) await bid3.click();
      else await page.getByRole('button', { name: '不叫' }).click();
    } else if (await play.isVisible()) {
      const hint = page.getByRole('button', { name: '提示' });
      if (await hint.isEnabled()) {
        await hint.click();
        await play.click();
      } else {
        await page.getByRole('button', { name: '不要' }).click();
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error('没有打完');
}

test('一个人 + 两个机器人打完一局斗地主，再来一局', async ({ page }) => {
  await login(page, 'admin@e2e.test');
  await page.getByRole('button', { name: '建房' }).click();
  await expect(page).toHaveURL(/\/room\/[a-z0-9]{6}$/);
  await expect(page.getByText('空位会自动放机器人')).toBeVisible();
  await page.getByRole('button', { name: '开始' }).click();
  await playUntilEnd(page);
  await expect(page.locator('.result')).toContainText(/地主|农民/);
  await page.getByRole('button', { name: '再来一局' }).click();
  await expect(page.getByRole('heading', { name: '本局结束' })).toBeHidden();
  await expect(page.getByText('本房间累计').or(page.locator('[class*=board]'))).toBeVisible();
});

test('房主关掉页面，另一个人接手继续打', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const friendCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const friend = await friendCtx.newPage();

  // 每个邮箱 60 秒才能重发一次验证码，所以这里用另一个管理员
  await login(host, 'admin2@e2e.test');
  const add = await host.request.post('/api/admin/whitelist', { data: { email: 'friend@e2e.test', remark: 'e2e' } });
  expect(add.ok()).toBe(true);
  await login(friend, 'friend@e2e.test');

  await host.getByRole('button', { name: '建房' }).click();
  await expect(host).toHaveURL(/\/room\/[a-z0-9]{6}$/);
  const url = host.url();
  await friend.goto(url);
  await expect(friend.getByText('等房主开始')).toBeVisible();
  await host.getByRole('button', { name: '开始' }).click();
  await expect(friend.getByText('农民').or(friend.getByText('叫分')).first()).toBeVisible();

  await host.close();
  // 15 秒宽限后换房主
  await expect(friend.getByText(/房主 friend（你）/)).toBeVisible({ timeout: 25_000 });
  // 旧房主的座位被托管，新房主接着打完
  await playUntilEnd(friend);
  await expect(friend.getByRole('button', { name: '再来一局' })).toBeVisible();
  await hostCtx.close();
  await friendCtx.close();
});
