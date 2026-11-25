# ADR-0005 部署：miao 单容器，前端热替换

状态：已采纳（上线前需要 Owner 做的几件事见文末）· 2026-11-25

## 背景

miao（4 核 / 3.4G）是唯一生产机，和牌手容器共用，实测空闲约 2G。已有 Caddy 反代，`miao.zyzl.link` 根路径是签到系统。服务器上的东西尽量跑在容器里、每个容器设内存上限。域名、反代和机器运维归 Owner。

## 决定

1. **一个容器 `couju`**，镜像 = 官方 `node:24-alpine` + 打包好的 `server.mjs`，不装 `node_modules`。`--memory 256m --restart unless-stopped`，只监听 `127.0.0.1:8790`。预期常驻 60–100 MB。
2. **数据目录 `/var/lib/couju`** 挂进容器：`couju.db`（SQLite）、`web/`（前端静态文件）、`env`（密钥，权限 600）。
3. **前端不打进镜像。** 服务端从挂载目录读静态文件。只改前端时（加游戏、改画面），部署脚本把新文件解到 `web/releases/<sha>/`，再原子地切换 `web/current` 软链——进程不重启，进行中的房间不断。浏览器在下次刷新或换房主时拿到新版本；快照里的 `buildId` 防止新老版本混着当房主。
4. **服务端有变化时才重建镜像、重启容器。** 重启前脚本查 `/api/health` 里的活跃房间数，等到 0（最多等 30 分钟，超时就放弃这次部署，下次再来；`--force` 可强制）。保留上一个镜像标签，回滚 = 用旧标签起容器。
5. **CI**：GitHub Actions 在 `main` 合入后跑测试 → 构建 → 通过 SSH 把产物（几 MB 的 tar）传到 miao → 执行 `deploy/miao-deploy.sh`。脚本在 miao 上 `docker build`（只是在已有的 node 镜像上加一个文件，很快）。不经镜像仓库，避免从国内拉 ghcr 慢或拉不到。
6. **备份**：部署脚本每次先用 SQLite 的 `VACUUM INTO` 备份一份数据库到 `/var/lib/couju/backups/`，保留最近 10 份。

## 不选的

- **静态文件交给 Caddy 直接服务**：更快，但要改 Owner 的 Caddy 配置里的路径，且部署要写 Caddy 管的目录。量很小，Node 服务足够。
- **在 GitHub 上构建镜像再传**：镜像几十 MB，从境外传到 miao 慢；在 miao 上基于已有基础镜像构建只要几秒。
- **rugu**：内存吃紧、曾卡死，不放常驻服务。

## 上线前需要 Owner 做的事（到部署那一步时再逐项确认）

1. **域名和反代**：子域名 `game.zyzl.link`（Owner 已定，DNS 由 Owner 解析），Caddy 里加一段 `reverse_proxy 127.0.0.1:8790`。WebSocket 不用额外配置。
2. **部署账号**：一个能 SSH 到 miao、且只能 `sudo` 执行 `/usr/local/bin/couju-deploy` 的账号，私钥放进本仓库的 Actions secret。（签到系统用的是 `deploy@miao` + 专用 key，可以照做。）
3. **邮件**：Resend 的 key 和发件地址（可以和签到系统共用一个 Resend 账号）。
4. **管理员邮箱**：写进 `/var/lib/couju/env` 的 `COUJU_ADMIN_EMAILS`。

在这些就绪之前，开发期可以先由 agent 经 SSH 手动部署到 miao 的一个本地端口自测，不对外。
