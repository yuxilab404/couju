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

/**
 * 一次拖选的状态机（不碰 DOM）。Hand 把指针事件翻译成这里的调用。
 * 手牌在拖动中变了（比如当上地主、底牌加进来重排）就作废这次拖选：
 * 指针下的位置已经对不上按下时的那一排牌了。
 */
export class DragController {
  private drag: { anchor: number; current: number; ids: string[]; key: string; base: ReadonlySet<string> } | null = null;

  get active(): boolean {
    return this.drag !== null;
  }

  /** 按下第 index 张；返回预览 */
  down(ids: readonly string[], base: ReadonlySet<string>, index: number): Set<string> {
    this.drag = { anchor: index, current: index, ids: [...ids], key: ids.join('\u0000'), base };
    return dragSelection(base, ids, index, index);
  }

  /** 拖到第 index 张；手牌变了返回 null（已作废），否则返回预览 */
  move(ids: readonly string[], index: number): Set<string> | null {
    const d = this.drag;
    if (!d) return null;
    if (ids.join('\u0000') !== d.key) {
      this.drag = null;
      return null;
    }
    d.current = Math.max(0, Math.min(index, d.ids.length - 1));
    return dragSelection(d.base, d.ids, d.anchor, d.current);
  }

  /** 松手；手牌变了或没在拖返回 null，否则返回最终选择 */
  up(ids: readonly string[]): Set<string> | null {
    const d = this.drag;
    this.drag = null;
    if (!d || ids.join('\u0000') !== d.key) return null;
    return dragSelection(d.base, d.ids, d.anchor, d.current);
  }

  cancel(): void {
    this.drag = null;
  }
}
