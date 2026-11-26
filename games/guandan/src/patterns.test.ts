import { describe, expect, it } from 'vitest';
import { beats, interpret, parse, type Pattern } from './patterns.ts';
import { hand } from './testhand.ts';

const kinds = (spec: string, level = 2) => parse(hand(spec), level).map((p) => `${p.kind}:${p.main}`).sort();

describe('牌型', () => {
  it('普通牌型', () => {
    expect(kinds('7')).toEqual(['single:7']);
    expect(kinds('7 7')).toEqual(['pair:7']);
    expect(kinds('sj sj')).toEqual(['pair:16']);
    expect(kinds('sj bj')).toEqual([]);
    expect(kinds('7 7 7')).toEqual(['triple:7']);
    expect(kinds('7 7 7 9 9')).toEqual(['fullHouse:7']);
    expect(kinds('7 7 7 bj bj')).toEqual(['fullHouse:7']);
    expect(kinds('3 4 5 6 7')).toEqual(['straight:7']);
    expect(kinds('10 J Q K A')).toEqual(['straight:14']);
    expect(kinds('A 2 3 4 5')).toEqual(['straight:5']);
    expect(kinds('K A 2 3 4')).toEqual([]);
    expect(kinds('A A 2 2 3 3')).toEqual(['tube:3']);
    expect(kinds('Q Q K K A A')).toEqual(['tube:14']);
    expect(kinds('A A A 2 2 2')).toEqual(['plate:2']);
    expect(kinds('K K K A A A')).toEqual(['plate:14']);
    expect(kinds('3 4 5 6 7 8')).toEqual([]);
  });

  it('炸弹', () => {
    expect(kinds('9 9 9 9')).toEqual(['bomb:9']);
    expect(kinds('9 9 9 9 9 9 9 9')).toEqual(['bomb:9']);
    expect(kinds('sj sj bj bj')).toEqual(['jokerBomb:17']);
    expect(kinds('h3 h4 h5 h6 h7')).toEqual(['straight:7', 'straightFlush:7']);
  });

  it('级牌在单张里比 A 大，在顺子里回到原位', () => {
    expect(kinds('5', 5)).toEqual(['single:15']);
    expect(kinds('3 4 5 6 7', 5)).toEqual(['straight:7']);
    const a = interpret(hand('5'), 5, null)!;
    const ace = interpret(hand('A'), 5, null)!;
    expect(beats(a, ace)).toBe(true);
  });

  it('红桃级牌是配牌', () => {
    // 级牌 2：红桃 2 能配
    expect(kinds('h2 7')).toEqual(['pair:7']);
    expect(kinds('h2')).toEqual(['single:15']);
    expect(kinds('h2 h2')).toEqual(['pair:15']);
    expect(kinds('h2 sj')).toEqual([]); // 不能配王
    expect(kinds('h2 3 4 5 7')).toEqual(['straight:7']);
    expect(kinds('h2 h2 4 5 6')).toEqual(['straight:6', 'straight:7', 'straight:8']);
    expect(kinds('h2 9 9 9')).toEqual(['bomb:9']);
    expect(kinds('h2 3 3 4 4 5')).toEqual(['tube:5']);
    // 5 张：五张炸弹或三带二
    expect(kinds('h2 h2 8 8 8')).toEqual(['bomb:8', 'fullHouse:8']);
    expect(kinds('h2 8 8 9 9')).toEqual(['fullHouse:8', 'fullHouse:9']);
    // 同花顺：配牌当任何花色
    expect(kinds('h2 c3 c4 c5 c6')).toEqual(['straight:6', 'straight:7', 'straightFlush:6', 'straightFlush:7']);
  });

  it('选解释：领出取最强，跟牌优先同牌型', () => {
    expect(interpret(hand('h2 h2 8 8 8'), 2, null)!.kind).toBe('bomb');
    const fh: Pattern = { kind: 'fullHouse', main: 6, size: 5 };
    expect(interpret(hand('h2 h2 8 8 8'), 2, fh)!.kind).toBe('fullHouse');
    expect(interpret(hand('h2 h2 8 8 8'), 2, null, { kind: 'fullHouse', main: 8 })!.kind).toBe('fullHouse');
    expect(interpret(hand('h2 h2 8 8 8'), 2, null, { kind: 'straight', main: 8 })).toBeNull();
  });
});

describe('比大小', () => {
  const p = (spec: string, level = 2) => interpret(hand(spec), level, null)!;
  it('同牌型比点数，不同牌型不能管', () => {
    expect(beats(p('8'), p('7'))).toBe(true);
    expect(beats(p('7 7'), p('8'))).toBe(false);
    expect(beats(p('4 5 6 7 8'), p('3 4 5 6 7'))).toBe(true);
    expect(beats(p('2 3 4 5 6'), p('A 2 3 4 5'))).toBe(true);
    expect(beats(p('bj'), p('sj'))).toBe(true);
  });
  it('炸弹顺序：4 张 < 5 张 < 同花顺 < 6 张 < 天王炸', () => {
    const four = p('A A A A'), five = p('3 3 3 3 3'), sf = p('h3 h4 h5 h6 h7');
    const six = p('3 3 3 3 3 3'), king = p('sj sj bj bj');
    expect(beats(five, four)).toBe(true);
    expect(beats(sf, five)).toBe(true);
    expect(beats(six, sf)).toBe(true);
    expect(beats(king, six)).toBe(true);
    expect(beats(four, p('bj'))).toBe(true);
    expect(beats(p('h8 h9 h10 hJ hQ'), sf)).toBe(true);
  });
});
