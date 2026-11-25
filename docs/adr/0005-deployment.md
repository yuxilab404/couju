# ADR-0005 部署：miao 单容器，前端热替换

状态：已采纳（上线前需要 Owner 做的几件事见文末）· 2026-11-25

## 背景

miao（4 核 / 3.4G）是唯一生产机，和牌手容器共用，实测空闲约 2G。已有 Caddy 反代，`miao.zyzl.link` 根路径是签到系统。服务器上的东西尽量跑在容器里、每个容器设内存上限。域名、反代和机器运维归 Owner。

## 决定

1. **一个容器 `couju`**，镜像 = 官方 `node:24-alpine` + 打包好的 `server.mjs`，不装 `node_modules`。`--memory 256m --restart unless-stopped`，只监听 `127.0.0.1:8790`。预期常驻 60–100 MB。
2. **数据目录 `/var/lib/couju`** 挂进容器：`couju.db`（SQLite）、`web/`（前端静态文件）、`env`（密钥，权限 600）。
3. **前端不打进镜像。** 服务端从挂载目录读静态文件。只改前端时（加游戏、改画面），部署脚本把新文件解到 `web/releases/<sha>/`，再原子地切换 `web/current` 软链——进程不重启，进行中的房间不断。浏览器在下次刷新或换房主时拿到新版本；快照里的 `buildId` 防止新老版本混着当房主。
4. **服务端有变化时才重建镜像、重启容器。** 重启前脚本查 `/api/health` 里的活跃房间数，等到 0（最多等 30 分钟，超时就放弃这次部署，下次再来；`--force` 可强制）。保留上一个镜像标签，回滚 = 用旧标签起容器。
5. **发布靠 miao 拉取，不靠 CI 推送**：GitHub Actions 在 `main` 合入后跑测试和端到端，把构建包（几百 KB 的 tar，含 `server.mjs`、前端、Dockerfile、部署脚本）发到名为 `deploy` 的 Release，每次覆盖。miao 上的 systemd 定时器每 2 分钟取一次 `BUILD_ID`，变了就下载、校验 sha256、执行包里的 `miao-deploy.sh`。镜像在 miao 上基于已有的 node 镜像构建，不经镜像仓库。
   - 这样不需要把 SSH 私钥放进 GitHub：仓库公开，Release 用 Actions 自带的 `GITHUB_TOKEN` 发布，miao 匿名下载。
   - 能往 `main` 合入的人就能部署，和 CI 推送方案一样。
6. **备份**：部署脚本每次先用 SQLite 的 `VACUUM INTO` 备份一份数据库到 `/var/lib/couju/backups/`，保留最近 10 份。

## 不选的

- **静态文件交给 Caddy 直接服务**：更快，但要改 Owner 的 Caddy 配置里的路径，且部署要写 Caddy 管的目录。量很小，Node 服务足够。
- **在 GitHub 上构建镜像再传**：镜像几十 MB，从境外传到 miao 慢；在 miao 上基于已有基础镜像构建只要几秒。
- **CI 通过 SSH 推送**（签到系统的做法）：要在 GitHub 上放一把能登录 miao 的私钥，还要一个受限的部署账号。拉取方案没有这把钥匙，零件更少。
- **rugu**：内存吃紧、曾卡死，不放常驻服务。

## 上线情况（2026-11-26 更新）

- 地址是 **`https://miao.zyzl.link/game/`**：挂在签到系统所在域名的子路径下，Caddy 里 `@couju path /game /game/*` 转给 `127.0.0.1:8790`。
  - 原计划用子域名 `game.zyzl.link`，但 miao 是腾讯云国内机器，没备案的新域名访问 80/443 会被拦截，要求备案。`zyzl.link` 没在腾讯云备案过，Owner 决定先挂到现有域名下（2026-11-26）。
  - 为此平台支持挂在任意子路径下：服务端由 `COUJU_BASE_URL` 推出前缀，带前缀的请求先去掉前缀再路由，页面里注入 `<base href="/game/">`，前端所有接口、WebSocket、路由和头像地址都相对这个前缀；cookie 的 Path 限定在前缀内，和签到系统互不影响。
  - 代价：和 `miao.zyzl.link` 同进退。哪天要换独立域名，只改 `COUJU_BASE_URL` 和 Caddy，代码不用动。
- 邮件复用签到系统的 Resend 账号和已验证域名 `email.zyzl.link`，发件人 `凑局 <game@email.zyzl.link>`。
- 管理员邮箱与签到系统一致。
- 运维细节见 [`deploy/README.md`](../../deploy/README.md)。
