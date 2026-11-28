/**
 * 手机端：竖屏 + 触屏把登录、大厅、建房和每个游戏的一整局走一遍，每一屏都检查有没有东西被挤出屏幕或裁掉。
 * 新游戏上线时在这里补一条（AGENTS.md「上线前必须测手机端」）。
 * 由 playwright.config.ts 的 phone-* 项目按不同机型各跑一次。
 */
import { expect, test, type Page } from '@playwright/test';

/** 横向放不下的元素：超出屏幕左右边，或者内容被裁掉/要横向滚动（文字省略号除外） */
async function expectFits(page: Page, where: string) {
  const bad = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`整页能横向滚动：${document.documentElement.scrollWidth} > ${vw}`);
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}「${(el.textContent ?? '').trim().slice(0, 12)}」`;
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -1 || r.right > vw + 1) out.push(`超出屏幕：${name(el)} ${Math.round(r.left)}~${Math.round(r.right)}`);
      const clips = st.overflowX !== 'visible';
      if (clips && st.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1)
        out.push(`内容被裁掉：${name(el)} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out.slice(0, 10);
  });
  expect(bad, `${where}：手机屏幕上放不下`).toEqual([]);
}

async function shot(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

/** 用真的触摸事件横向拖一段（Playwright 只有 tap，没有触摸拖动） */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
  for (let i = 1; i <= 6; i++) {
    const x = from.x + ((to.x - from.x) * i) / 6;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, from.y + ((to.y - from.y) * i) / 6) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function login(page: Page, email: string) {
  await page.goto('./');
  await expectFits(page, '登录页');
  await shot(page, '登录');
  await page.getByLabel('邮箱').fill(email);
  await page.getByRole('button', { name: '获取验证码' }).tap();
  await expect(page.getByLabel('验证码')).toBeVisible();
  const { code } = await (await page.request.get(`api/dev/last-code?email=${encodeURIComponent(email)}`)).json();
  await page.getByLabel('验证码').fill(code);
  await page.getByRole('button', { name: '登录', exact: true }).tap();
  await expect(page.getByRole('heading', { name: '开一桌' })).toBeVisible();
}

/** 斗地主轮到自己就点一下：叫分阶段叫 3 分或不叫；出牌阶段按提示出，提示不了就不要 */
async function tapOnce(page: Page) {
  const bid3 = page.getByRole('button', { name: '3 分' });
  const play = page.getByRole('button', { name: '出牌' });
  if (await bid3.isVisible()) {
    if (await bid3.isEnabled()) await bid3.tap();
    else await page.getByRole('button', { name: '不叫' }).tap();
  } else if (await play.isVisible()) {
    const hint = page.getByRole('button', { name: '提示' });
    if (await hint.isEnabled()) {
      await hint.tap();
      await play.tap();
    } else await page.getByRole('button', { name: '不要' }).tap();
  }
}

/** 轮到自己就点：叫分阶段叫 3 分或不叫；出牌阶段按提示出，提示不了就不要 */
async function tapUntilEnd(page: Page, maxSteps = 400) {
  const result = page.getByRole('heading', { name: '本局结束' });
  let checkedPlay = false;
  for (let i = 0; i < maxSteps; i++) {
    if (await result.isVisible()) return;
    const bid3 = page.getByRole('button', { name: '3 分' });
    const play = page.getByRole('button', { name: '出牌' });
    if (await bid3.isVisible()) {
      if (await bid3.isEnabled()) await bid3.tap();
      else await page.getByRole('button', { name: '不叫' }).tap();
    } else if (await play.isVisible()) {
      if (!checkedPlay) {
        checkedPlay = true;
        await expectFits(page, '出牌阶段');
        await shot(page, '出牌');
      }
      const hint = page.getByRole('button', { name: '提示' });
      if (await hint.isEnabled()) {
        await hint.tap();
        await play.tap();
      } else await page.getByRole('button', { name: '不要' }).tap();
    }
    await page.waitForTimeout(250);
  }
  throw new Error('没有打完');
}

test('手机竖屏用手指从登录一路打完一局斗地主', async ({ page }, info) => {
  await login(page, `${info.project.name}@e2e.test`);
  await expectFits(page, '大厅');
  await shot(page, '大厅');

  await page.getByRole('button', { name: '建房' }).tap();
  await expect(page).toHaveURL(/\/game\/room\/[a-z0-9]{6}$/);
  await expect(page.getByText('空位会自动放机器人')).toBeVisible();
  await expectFits(page, '房间');
  await shot(page, '房间');
  await page.getByRole('button', { name: '开始' }).tap();

  const hand = page.locator('[data-card][aria-pressed]');
  const pressed = page.locator('[data-card][aria-pressed="true"]');
  await expect(hand).toHaveCount(17);
  await expect(page.getByLabel('记牌器').locator('[data-rank]')).toHaveCount(15);
  await expectFits(page, '牌桌');
  await shot(page, '牌桌');

  // 手指点一张选上、再点落回
  await hand.nth(5).tap({ position: { x: 4, y: 20 } });
  await expect(pressed).toHaveCount(1);
  await hand.nth(5).tap({ position: { x: 4, y: 20 } });
  await expect(pressed).toHaveCount(0);
  // 手指横着划过第 1~4 张：一次选上 4 张；再划回来取消
  const at = async (i: number) => {
    const b = (await hand.nth(i).boundingBox())!;
    return { x: b.x + 4, y: b.y + b.height * 0.7 };
  };
  await touchDrag(page, await at(0), await at(3));
  await expect(pressed).toHaveCount(4);
  await touchDrag(page, await at(3), await at(0));
  await expect(pressed).toHaveCount(0);

  // 横过来拿手机也放得下
  const portrait = page.viewportSize()!;
  await page.setViewportSize({ width: portrait.height, height: portrait.width });
  await expectFits(page, '横屏牌桌');
  await shot(page, '横屏牌桌');
  await page.setViewportSize(portrait);

  // 手指点托管：提示条放得下，再点取消
  await page.getByRole('button', { name: '托管', exact: true }).tap();
  const banner = page.getByRole('status').filter({ hasText: '托管中' });
  await expect(banner).toBeVisible();
  await expectFits(page, '托管中');
  await shot(page, '托管中');
  await banner.getByRole('button', { name: '取消托管' }).tap();
  await expect(banner).toBeHidden();

  await tapUntilEnd(page);
  const dialog = page.getByRole('dialog', { name: '本局结束' });
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expectFits(page, '结算');
  await shot(page, '结算');
  await page.getByRole('button', { name: '再来一局' }).tap();
  await expect(page.getByRole('heading', { name: '本局结束' })).toBeHidden();
});

test('手机竖屏用手指打完一局唬牌（5 人桌）', async ({ page }, info) => {
  await login(page, `${info.project.name}-lr@e2e.test`);
  await page.getByRole('button', { name: '建房' }).tap();
  await page.getByLabel('游戏').selectOption({ label: '唬牌' });
  // 人数最多的桌：座位最挤
  await page.getByLabel('人数').selectOption('5');
  await expect(page.locator('.seats > *')).toHaveCount(5);
  await expectFits(page, '唬牌房间');
  await page.getByRole('button', { name: '开始' }).tap();

  await expect(page.locator('[data-card][aria-pressed]')).toHaveCount(5);
  await expectFits(page, '唬牌牌桌');
  await shot(page, '唬牌牌桌');

  const result = page.getByRole('heading', { name: '本局结束' });
  const liar = page.getByRole('button', { name: '骗子！' });
  const primary = page.getByRole('button', { name: /张出|^出 \d 张/ });
  const pressed = page.locator('[data-card][aria-pressed="true"]');
  let played = 0;
  let called = 0;
  let checkedPlay = false;
  // 按时间而不是按轮数兜底：bot 有思考延迟、唬牌翻牌要停 3 秒多（ADR-0008），一局的长短看运气
  const until = Date.now() + 240_000;
  for (let i = 0; Date.now() < until && !(await result.isVisible()); i++) {
    const canLiar = await liar.isVisible();
    const canPlay = await primary.isVisible();
    if (canLiar && (!canPlay || called < played)) {
      await liar.tap();
      called++;
    } else if (canPlay) {
      if ((await pressed.count()) === 0) await page.locator('[data-card][aria-pressed]').first().tap({ position: { x: 4, y: 20 } });
      await expect(pressed).toHaveCount(1);
      if (!checkedPlay) {
        checkedPlay = true;
        await expectFits(page, '唬牌出牌');
        await shot(page, '唬牌出牌');
      }
      await page.getByRole('button', { name: /^出 1 张/ }).tap();
      played++;
    }
    await page.waitForTimeout(250);
  }
  const showdowns = await page.locator('[data-showdown]').getAttribute('data-showdown').catch(() => null);
  info.annotations.push({ type: '本局', description: `翻牌 ${showdowns ?? 0} 次，出牌 ${played} 次，喊骗子 ${called} 次` });
  await expect(result).toBeVisible();
  await expect(page.getByRole('dialog', { name: '本局结束' })).toBeInViewport({ ratio: 1 });
  await expectFits(page, '唬牌结算');
  await shot(page, '唬牌结算');
});

test('手机竖屏用手指打完一副掼蛋（4 人，三个机器人）', async ({ page }, info) => {
  test.setTimeout(240_000);
  await login(page, `${info.project.name}-gd@e2e.test`);
  await page.getByRole('button', { name: '建房' }).tap();
  await page.getByLabel('游戏').selectOption({ label: '掼蛋' });
  await page.getByLabel('打多久').selectOption({ label: '只打一副' });
  await expect(page.locator('.seats > *')).toHaveCount(4);
  await expect(page.getByText('队伍 2').first()).toBeVisible();
  await expectFits(page, '掼蛋房间');
  await shot(page, '掼蛋房间');
  await page.getByRole('button', { name: '开始' }).tap();

  const hand = page.locator('[data-card][aria-pressed]');
  await expect(hand).toHaveCount(27);
  await expect(page.getByLabel('记牌器').locator('[data-rank]')).toHaveCount(15);
  await expectFits(page, '掼蛋牌桌');
  await shot(page, '掼蛋牌桌');

  // 27 张叠在竖屏里也能用手指点中、划选
  const pressed = page.locator('[data-card][aria-pressed="true"]');
  await hand.nth(26).tap({ position: { x: 4, y: 20 } });
  await expect(pressed).toHaveCount(1);
  await hand.nth(26).tap({ position: { x: 4, y: 20 } });
  await expect(pressed).toHaveCount(0);

  const result = page.getByRole('heading', { name: '本局结束' });
  const play = page.getByRole('button', { name: '出牌' });
  let checkedPlay = false;
  // 按时间而不是按轮数兜底：bot 有思考延迟、唬牌翻牌要停 3 秒多（ADR-0008），一局的长短看运气
  const until = Date.now() + 240_000;
  for (let i = 0; Date.now() < until && !(await result.isVisible()); i++) {
    if (await play.isVisible()) {
      if (!checkedPlay) {
        checkedPlay = true;
        await expectFits(page, '掼蛋出牌');
        await shot(page, '掼蛋出牌');
      }
      const hint = page.getByRole('button', { name: '提示' });
      if (await hint.isEnabled()) {
        await hint.tap();
        await play.tap();
      } else await page.getByRole('button', { name: '不出' }).tap();
    }
    await page.waitForTimeout(250);
  }
  await expect(result).toBeVisible();
  await expect(page.getByRole('dialog', { name: '本局结束' })).toBeInViewport({ ratio: 1 });
  await expectFits(page, '掼蛋结算');
  await shot(page, '掼蛋结算');
});

test('手机竖屏：三个真人打完一局斗地主，结算和资料页显示积分', async ({ page, browser }, info) => {
  const p = info.project.name;
  const others = [];
  for (let i = 0; i < 2; i++) others.push(await (await browser.newContext({ ...info.project.use })).newPage());
  const pages = [page, ...others];
  for (let i = 0; i < 3; i++) await login(pages[i], `${p}-r${i + 1}@e2e.test`);
  await page.getByRole('button', { name: '建房' }).tap();
  await expect(page).toHaveURL(/\/game\/room\/[a-z0-9]{6}$/);
  for (const o of others) await o.goto(page.url());
  await expect(page.locator('.seats > *').filter({ hasText: '1200 分' })).toHaveCount(3);
  await expectFits(page, '座位上的积分');
  await page.getByRole('button', { name: '开始' }).tap();

  const result = page.getByRole('heading', { name: '本局结束' });
  // 按时间而不是按轮数兜底：bot 有思考延迟、唬牌翻牌要停 3 秒多（ADR-0008），一局的长短看运气
  const until = Date.now() + 240_000;
  for (let i = 0; Date.now() < until && !(await result.isVisible()); i++) {
    for (const x of pages) await tapOnce(x);
    await page.waitForTimeout(150);
  }
  await expect(result).toBeVisible();
  const dialog = page.getByRole('dialog', { name: '本局结束' });
  // 三个真人必然分在两边，一定计分
  await expect(dialog).toContainText(/积分 1\d{3}（[+-]\d+）/);
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expectFits(page, '计分结算');
  await shot(page, '计分结算');

  await page.locator('.me-link').tap();
  await expect(page.getByRole('heading', { name: /^积分 1\d{3}$/ })).toBeVisible();
  await expect(page.getByText('计分 1 局')).toBeVisible();
  await expectFits(page, '资料页积分');
  await shot(page, '资料页积分');
  for (const o of others) await o.context().close();
});

