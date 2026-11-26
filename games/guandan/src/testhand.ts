/** 测试用：用简写拼一手牌 */
/**
 * 简写：'h5'/'c5'/'d5' 指定花色，'sj'/'bj' = 小王/大王；不写花色时按点数在黑桃、梅花、方块里轮着给，
 * 同一张写在哪手里都一样，也不会凑成同花顺。
 */
export function hand(spec: string): string[] {
  const used = new Map<string, number>();
  const perRank = new Map<number, number>();
  return spec.split(' ').map((t) => {
    let id: string;
    if (t === 'sj') id = 'J16';
    else if (t === 'bj') id = 'J17';
    else {
      const r = t.replace(/^[hcd]/, '');
      const rank = { J: 11, Q: 12, K: 13, A: 14 }[r] ?? Number(r);
      const k = perRank.get(rank) ?? 0;
      perRank.set(rank, k + 1);
      const suit = /^[hcd]/.test(t) ? t[0].toUpperCase() : 'SCD'[(rank + k) % 3];
      id = `${suit}${String(rank).padStart(2, '0')}`;
    }
    const k = used.get(id) ?? 0;
    used.set(id, k + 1);
    return id + (k === 0 ? 'a' : 'b');
  });
}
