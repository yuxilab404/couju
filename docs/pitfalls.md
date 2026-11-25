# 踩坑记录

新坑往后续编号。写清现象、原因、怎么避免。

## 1. 同一个邮箱 60 秒只能取一次验证码

端到端测试或手动调试时连续登录同一个邮箱会被限频（ADR-0004 沿用的参数）。测试里每个场景用不同的邮箱；开发环境可以在 `COUJU_ADMIN_EMAILS` 里多配几个。

## 2. `node:sqlite` 会打印 ExperimentalWarning

Node 22/24 上仍是实验特性，启动时会有一行警告，不影响使用。容器里用 `--disable-warning=ExperimentalWarning` 关掉。

## 3. miao 访问 GitHub 时好时坏

从 miao 直连 GitHub：小请求大多能通，但 `git clone`、分支源码包（codeload）经常卡住或被断开（`GnuTLS recv error`、`Empty reply from server`）。所以部署设计成"CI 打好几百 KB 的包发到 Release，miao 每 2 分钟来取一次"：单次失败不要紧，下一轮再试。不要设计成需要在 miao 上拉源码、装依赖的流程。

## 4. 腾讯云国内机器：没备案的新域名会被拦

miao 是腾讯云国内服务器。腾讯云按请求里的域名（HTTP 的 Host、HTTPS 的 SNI）检查 80/443 端口，没备案的域名会被拦截并提示备案，和解析到哪个 IP 无关。`game.zyzl.link` 加完解析就被拦了，所以凑局改挂在已经在用的 `miao.zyzl.link/game/` 下。以后想换独立域名，先确认域名的备案情况。
