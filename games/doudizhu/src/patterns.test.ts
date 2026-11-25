import { describe, expect, it } from 'vitest';
import { beats, interpret, parse, type Kind } from './patterns.ts';

const R: Record<string, number> = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14, '2': 15, x: 16, X: 17 };
const r = (s: string) => [...s].map((ch) => R[ch]);
const kinds = (s: string) => parse(r(s)).map((p) => p.kind).sort();
const one = (s: string, prev: string | null = null) => interpret(r(s), prev ? interpret(r(prev), null) : null);

describe('牌型识别', () => {
  const cases: [string, Kind][] = [
    ['3', 'single'], ['X', 'single'], ['33', 'pair'], ['xX', 'rocket'], ['333', 'triple'],
    ['3334', 'triple1'], ['33344', 'triple2'], ['34567', 'straight'], ['TJQKA', 'straight'],
    ['334455', 'pairs'], ['333444', 'plane'], ['33344456', 'plane1'], ['3334445566', 'plane2'],
    ['333345', 'four2'], ['33334455', 'four22'], ['3333', 'bomb'], ['2222', 'bomb'],
    ['3456789TJQKA', 'straight'],
  ];
  for (const [s, k] of cases) it(`${s} → ${k}`, () => expect(kinds(s)).toContain(k));

  for (const s of ['34', '3344', 'JQKA2', '3456', '3x', 'KKKAAA222', '333555', '3333xX', '333444xX', '333456']) {
    it(`${s} 不合法`, () => expect(parse(r(s))).toEqual([]));
  }

  it('四带二不能带大小王', () => expect(kinds('3333xX')).toEqual([]));
  it('三带一 2', () => expect(kinds('2223')).toEqual(['triple1']));
});

describe('歧义飞机', () => {
  it('333444555666 同时是 4 连飞机和 3 连带单', () => {
    expect(kinds('333444555666')).toEqual(['plane', 'plane1', 'plane1']);
  });
  it('领出时按纯飞机理解', () => expect(one('333444555666')?.kind).toBe('plane'));
  it('跟 3 连带单时按带单理解', () => {
    // 777888999 带 345：主值 9，而 333444555666 当带单最大主值 6，管不上
    expect(one('333444555666', '777888999345')).toBeNull();
    const q = one('888999TTTJJJ', '444555666789');
    expect(q?.kind).toBe('plane1');
  });
  it('跟 4 连飞机', () => expect(one('444555666777', '333444555666')?.kind).toBe('plane'));
});

describe('比较', () => {
  const b = (a: string, prev: string) => one(a, prev) !== null;
  it('同牌型比大小', () => {
    expect(b('4', '3')).toBe(true);
    expect(b('3', '4')).toBe(false);
    expect(b('X', 'x')).toBe(true);
    expect(b('2', 'A')).toBe(true);
  });
  it('张数不同不能比', () => expect(b('456789', '34567')).toBe(false));
  it('牌型不同不能比', () => expect(b('44', '3')).toBe(false));
  it('炸弹压一切非炸弹', () => expect(b('3333', '22')).toBe(true));
  it('大炸压小炸', () => {
    expect(b('4444', '3333')).toBe(true);
    expect(b('3333', '4444')).toBe(false);
  });
  it('王炸最大', () => {
    expect(b('xX', '2222')).toBe(true);
    expect(b('2222', 'xX')).toBe(false);
  });
  it('四带二不是炸弹', () => expect(b('333345', '22')).toBe(false));
  it('beats 直接比较', () => {
    const p = interpret(r('34567'), null)!;
    const q = interpret(r('45678'), null)!;
    expect(beats(q, p)).toBe(true);
  });
});
