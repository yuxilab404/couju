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

test('吹牛轮盘：一个人 + 三个机器人打到只剩一个活人', async ({ page }) => {
  await login(page, 'admin3@e2e.test');
  await page.getByRole('button', { name: '建房' }).click();
  await page.getByLabel('游戏').selectOption({ label: '吹牛轮盘' });
  await page.getByLabel('人数').selectOption('4');
  await expect(page.locator('.seats > *')).toHaveCount(4);
  await page.getByRole('button', { name: '开始' }).click();

  await expect(page.locator('[data-card][aria-pressed]')).toHaveCount(5);
  await expect(page.locator('[data-table]')).toHaveText(/^[KQA]$/);

  const result = page.getByRole('heading', { name: '本局结束' });
  let played = 0;
  let called = 0;
  const liar = page.getByRole('button', { name: '骗子！' });
  const primary = page.getByRole('button', { name: /张出|^出 \d 张/ });
  const pressed = page.locator('[data-card][aria-pressed="true"]');
  for (let i = 0; i < 600 && !(await result.isVisible()); i++) {
    const canLiar = await liar.isVisible();
    const canPlay = await primary.isVisible();
    if (canLiar && (!canPlay || called < played)) {
      await liar.click();
      called++;
    } else if (canPlay) {
      if ((await pressed.count()) === 0) await page.locator('[data-card][aria-pressed]').first().click({ position: { x: 6, y: 20 } });
      await expect(pressed).toHaveCount(1);
      await page.getByRole('button', { name: /^出 1 张/ }).click();
      played++;
    }
    await page.waitForTimeout(250);
  }
  await expect(result).toBeVisible();
  test.info().annotations.push({ type: '本局操作', description: `出牌 ${played} 次，喊骗子 ${called} 次` });
  // 翻过牌、有人出局
  await expect(page.locator('[data-showdown]')).toBeVisible();
  await expect(page.getByText('出局').first()).toBeVisible();
});
