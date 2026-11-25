#!/usr/bin/env bash
# 装在 miao 的 /usr/local/bin/couju-poll，由 systemd 定时器每 2 分钟跑一次。
# 检查 GitHub 上 deploy 这个 Release 的 BUILD_ID，有新版本就下载、校验、部署。
# 不需要任何密钥：仓库公开，CI 用自带的 GITHUB_TOKEN 发布。
set -euo pipefail

ROOT=${COUJU_ROOT:-/var/lib/couju}
BASE=https://github.com/yuxilab404/couju/releases/download/deploy

latest=$(curl -fsSL --max-time 20 "$BASE/BUILD_ID" 2>/dev/null | tr -d '[:space:]') || exit 0
[ -n "$latest" ] || exit 0
[ "$latest" = "$(cat "$ROOT/deployed" 2>/dev/null)" ] && exit 0

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# GitHub 的文件下载地址从国内时通时断（docs/pitfalls.md #3）：短连接超时 + 多次重试
# （miao 是 Ubuntu 20.04，curl 7.68 没有 --retry-all-errors，用循环重试）
dl() {
  for _ in 1 2 3 4 5; do
    curl -fsSL --connect-timeout 15 --max-time 90 -o "$1" "$2" && return 0
    sleep 5
  done
  return 1
}
dl "$tmp/couju.tar.gz" "$BASE/couju.tar.gz"
dl "$tmp/couju.tar.gz.sha256" "$BASE/couju.tar.gz.sha256"
(cd "$tmp" && sha256sum -c couju.tar.gz.sha256 >/dev/null) || { echo "[couju-poll] 校验失败"; exit 1; }
tar xzf "$tmp/couju.tar.gz" -C "$tmp" couju/BUILD_ID couju/miao-deploy.sh
[ "$(cat "$tmp/couju/BUILD_ID")" = "$latest" ] || { echo "[couju-poll] 包里的版本和 BUILD_ID 不一致，跳过"; exit 0; }
echo "[couju-poll] 发现新版本 $latest"
bash "$tmp/couju/miao-deploy.sh" "$tmp/couju.tar.gz"
