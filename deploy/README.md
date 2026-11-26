# 部署与运维（miao）

决策见 [ADR-0005](../docs/adr/0005-deployment.md)。这里是"现在是什么样、怎么操作"。

## 现状

| 项 | 位置 |
|---|---|
| 访问地址 | https://miao.zyzl.link/game/ （Caddy 在 `miao.zyzl.link` 站点里用 `@couju path /game /game/*` 反代到 `127.0.0.1:8790`） |
| 容器 | `couju`，镜像 `couju:<服务端哈希>`，`--memory 256m`，`--restart unless-stopped` |
| 数据 | `/var/lib/couju/data/couju.db`（SQLite） |
| 前端 | `/var/lib/couju/web/current` → `releases/<构建号>` |
| 配置 | `/var/lib/couju/env`（600，含 Resend key，不入库） |
| 备份 | `/var/lib/couju/backups/`，每次部署前一份，保留 10 份 |
| 当前版本 | `/var/lib/couju/deployed` |
| 自动部署 | `couju-deploy.timer` 每 2 分钟跑 `/usr/local/bin/couju-poll` |

## 发布流程

1. 合入 `main` → GitHub Actions 跑测试和端到端 → 把构建包发到名为 `deploy` 的 Release（每次覆盖）。
2. miao 上的 `couju-poll` 发现 `BUILD_ID` 变了 → 下载、校验 sha256 → 执行包里的 `miao-deploy.sh`。
3. `miao-deploy.sh`：
   - 服务端没变：备份数据库，原子切换前端软链，不重启。
   - 服务端变了：构建镜像；备份；`docker stop` 旧容器（它把房间表写进 `data/rooms-handoff.json`）；换前端；起新容器（读回房间表、删掉文件）；20 秒内健康检查不过就把前端和镜像都退回上一个版本。**不等房间清空**，有人在打牌也照常上线，大家断开 1–3 秒后自动重连、接着打（[ADR-0006](../docs/adr/0006-hot-update.md)）。
4. 已打开的页面在重连后、切回前台时、每 10 分钟拉一次 `version.json`，发现新版本就弹"刷新一下"的提醒；对局中先不弹，这局打完再弹。

不需要任何部署密钥：仓库公开，Release 用 Actions 自带的 `GITHUB_TOKEN` 发布，miao 匿名下载。

## 常用操作

```bash
# 看状态
docker ps -f name=couju; curl -s 127.0.0.1:8790/api/health; cat /var/lib/couju/deployed   # health 里 build 是服务端版本，web 是前端版本
journalctl -u couju-deploy --since today    # 自动部署日志
docker logs --tail 100 couju                # 服务日志

# 回滚服务端到上一个镜像
docker images couju                          # 找旧标签
docker stop -t 10 couju && docker rm couju && docker run ...   # 参数见 miao-deploy.sh 的 run_container；用 stop 才会写交接文件，别用 rm -f

# 回滚前端
ln -sfn releases/<旧构建号> /var/lib/couju/web/.t && mv -Tf /var/lib/couju/web/.t /var/lib/couju/web/current

# 恢复数据库
docker stop couju && cp /var/lib/couju/backups/<文件> /var/lib/couju/data/couju.db && rm -f /var/lib/couju/data/couju.db-{wal,shm} && docker start couju
```

## 数据变更记录

- 2026-11-26：从签到系统白名单（`/opt/autosign/data/app.db`）一次性导入 8 个启用的朋友邮箱（管理员已在配置里，跳过）。备注写"<名字> · 从签到系统导入"，有名字的预先建好用户、昵称就是名字。没发邀请邮件。导入前备份：`backups/couju-20261126-211145-before-import.db`。之后两边各自维护，不自动同步。

## 配置项（`/var/lib/couju/env`）

| 变量 | 说明 |
|---|---|
| `COUJU_BASE_URL` | `https://miao.zyzl.link/game`，决定站点前缀、邀请邮件里的地址、cookie 的 Path 和 Secure |
| `COUJU_ADMIN_EMAILS` | 管理员邮箱，逗号分隔 |
| `RESEND_API_KEY` | 与签到系统共用的 Resend key |
| `MAIL_FROM` | `凑局 <game@email.zyzl.link>`（Resend 已验证的域名） |

**绝不要**在线上设 `COUJU_DEV=1`：它会开放取验证码的测试接口（服务端在 https 地址下会拒绝以开发模式启动）。

## 首次安装（已做过，换机器时参考）

```bash
sudo install -d -o ubuntu -g ubuntu /var/lib/couju
# 写 /var/lib/couju/env（见上表），chmod 600
sudo install -m 755 deploy/couju-poll.sh /usr/local/bin/couju-poll
sudo install -m 644 deploy/couju-deploy.service deploy/couju-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now couju-deploy.timer
# Caddyfile 的 miao.zyzl.link 站点里、兜底的 handle 之前加：
#   @couju path /game /game/*
#   handle @couju { reverse_proxy 127.0.0.1:8790 }
# caddy validate 后 reload
```
