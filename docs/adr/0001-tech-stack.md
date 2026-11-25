# ADR-0001 技术栈：TypeScript 全栈

状态：已采纳 · 2026-11-25

## 背景

规则要在房主浏览器里跑，也要在测试和 CI 里跑；服务端和浏览器共用一份协议类型。服务器内存紧（miao 留给本项目的大约 2G 里还要让着牌手容器），维护的人是 agent 加偶尔有空的 Owner，零件越少越好。

## 决定

| 部位 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（全部） | 规则、平台、服务端、测试一种语言；协议和游戏接口靠类型检查对齐 |
| 仓库组织 | npm workspaces | 不引入 pnpm/turbo 等额外工具；包之间的依赖方向用 `scripts/check-deps.mjs` 检查 |
| 服务端运行时 | Node 24 LTS | 自带 `node:sqlite`、`fetch`、WebSocket 客户端；容器里固定版本 |
| HTTP | Hono + `@hono/node-server` | 很小，路由和 cookie 够用 |
| WebSocket | `ws` | 事实标准，没有多余抽象（不用 socket.io：它的房间和重连我们要自己按平台语义做） |
| 数据库 | `node:sqlite`（SQLite 单文件） | 不用原生编译依赖；数据量是几十个用户；备份就是拷一个文件 |
| 邮件 | 直接 `fetch` 调 Resend，SMTP 兜底 | 和 auto-tiandao-sign 一样，Owner 已有账号 |
| 服务端打包 | esbuild 打成单个 `server.mjs` | 容器里不装 `node_modules`，镜像就是官方 node 镜像加一个文件 |
| 前端 | React 19 + Vite | agent 最熟；游戏画面直接写 React 组件，实时游戏在组件里放 `<canvas>` |
| 样式 | 原生 CSS + CSS Modules | 不加 Tailwind 之类的构建环节 |
| 测试 | Vitest + Playwright | Playwright 本机已有；Vitest 和 Vite 同配置 |

## 不选的

- **boardgame.io**：它的模型（`moves`、`phases`、`playerView`、`activePlayers`、随机数插件）很合适，我们的接口借鉴了它。但它的多人模式默认服务端权威（Master 在服务端跑游戏），和"房主浏览器是服务器、服务端是哑管道"正好相反；它的 P2P 传输还是实验性质、要 WebRTC；实时游戏也不在它的设计范围里。只用它的 reducer 部分，换来的是一个大依赖和两套概念，不如自己写一个只有几百行、完全对着五个游戏设计的接口。
- **Python 服务端**（照搬 auto-tiandao-sign 的 FastAPI）：登录流程照它做，但语言换成 TS，换来服务端和浏览器共享协议类型，且只维护一种工具链。
- **better-sqlite3**：需要原生编译。`node:sqlite` 在 Node 24 上仍标"实验"，但我们固定 Node 版本，用到的 API 只有 `prepare/run/get/all`。如果它的 API 变了，换回 better-sqlite3 只改 `server/src/db.ts` 一个文件。

## 代价

- 前端绑定 React：游戏画面必须是 React 组件。实时游戏的高频画面在 `<canvas>` 里自己画，不走 React 重渲染，所以性能不受影响。
- 自己写接口意味着房主循环、交接这些要自己测。它们本来就要按我们的语义写，换框架也省不掉。

## 什么时候重新考虑

- `node:sqlite` 在锁定的 Node 版本上出问题。
- 出现非 React 不可解决的画面需求（目前看不到）。
