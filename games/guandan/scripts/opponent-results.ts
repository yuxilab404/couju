/** 比较两份同牌换座的 JSONL，可先把同一版本的分片拼成一个文件。 */
import { readFileSync } from 'node:fs';

interface Result { seed: number; ourTeam: number; level: number; win: boolean; net: number }
function readPairs(path: string) {
  const pairs = new Map<number, Result[]>();
  for (const line of readFileSync(path, 'utf8').trim().split(/\r?\n/)) {
    const row: Result = JSON.parse(line);
    if (!Number.isSafeInteger(row.seed) || ![0, 1].includes(row.ourTeam) ||
        !Number.isInteger(row.level) || row.level < 2 || row.level > 14 ||
        ![1, 2, 3].includes(Math.abs(row.net)) || row.win !== (row.net > 0)) {
      throw new Error('回放的种子、座次、级牌或得分无效');
    }
    const pair = pairs.get(row.seed) ?? [];
    if (pair[row.ourTeam]) throw new Error('重复的种子和座次');
    pair[row.ourTeam] = row;
    pairs.set(row.seed, pair);
  }
  for (const [seed, pair] of pairs) {
    if (!pair[0] || !pair[1] || pair[0].level !== pair[1].level) throw new Error('未完成同级换座：' + seed);
  }
  return pairs;
}
function interval(values: number[]) {
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  if (values.length === 1) return { mean };
  const error = 1.96 * Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1) / values.length);
  return { mean, low: mean - error, high: mean + error };
}
if (!process.argv[2]) throw new Error('用法：opponent-results.ts <本版回放.jsonl> [旧版同种子回放.jsonl]');
const current = readPairs(process.argv[2]), previous = process.argv[3] ? readPairs(process.argv[3]) : null;
if (previous && previous.size !== current.size) throw new Error('两版种子数不同');
const wins: number[] = [], net: number[] = [], winChange: number[] = [], netChange: number[] = [];
for (const [seed, rows] of current) {
  const w = (+rows[0].win + +rows[1].win) / 2, n = (rows[0].net + rows[1].net) / 2;
  wins.push(w); net.push(n);
  if (previous) {
    const other = previous.get(seed);
    if (!other || rows[0].level !== other[0].level) throw new Error('两版的种子或级牌不同：' + seed);
    winChange.push(w - (+other[0].win + +other[1].win) / 2);
    netChange.push(n - (other[0].net + other[1].net) / 2);
  }
}
console.log(JSON.stringify({
  games: 2 * wins.length, wins: 2 * wins.reduce((s, w) => s + w, 0), winRate: interval(wins), net: interval(net),
  ...(previous ? { winChange: interval(winChange), netChange: interval(netChange) } : {}),
}, null, 2));
