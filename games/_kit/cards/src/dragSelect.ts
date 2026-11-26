/**
 * 拖拽批量选牌的纯逻辑（不碰 DOM，方便测试）。
 * 从第 anchor 张拖到第 current 张：起点原来没选中就把整段选上，原来选中就把整段取消。
 * 单击就是 anchor === current 的一段，效果等于切换一张。
 */
export function dragSelection(
  base: ReadonlySet<string>,
  ids: readonly string[],
  anchor: number,
  current: number,
): Set<string> {
  const select = !base.has(ids[anchor]);
  const [lo, hi] = anchor <= current ? [anchor, current] : [current, anchor];
  const next = new Set(base);
  for (let i = lo; i <= hi; i++) {
    if (select) next.add(ids[i]);
    else next.delete(ids[i]);
  }
  return next;
}

/**
 * 按横坐标找手指/鼠标下面是第几张牌。牌是重叠排的，后面的牌盖在前面的上面，
 * 所以取"左边缘在 x 左侧的最后一张"。不看纵坐标：拖的时候手偏上偏下都不丢。
 */
export function indexAtX(lefts: readonly number[], x: number): number {
  let idx = 0;
  for (let i = 0; i < lefts.length; i++) if (lefts[i] <= x) idx = i;
  return idx;
}
