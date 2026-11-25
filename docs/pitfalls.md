# 踩坑记录

新坑往后续编号。写清现象、原因、怎么避免。

## 1. 同一个邮箱 60 秒只能取一次验证码

端到端测试或手动调试时连续登录同一个邮箱会被限频（ADR-0004 沿用的参数）。测试里每个场景用不同的邮箱；开发环境可以在 `COUJU_ADMIN_EMAILS` 里多配几个。

## 2. `node:sqlite` 会打印 ExperimentalWarning

Node 22/24 上仍是实验特性，启动时会有一行警告，不影响使用。容器里用 `--disable-warning=ExperimentalWarning` 关掉。
