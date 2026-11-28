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

test('炸金花：一个人 + 三个机器人，闷跟、看牌、比牌打完一局，结束后亮牌', async ({ page }) => {
  await login(page, 'admin6@e2e.test');
  await page.getByRole('button', { name: '建房' }).click();
  await page.getByLabel('游戏').selectOption({ label: '炸金花' });
  await page.getByLabel('人数').selectOption('4');
  await expect(page.locator('.seats > *')).toHaveCount(4);
  await page.getByRole('button', { name: '开始' }).click();

  await expect(page.locator('[data-pot]')).toBeVisible();
  // 闷着的时候看不到自己的牌
  await expect(page.locator('[data-myhand] [data-card]')).toHaveCount(0);

  const result = page.getByRole('heading', { name: '本局结束' });
  const look = page.getByRole('button', { name: '看牌', exact: true });
  const call = page.getByRole('button', { name: /^(闷跟|跟注) \d+$/ });
  const compare = page.getByRole('button', { name: '比牌', exact: true });
  let calls = 0;
  let looked = false;
  let compared = false;
  // 按时间兜底：bot 有思考延迟、比牌要停 2 秒多（ADR-0008）
  const until = Date.now() + 240_000;
  while (Date.now() < until && !(await result.isVisible())) {
    if (await call.isVisible()) {
      if (calls === 0) {
        await call.click();
        calls++;
      } else if (!looked && (await look.isVisible()) && (await look.isEnabled())) {
        await look.click();
        await expect(page.locator('[data-myhand] [data-card]')).toHaveCount(3);
        looked = true;
      } else if (await compare.isEnabled()) {
        await compare.click();
        await page.getByRole('button', { name: /比（下 \d+）$/ }).first().click();
        compared = true;
      } else {
        await call.click();
        calls++;
      }
    }
    await page.waitForTimeout(250);
  }
  await expect(result).toBeVisible();
  test.info().annotations.push({ type: '本局操作', description: `跟注 ${calls} 次，${looked ? '看了牌' : '没看牌'}，${compared ? '比了牌' : '没比牌'}` });
  // 结束后所有人亮牌：每个座位 3 张
  await expect(page.locator('[data-myhand] [data-card]')).toHaveCount(3);
  await expect(page.locator('[data-seat] [data-card]')).toHaveCount(9);
});
