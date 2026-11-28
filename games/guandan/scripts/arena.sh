#!/bin/sh
# 掼蛋 bot 对打评测：当前工作区 bot 对某个 git 版本 bot，最多 4 个进程并行。
#   games/guandan/scripts/arena.sh [旧版 git ref] [pair数] [起始种子] [级牌 2..14]
# 默认：origin/main、2000 pairs、种子 1000、级牌 2。每个 pair 用同一副牌交换座位。
set -eu
REF=${1:-origin/main}
N=${2:-2000}
SEED=${3:-1000}
LEVEL=${4:-2}
K=4
case "$N:$SEED:$LEVEL" in *[!0-9:]*|'') echo "pair数、种子和级牌必须是非负整数" >&2; exit 2;; esac
if [ "$N" -lt 1 ] || [ "$LEVEL" -lt 2 ] || [ "$LEVEL" -gt 14 ]; then
  echo "pair数须大于 0，级牌须为 2..14" >&2; exit 2
fi
if [ "$SEED" -gt 4294967295 ] || [ "$N" -gt 4294967296 ] || [ "$SEED" -gt $((4294967295 - N + 1)) ]; then
  echo "起始种子加 pair 数必须落在 uint32 范围内" >&2; exit 2
fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
tmp=$(mktemp -d "$here/.arena.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
old="$tmp/src"
mkdir -p "$old"
git -C "$root" archive "$REF" games/guandan/src | tar -x -C "$old" --strip-components=3 --exclude='*.test.*'
out="$tmp/out"
mkdir -p "$out"
pids=""
offset=0
base=$((N / K))
extra=$((N % K))
for i in 0 1 2 3; do
  count=$base
  [ "$i" -lt "$extra" ] && count=$((count + 1))
  if [ "$count" -gt 0 ]; then
    node --experimental-strip-types --no-warnings "$here/arena.ts" "$old" "$count" "$((SEED + offset))" "$LEVEL" > "$out/$i.json" &
    pids="$pids $!"
  fi
  offset=$((offset + count))
done
# 任一分片失败（例如 bot 出了非法动作），整次评测作废，不汇总残缺结果。
failed=0
for p in $pids; do wait "$p" || failed=1; done
if [ "$failed" -ne 0 ]; then echo "评测进程失败" >&2; exit 1; fi
node -e '
const fs = require("node:fs");
const rows = process.argv.slice(1).map(file => JSON.parse(fs.readFileSync(file, "utf8")));
const sum = key => rows.reduce((n, row) => n + row[key], 0);
const pairs = sum("pairs"), hands = sum("hands");
function pairedError(total, squares, scale) {
  if (pairs === 1) return "";
  const variance = Math.max(0, (squares - total * total / pairs) / (pairs - 1));
  return "±" + (Math.sqrt(variance / pairs) / 2 * scale).toFixed(3);
}
const wins = sum("wins"), pts = sum("pts");
console.log(`级牌=${rows[0].level} 局数=${hands} 不同发牌=${pairs}（误差为配对标准误）`);
console.log(`胜率=${(100 * wins / hands).toFixed(2)}${pairedError(wins, sum("winSq"), 100)}% 每局净升级=${(pts / hands).toFixed(3)}${pairedError(pts, sum("sq"), 1)}`);
const maxWall = Math.max(...rows.map(row => row.maxMs));
console.log(`新版最慢一步=${maxWall.toFixed(1)}ms 超过100ms=${sum("slow")}步 累计进程CPU=${sum("cpuMs").toFixed(0)}ms`);
' "$out"/*.json
