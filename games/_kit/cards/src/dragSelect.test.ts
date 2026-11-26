import { describe, expect, it } from 'vitest';
import { dragSelection, indexAtX } from './dragSelect.ts';

const ids = ['a', 'b', 'c', 'd', 'e'];
const sorted = (s: Set<string>) => [...s].sort();

describe('dragSelection', () => {
  it('单击：切换一张', () => {
    expect(sorted(dragSelection(new Set(), ids, 2, 2))).toEqual(['c']);
    expect(sorted(dragSelection(new Set(['c']), ids, 2, 2))).toEqual([]);
  });

  it('从没选中的牌拖：整段选上，原来选中的保持选中', () => {
    expect(sorted(dragSelection(new Set(['e']), ids, 1, 3))).toEqual(['b', 'c', 'd', 'e']);
  });

  it('从选中的牌拖：整段取消，段外的不动', () => {
    expect(sorted(dragSelection(new Set(['a', 'b', 'c', 'd']), ids, 1, 2))).toEqual(['a', 'd']);
  });

  it('往左拖也一样', () => {
    expect(sorted(dragSelection(new Set(), ids, 3, 0))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('不改入参', () => {
    const base = new Set(['a']);
    dragSelection(base, ids, 0, 4);
    expect(sorted(base)).toEqual(['a']);
  });
});

describe('indexAtX', () => {
  // 重叠排列：每张牌左边缘相隔 20px，宽 60px
  const lefts = [0, 20, 40, 60, 80];
  it('取左边缘在 x 左侧的最后一张（盖在最上面的那张）', () => {
    expect(indexAtX(lefts, 25)).toBe(1);
    expect(indexAtX(lefts, 100)).toBe(4);
    expect(indexAtX(lefts, 139)).toBe(4);
  });
  it('拖出最左边算第一张', () => {
    expect(indexAtX(lefts, -30)).toBe(0);
  });
});
