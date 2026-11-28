#!/bin/sh
# 掼蛋 bot 对打评测：当前工作区的 bot 对某个 git 版本的 bot，4 个进程并行。
#   games/guandan/scripts/arena.sh [旧版 git ref，默认 origin/main] [副数，默认 2000]
# 输出新 bot 每副的胜率和平均净升级数（±标准误）。改 bot 前后各跑一次，净升级显著大于 0 才算变强。
set -e
REF=${1:-origin/main}; N=${2:-2000}; K=4; per=$((N / K))
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
old="$here/../.baseline/src"
rm -rf "$here/../.baseline" && mkdir -p "$old"
git -C "$root" archive "$REF" games/guandan/src | tar -x -C "$old" --strip-components=3
for i in $(seq 0 $((K - 1))); do
  node --experimental-strip-types --no-warnings "$here/arena.ts" "$old" $per $((1000 + i * per)) &
done | node -e '
let t={hands:0,wins:0,pts:0,sq:0,pairs:0,slow:0},maxMs=0;
require("readline").createInterface({input:process.stdin}).on("line",l=>{const o=JSON.parse(l);for(const k in t)t[k]+=o[k];maxMs=Math.max(maxMs,o.maxMs)}).on("close",()=>{
const m=t.pts/t.pairs, se=Math.sqrt((t.sq/t.pairs-m*m)/t.pairs)/2;
console.log(`副数=${t.hands} 新bot胜率=${(t.wins/t.hands*100).toFixed(1)}% 每副净升级=${(m/2).toFixed(3)}±${se.toFixed(3)} 新bot最慢一步=${maxMs.toFixed(0)}ms 超过100ms=${t.slow}步`)})'
rm -rf "$here/../.baseline"
