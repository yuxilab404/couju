#!/usr/bin/env bash
# 在 miao 上部署一个构建包（ADR-0005）。由 couju-poll 调用，也可以手动：
#   miao-deploy.sh /path/to/couju.tar.gz [--force]
# 只改前端：换静态文件，不重启。服务端有变化：等没有在线房间再换容器，失败回滚。
set -euo pipefail

ROOT=${COUJU_ROOT:-/var/lib/couju}
TARBALL=$1
FORCE=${2:-}
WAIT_MAX=${COUJU_WAIT_MAX:-1800}

log() { echo "[couju-deploy] $*"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tar xzf "$TARBALL" -C "$work"
src="$work/couju"
sha=$(cat "$src/BUILD_ID")
mkdir -p "$ROOT/data" "$ROOT/web/releases" "$ROOT/backups"
[ -f "$ROOT/env" ] || { log "缺少 $ROOT/env"; exit 1; }

running() { docker ps -q -f 'name=^couju$' | grep -q .; }

health() {
  curl -fsS --max-time 3 http://127.0.0.1:8790/api/health 2>/dev/null
}

backup_db() {
  [ -f "$ROOT/data/couju.db" ] && running || return 0
  local name="couju-$(date +%Y%m%d-%H%M%S)-$sha.db"
  docker exec couju node --disable-warning=ExperimentalWarning -e \
    "new (require('node:sqlite').DatabaseSync)('/data/couju.db').exec(\"VACUUM INTO '/data/.backup.db'\")"
  mv "$ROOT/data/.backup.db" "$ROOT/backups/$name"
  ls -1t "$ROOT/backups"/couju-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
  log "数据库已备份 $name"
}

swap_web() {
  if [ ! -d "$ROOT/web/releases/$sha" ]; then
    cp -r "$src/web" "$ROOT/web/releases/.tmp-$sha"
    mv "$ROOT/web/releases/.tmp-$sha" "$ROOT/web/releases/$sha"
  fi
  ln -sfn "releases/$sha" "$ROOT/web/.current-tmp"
  mv -Tf "$ROOT/web/.current-tmp" "$ROOT/web/current"
  log "前端已切到 $sha"
}

run_container() {
  docker run -d --name couju --restart unless-stopped \
    --memory 256m --memory-swap 256m \
    -p 127.0.0.1:8790:8790 \
    --env-file "$ROOT/env" -e COUJU_BUILD_ID="$sha" \
    -v "$ROOT/data:/data" -v "$ROOT/web:/web:ro" \
    --log-opt max-size=10m --log-opt max-file=3 \
    "$1" >/dev/null
}

wait_healthy() {
  for _ in $(seq 1 20); do
    health >/dev/null && return 0
    sleep 1
  done
  return 1
}

new_hash=$(sha256sum "$src/server.mjs" | cut -c1-16)
cur_hash=$(docker inspect -f '{{index .Config.Labels "couju.server"}}' couju 2>/dev/null || true)

if [ "$new_hash" = "$cur_hash" ]; then
  log "服务端没变，只换前端"
  backup_db
  swap_web
else
  log "服务端有变化（${cur_hash:-无} → $new_hash），构建镜像"
  docker build -q -t "couju:$new_hash" --label "couju.server=$new_hash" -f "$src/Dockerfile" "$src" >/dev/null
  if running && [ "$FORCE" != "--force" ]; then
    waited=0
    while :; do
      active=$(health | sed -n 's/.*"activeRooms":\([0-9]*\).*/\1/p')
      [ "${active:-0}" = "0" ] && break
      if [ "$waited" -ge "$WAIT_MAX" ]; then
        log "还有 $active 个房间在玩，等了 ${WAIT_MAX}s，这次不部署，下次再试"
        exit 75
      fi
      sleep 30
      waited=$((waited + 30))
    done
  fi
  backup_db
  prev=$(docker inspect -f '{{.Config.Image}}' couju 2>/dev/null || true)
  docker rm -f couju >/dev/null 2>&1 || true
  # 先换前端再起新服务端，二者版本一致
  swap_web
  run_container "couju:$new_hash"
  if ! wait_healthy; then
    log "新版本没起来，回滚到 ${prev:-无}"
    docker logs --tail 50 couju || true
    docker rm -f couju >/dev/null 2>&1 || true
    [ -n "$prev" ] && run_container "$prev"
    exit 1
  fi
  log "新服务端已运行"
fi

echo "$sha" > "$ROOT/deployed"

# 清理：前端保留最近 5 个版本，镜像保留最近 3 个
current=$(readlink "$ROOT/web/current" | sed 's#releases/##')
# 没有可清理的东西时 grep 返回 1，pipefail 下会让整个脚本失败，所以每条都兜住
{ ls -1t "$ROOT/web/releases" | grep -v "^$current$" | tail -n +5 || true; } | while read -r d; do rm -rf "$ROOT/web/releases/$d"; done
in_use=$(docker inspect -f '{{.Config.Image}}' couju 2>/dev/null || true)
{ docker images couju --format '{{.CreatedAt}}	{{.Repository}}:{{.Tag}}' | sort -r | cut -f2 | grep -v "^$in_use$" | tail -n +3 || true; } |
  while read -r t; do docker rmi "$t" >/dev/null 2>&1 || true; done
log "完成：$sha"
