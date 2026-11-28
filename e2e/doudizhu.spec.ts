import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('./');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByLabel('验证码')).toBeVisible();
  const { code } = await (await page.request.get(`api/dev/last-code?email=${encodeURIComponent(email)}`)).json();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('验证码').fill(code);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开一桌' })).toBeVisible();
}

let passedWithSelection = false;

/** 轮到自己就操作：叫分阶段叫 3 分或不叫；出牌阶段按提示出，提示不了就（选一张后）不要 */
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
        // 先选一张牌再点"不要"：选着的牌要落回去
        await page.locator('[data-card][aria-pressed]').first().click({ position: { x: 6, y: 20 } });
        await expect(page.locator('[data-card][aria-pressed="true"]')).toHaveCount(1);
        await page.getByRole('button', { name: '不要' }).click();
        await expect(page.locator('[data-card][aria-pressed="true"]')).toHaveCount(0);
        passedWithSelection = true;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error('没有打完');
}

test('一个人 + 两个机器人打完一局斗地主，再来一局', async ({ page }) => {
  await login(page, 'admin@e2e.test');
  await page.getByRole('button', { name: '建房' }).click();
  await expect(page).toHaveURL(/\/game\/room\/[a-z0-9]{6}$/);
  await expect(page.getByText('空位会自动放机器人')).toBeVisible();
  // 没有队伍的游戏开局随机排座，不提供换座
  await expect(page.getByText('每局开局时随机排座')).toBeVisible();
  await expect(page.getByRole('button', { name: '换座' })).toHaveCount(0);
  await page.getByRole('button', { name: '开始' }).click();

  // 拖拽批量选牌：按住左键从第 1 张拖到第 4 张，松开后这 4 张都选上；再从选中的牌拖回来就取消
  const hand = page.locator('[data-card][aria-pressed]');
  await expect(hand).toHaveCount(17);
  const box = async (i: number) => (await hand.nth(i).boundingBox())!;
  const drag = async (from: number, to: number) => {
    const a = await box(from), b = await box(to);
    await page.mouse.move(a.x + 6, a.y + a.height * 0.7);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2 + 6, b.y + b.height * 0.7, { steps: 4 });
    await page.mouse.move(b.x + 6, b.y + b.height * 0.7, { steps: 4 });
    await page.mouse.up();
  };
  const pressed = () => page.locator('[data-card][aria-pressed="true"]');
  await drag(0, 3);
  await expect(pressed()).toHaveCount(4);
  await drag(2, 1); // 从选中的第 3 张往左拖：第 2、3 张取消，剩第 1、4 张
  await expect(pressed()).toHaveCount(2);
  await drag(1, 2); // 从没选中的第 2 张拖：第 2、3 张选回来
  await expect(pressed()).toHaveCount(4);
  await drag(3, 0); // 从选中的第 4 张拖回最左：全部取消
  await expect(pressed()).toHaveCount(0);
  // 单击仍是切换一张
  await hand.nth(5).click({ position: { x: 6, y: 20 } });
  await expect(pressed()).toHaveCount(1);
  await hand.nth(5).click({ position: { x: 6, y: 20 } });
  await expect(pressed()).toHaveCount(0);
  // 键盘：Tab 到牌上按空格/回车切换（读屏工具的点击走同一条路）
  await hand.nth(2).focus();
  await page.keyboard.press(' ');
  await expect(hand.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(pressed()).toHaveCount(0);

  // 记牌器：开局时别人手里一共 34 张 + 3 张没翻开的底牌 = 37；能收起、展开
  const counter = page.getByLabel('记牌器');
  await expect(counter).toBeVisible();
  const total = async () =>
    (await counter.locator('[data-rank]').allInnerTexts()).reduce((n, t) => n + Number(t.replace(/\D+/g, ' ').trim().split(' ').pop()), 0);
  if (await page.getByRole('button', { name: '3 分' }).isVisible()) expect(await total()).toBe(37);
  await counter.getByRole('button', { name: /记牌器/ }).click();
  await expect(counter.locator('[data-rank]')).toHaveCount(0);
  await counter.getByRole('button', { name: /记牌器/ }).click();
  await expect(counter.locator('[data-rank]')).toHaveCount(15);

  await playUntilEnd(page);
  await expect(page.locator('.result')).toContainText(/地主|农民/);
  test.info().annotations.push({ type: '选牌后不要', description: passedWithSelection ? '本局走到了' : '本局没轮到' });
  // 两个对手剩下的牌摊在牌桌上
  await expect(page.locator('[data-leftover]')).toHaveCount(2);
  // 只有一个真人：不计账号积分
  await expect(page.locator('.result')).toContainText('本局不计积分');
  // 结算弹窗按住标题能拖走，不挡牌桌
  const dialog = page.getByRole('dialog', { name: '本局结束' });
  // 弹窗有 0.35 秒的上浮入场动画，没放完就量位置会少算几像素
  await page.locator('.result-overlay').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const before = (await dialog.boundingBox())!;
  const title = (await page.getByRole('heading', { name: '本局结束' }).boundingBox())!;
  await page.mouse.move(title.x + 20, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + 20 + 200, title.y + title.height / 2 + 150, { steps: 5 });
  await page.mouse.up();
  const after = (await dialog.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(200);
  expect(Math.round(after.y - before.y)).toBe(150);
  // 往上拖过头：标题停在顶部导航栏下面，还能按住再拖回来
  const heading = page.getByRole('heading', { name: '本局结束' });
  const t2 = (await heading.boundingBox())!;
  await page.mouse.move(t2.x + 20, t2.y + t2.height / 2);
  await page.mouse.down();
  await page.mouse.move(t2.x + 20, t2.y - 2000, { steps: 5 });
  await page.mouse.up();
  const bar = (await page.locator('.topbar').boundingBox())!;
  const t3 = (await heading.boundingBox())!;
  expect(t3.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  await heading.click({ position: { x: 20, y: t3.height / 2 } }); // 标题没被导航栏盖住，点得到
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
  const add = await host.request.post('api/admin/whitelist', { data: { email: 'friend@e2e.test', remark: 'e2e' } });
  expect(add.ok()).toBe(true);
  await login(friend, 'friend@e2e.test');

  await host.getByRole('button', { name: '建房' }).click();
  await expect(host).toHaveURL(/\/game\/room\/[a-z0-9]{6}$/);
  const url = host.url();
  await friend.goto(url);
  await expect(friend.getByText('等房主开始')).toBeVisible();
  await host.getByRole('button', { name: '开始' }).click();
  // 开局后状态行总会显示"轮到你…"或"等待 某人"
  await expect(friend.getByText(/轮到你|等待 /).first()).toBeVisible();

  await host.close();
  // 15 秒宽限后换房主
  await expect(friend.getByText(/房主 friend（你）/)).toBeVisible({ timeout: 25_000 });
  // 旧房主的座位被托管，新房主接着打完
  await playUntilEnd(friend);
  await expect(friend.getByRole('button', { name: '再来一局' })).toBeVisible();
  // 两个真人：分在两边就记积分（托管的旧房主照样计输赢），同一边则不计
  await expect(friend.locator('.result')).toContainText(/积分 1\d{3}（[+-]\d+）|本局不计积分/);
  await hostCtx.close();
  await friendCtx.close();
});

test('非房主的人点托管：机器人替他打完，房主那边看到托管中', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const friendCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const friend = await friendCtx.newPage();
  await login(host, 'admin5@e2e.test');
  const add = await host.request.post('api/admin/whitelist', { data: { email: 'friend2@e2e.test', remark: 'e2e' } });
  expect(add.ok()).toBe(true);
  await login(friend, 'friend2@e2e.test');

  await host.getByRole('button', { name: '建房' }).click();
  await expect(host).toHaveURL(/\/game\/room\/[a-z0-9]{6}$/);
  await friend.goto(host.url());
  await expect(friend.getByText('等房主开始')).toBeVisible();
  // 等人阶段没有托管按钮
  await expect(friend.getByRole('button', { name: '托管', exact: true })).toBeHidden();
  await host.getByRole('button', { name: '开始' }).click();

  const banner = friend.getByRole('status').filter({ hasText: '托管中' });
  const hostedTag = host.getByText('托管中', { exact: true });
  await friend.getByRole('button', { name: '托管', exact: true }).click();
  await expect(banner).toBeVisible();
  await expect(hostedTag).toBeVisible();
  // 取消：两边都收回
  await banner.getByRole('button', { name: '取消托管' }).click();
  await expect(banner).toBeHidden();
  await expect(hostedTag).toBeHidden();
  // 再托管一次，之后朋友什么都不点，房主打完这一局
  await friend.getByRole('button', { name: '托管', exact: true }).click();
  await expect(banner).toBeVisible();
  await playUntilEnd(host);
  await expect(friend.getByRole('heading', { name: '本局结束' })).toBeVisible();
  // 这局结束，托管跟着结束
  await expect(banner).toBeHidden();
  await hostCtx.close();
  await friendCtx.close();
});
