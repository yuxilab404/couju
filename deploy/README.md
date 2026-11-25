# 部署与运维（miao）

决策见 [ADR-0005](../docs/adr/0005-deployment.md)。这里是"现在是什么样、怎么操作"。

## 现状

| 项 | 位置 |
|---|---|
| 访问地址 | https://game.zyzl.link （Caddy 反代到 `127.0.0.1:8790`） |
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
   - 服务端变了：构建镜像；等到没有在线房间（最多 30 分钟，等不到就放弃，下一轮再试）；备份；换前端；起新容器；20 秒内健康检查不过就回滚到旧镜像。

不需要任何部署密钥：仓库公开，Release 用 Actions 自带的 `GITHUB_TOKEN` 发布，miao 匿名下载。

## 常用操作

```bash
# 看状态
docker ps -f name=couju; curl -s 127.0.0.1:8790/api/health; cat /var/lib/couju/deployed
journalctl -u couju-deploy --since today    # 自动部署日志
docker logs --tail 100 couju                # 服务日志

# 有人在玩也要立刻上线
curl -fsSL -o /tmp/c.tgz https://github.com/yuxilab404/couju/releases/download/deploy/couju.tar.gz
tar xzf /tmp/c.tgz -C /tmp couju/miao-deploy.sh && bash /tmp/couju/miao-deploy.sh /tmp/c.tgz --force

# 回滚服务端到上一个镜像
docker images couju                          # 找旧标签
docker rm -f couju && docker run ...         # 参数见 miao-deploy.sh 的 run_container

# 回滚前端
ln -sfn releases/<旧构建号> /var/lib/couju/web/.t && mv -Tf /var/lib/couju/web/.t /var/lib/couju/web/current

# 恢复数据库
docker stop couju && cp /var/lib/couju/backups/<文件> /var/lib/couju/data/couju.db && rm -f /var/lib/couju/data/couju.db-{wal,shm} && docker start couju
```

## 配置项（`/var/lib/couju/env`）

| 变量 | 说明 |
|---|---|
| `COUJU_BASE_URL` | `https://game.zyzl.link`，用于邀请邮件和 cookie 的 Secure |
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
# Caddyfile 追加：game.zyzl.link { reverse_proxy 127.0.0.1:8790 }，caddy validate 后 reload
```
