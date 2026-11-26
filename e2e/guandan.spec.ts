import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('./');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByLabel('验证码')).toBeVisible();
  const { code } = await (await page.request.get(`api/dev/last-code?email=${encodeURIComponent(email)}`)).json();
  await page.getByLabel('验证码').fill(code);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开一桌' })).toBeVisible();
}

test('掼蛋：一个人 + 三个机器人打完一副', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, 'admin4@e2e.test');
  await page.getByRole('button', { name: '建房' }).click();
  await page.getByLabel('游戏').selectOption({ label: '掼蛋' });
  await page.getByLabel('打多久').selectOption({ label: '只打一副' });
  // 固定 4 人，对家一队
  await expect(page.locator('.seats > *')).toHaveCount(4);
  await expect(page.getByLabel('人数')).toHaveCount(0);
  await expect(page.locator('.seat-no').nth(2)).toContainText('队伍 1');
  await expect(page.locator('.seat-no').nth(3)).toContainText('队伍 2');
  await page.getByRole('button', { name: '开始' }).click();

  await expect(page.locator('[data-card][aria-pressed]')).toHaveCount(27);
  await expect(page.locator('[data-level]')).toHaveText('打 2');
  // 红桃 2 是配牌，手里有的话牌上标着
  const wilds = await page.locator('[data-card^="H02"]').count();
  await expect(page.locator('[data-card] [data-badge="配"]')).toHaveCount(wilds);

  const result = page.getByRole('heading', { name: '本局结束' });
  const play = page.getByRole('button', { name: '出牌' });
  let played = 0;
  for (let i = 0; i < 600 && !(await result.isVisible()); i++) {
    if (await play.isVisible()) {
      const hint = page.getByRole('button', { name: '提示' });
      if (await hint.isEnabled()) {
        await hint.click();
        await play.click();
        played++;
      } else await page.getByRole('button', { name: '不出' }).click();
    }
    await page.waitForTimeout(250);
  }
  await expect(result).toBeVisible();
  test.info().annotations.push({ type: '本局操作', description: `出牌 ${played} 次` });
  expect(played).toBeGreaterThan(0);
  // 一副结束：名次和升级
  await expect(page.locator('[data-hand-result]')).toContainText('头游');
  await expect(page.locator('[data-hand-result]')).toContainText(/升 [123] 级/);
  await expect(page.getByRole('dialog', { name: '本局结束' })).toContainText(/获胜/);
});
