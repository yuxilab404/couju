# 凑局架构

> 本文是架构的唯一权威落点。约束和原则见 [`AGENTS.md`](./AGENTS.md)，每个选型的理由见 [`docs/adr/`](./docs/adr/README.md)。接口有改动时同步改这里。

## 1. 一句话

服务端只认人、不认游戏：管账号、大厅、房间成员和消息转发。每一桌的游戏在房主的浏览器里跑，房主按"每个玩家能看到什么"把状态分发给其他人；空位由房主浏览器里的 bot 坐。

```
 浏览器（普通玩家）            miao：couju 容器                浏览器（房主）
┌──────────────────┐      ┌──────────────────────┐      ┌───────────────────────────┐
│ 平台外壳 + 游戏画面 │◀────▶│ 账号 / 大厅 / 房间成员   │◀────▶│ 平台外壳 + 游戏画面          │
│ 只发操作、收视图     │  WS  │ 中继：按 to 转发不透明包 │  WS  │ 房主循环：规则 + 视图投影 + bot │
└──────────────────┘      │ 房间快照（不透明，只存最新）│      └───────────────────────────┘
                          │ SQLite：用户/白名单/会话/积分│
                          │ （以后）大模型代理         │
                          └──────────────────────┘
```

## 2. 三层与依赖方向

| 层 | 位置 | 做什么 | 不做什么 |
|---|---|---|---|
| 服务端 | `server/` | 账号与会话、白名单、账号积分、大厅列表、房间成员与房主身份、消息转发、房间快照暂存、（以后）大模型代理 | 不 import 任何游戏；不解析转发包和快照的内容 |
| 平台层 | `platform/` | 房间与座位、房主权威循环、按视角下发视图、空位与托管交给 bot、计时、房主交接、断线重连、通用界面外壳（大厅、房间、座位、结算、个人资料、管理） | 不认识任何游戏的规则；不出现某个游戏的名字 |
| 游戏模块 | `games/<id>/` | 规则、视图投影、bot、画面 | 不碰网络、不读时钟、不用 `Math.random`；游戏之间不互相引用 |

还有三个"接口包"，它们不属于某一层，只放类型和无状态工具：

- `sdk/`：游戏接口（`GameDef`）、可序列化随机数、给游戏用的测试工具。**游戏模块只能依赖它**（加上 React 和可选的 `games/_kit/*` 共享库）。
- `protocol/`：服务端和浏览器之间的消息类型。服务端和平台层共用。
- `games/_kit/`：多个游戏共用的纯工具（比如扑克牌的牌面组件、牌型辅助）。它不是游戏，不能依赖任何游戏。

依赖图（箭头指向被依赖方），`scripts/check-deps.mjs` 在 CI 里检查：

```
web ──▶ platform ──▶ sdk
 │         └──────▶ protocol ◀── server
 └──▶ games/* ──▶ sdk, games/_kit
```

`web/` 是入口：只负责把平台外壳（含登录、大厅、房间、资料、管理页面）和游戏注册表装起来。**加一个新游戏 = 新建 `games/<id>/` + 在 `web/src/games.ts` 里加一行**，平台和服务端不改。

## 3. 游戏接口

完整签名在 `sdk/src/game.ts`，这里是它的形状和理由。要装下的差异：回合制/实时、隐藏信息、2–12 人、固定队伍、阶段流程、本地 bot / 大模型 bot。

```ts
type Seat = number; // 0..n-1，座位就是游戏里的玩家编号

interface GameDef<S, A, V, O = {}, I = never> {
  id: string;                     // 'doudizhu'，进快照和大厅元数据
  version: number;                // 规则或状态结构变了就加一；交接时不一致则拒绝接手
  name: string;
  players: { min: number; max: number };
  teams?(n: number): number[];    // 每个座位的队伍号；有固定队伍的游戏声明，平台据此排座位和显示
  options?: OptionSpec<O>[];      // 建房时的可选规则，平台画通用表单

  setup(ctx: { numPlayers: number; options: O; rng: Rng }): S;

  // 二选一
  turn?: TurnRules<S, A>;
  realtime?: RealtimeRules<S, I>;

  view(s: S, seat: Seat | null): V; // 这个座位能看到的东西；null = 旁观者
  publicView?: boolean;             // 所有座位视图相同（坦克）→ 平台只广播一份
  result(s: S): Result | null;      // 非 null 即结束

  bot: BotFactory<V, A | I>;        // 每个游戏必须带 bot，空位和托管都靠它
  ui: GameUI<V, A, I>;              // React 组件
}

interface TurnRules<S, A> {
  active(s: S): Seat[];                          // 现在谁能动；可以多人同时（狼人杀夜里、投票）
  validate(s: S, seat: Seat, a: A): string | null; // null 合法，否则是给人看的原因
  apply(s: S, seat: Seat, a: A, ctx: { rng: Rng }): S;
  timer?(s: S): { ms: number; seats: Seat[]; key?: string } | null; // 需要倒计时的局面；同 key 沿用原截止时刻
  onTimeout?(s: S, seat: Seat): A;               // 不提供就让 bot 替这个座位出
  pause?(s: S): number;                          // 进入这个局面后停多久让人看清（翻牌之类），bot 停完再出手（§4.3）
}

interface RealtimeRules<S, I> {
  tickHz: number;                                // 固定步长
  step(s: S, inputs: (I | null)[], ctx: { rng: Rng; tick: number }): S;
}

interface Result {
  winners: Seat[];
  scores?: number[];   // 本局每个座位的得分变化，平台在房间里累计
  summary: string;     // "地主获胜 · 春天 · ×8"
  weight?: number;     // 账号积分的分量，默认 1，平台夹到 [0,3]，0 = 不计分（§4.6）
}

interface Bot<V, Out> {
  decide(view: V, ctx: BotCtx): Out | Promise<Out>;
}
interface BotCtx {
  seat: Seat; rng: Rng; signal: AbortSignal;
  llm?: (req: LlmRequest) => Promise<LlmReply>;  // 只有声明需要大模型的 bot 拿得到，走服务端代理
}
```

硬约束（sdk 的测试工具会检查）：

1. **规则是纯函数。** `setup/apply/step/view/result/validate` 不读时钟、不发请求、不改入参；随机只用传进来的 `rng`。同一个种子 + 同一串动作必须得到同一个状态。测试环境下平台会深冻结状态来抓"改入参"。
2. **状态可序列化。** `S` 必须能 `JSON.stringify` 往返不变（不放 Map、类实例、函数）。交接和回放都靠它。
3. **bot 只看自己的视图。** bot 拿到的是 `view(s, seat)`，和真人看到的一样，不能偷看底牌。这也让"人掉线 → bot 接手 → 人回来"无缝。
4. **阶段是游戏自己的事。** 平台不认识"叫地主""黑夜"，只问 `active()` 和 `timer()`。
5. **时间以动作的形式进入规则。** 倒计时到了，平台调 `onTimeout` 或 bot 生成一个普通动作再 `apply`，所以回放时不需要时钟。

为什么是这个形状、以及拿掼蛋和坦克在纸面上过的结果，见 [ADR-0002](./docs/adr/0002-game-interface.md)。

## 4. 房间

### 4.1 谁持有什么（每个事实一个真源）

| 事实 | 真源 | 其他地方的副本 |
|---|---|---|
| 账号、昵称、头像、白名单、会话 | 服务端 SQLite | 浏览器里的展示缓存 |
| 账号积分 | 服务端 SQLite 的 `rating_changes`（每局每人的增减；当前分 = 1200 + 之和） | 成员列表里的 `rating`、快照里这局的 `rating` 回执，都只用于显示 |
| 房间存在、成员列表、谁是房主 | 服务端内存 | 平台层收到的 `room.state` |
| 房间配置、座位、游戏状态、随机数状态 | 当前房主的浏览器 | 服务端的房间快照（只用于交接，没有写入决策权）；各玩家手里的自己那份视图 |
| 大厅里显示的房间信息 | 房主（写 `meta`） | 服务端原样存、原样发给大厅 |

房间只在内存里，不常驻落盘。部署重启服务端时不等任何人：旧进程收到 SIGTERM 把房间表写进 `data/rooms-handoff.json`，新进程启动时读回并立刻删掉，大家重连后接着打同一局；进程崩溃（没机会写文件）时房间才会消失。见 [ADR-0006](./docs/adr/0006-hot-update.md)。

### 4.2 生命周期

```
建房 ──▶ 等人（选游戏、改规则、选座位、空位设 bot）──▶ 开局 ──▶ 对局 ──▶ 结算 ──▶ 再来一局 / 回到等人
```

- **建房**：建房的人就是房主。房主在浏览器里生成房间配置，通过 `room.meta` 把大厅要显示的摘要告诉服务端。
- **入座**：成员通过中继向房主发"想坐几号位"，房主决定并广播座位表。有队伍的游戏，座位表按 `teams()` 显示队伍。
- **开局**：房主检查人数在 `players` 范围内，空座按房主选的 bot 补满，用新种子调 `setup`。
- **结算**：`result()` 非 null 时平台显示结算，把 `scores` 累计到这个房间的记分板（记分板只在房间存活期间有效），并把输赢报给服务端记账号积分（§4.6）。

### 4.3 房主循环（回合制）

```
收到 act(seq, action) ─▶ seat 在 active() 里？─▶ validate ─▶ apply ─▶ 新状态
                                                              │
     ┌──────────────────────────────────────────────────────┘
     ▼
 对每个在座玩家：view(s, seat) ─▶ 只发给他（房主自己本地直接用）
 快照 ─▶ room.checkpoint（每次状态变化都发，几 KB）
 active() 里有 bot 座位 ─▶ 等 pause() 停完 + 一点"思考"延迟 ─▶ 调 bot.decide ─▶ 当成 act 走同一条路
 timer() ─▶ 设倒计时（顺延 pause() 那么久），到点走 onTimeout 或 bot
```

节奏（[ADR-0008](./docs/adr/0008-table-pacing.md)）：bot 默认思考 0.8–1.5 秒；游戏用 `pause(s)` 声明某个局面要多停一会儿（唬牌翻牌约 3 秒），平台在这段时间里不让 bot 出手、倒计时顺延，剩下的停顿随视图下发（`pauseMs`），结算弹窗等它停完再弹。停顿只是节奏，不进规则，回放和交接都不需要它。出牌飞入、翻牌、发牌这些通用动画在 `games/_kit/cards`（`FlyIn`、`FlipCard`、`Hand deal`）。

bot 的决定回来时局面可能已经变了（比如大模型思考了十秒），平台照常 `validate`，不合法就丢掉重新问。

### 4.4 实时游戏

> 接口已定（`RealtimeGameDef`），房主的实时循环随第一个实时游戏一起实现；在那之前 `canStart()` 会拒绝开实时游戏。

- 房主按 `tickHz` 固定步长调 `step`，输入是每个座位"最后一次上报的按键状态"。
- 其他玩家只在按键变化时发 `input`；房主每 2–3 个 tick 广播一次视图帧（大约 15–20 帧/秒），客户端在两帧之间插值。插值是游戏画面自己的事，平台提供带时间戳的帧缓冲。
- 不发房间快照，不做房主交接：实时游戏一局很短，房主掉线就结束这一局回到等人。
- bot 每个 tick（或游戏声明的频率）拿视图出输入，本地跑，很便宜。

### 4.5 掉线、重连、交接

- **普通玩家掉线**：服务端通知房主；房主给他 30 秒宽限，过了就让 bot 托管这个座位（座位上显示"托管中"）。他重连后重新进房，房主把座位还给他、补发当前视图。
- **手动托管**（[ADR-0009](./docs/adr/0009-manual-autoplay.md)）：对局中玩家可以自己点"托管"（中继消息 `auto`），bot 替他出，人在线也不收回；点"取消托管"、自己出一手或这局结束时收回，下一局不延续。房主把这些座位记在快照的 `manual` 里，换房主后照样托管。
- **房主掉线（回合制）**：服务端等 15 秒让房主重连；超时就从在线成员里按入房顺序选新房主，把最新快照发给他。新房主检查快照的 `gameId` 和 `version` 跟自己加载的游戏一致，一致就从快照恢复、接着跑；不一致就提示刷新页面。老房主之后回来就是普通成员。
- **房主掉线（实时）**：同样换房主，但游戏直接结束，回到等人。
- **还没回应的操作**：交接瞬间在路上的 `act` 会丢。新房主恢复后给所有人重发视图，玩家看到还轮到自己就再点一次。

### 4.6 账号积分

细节和理由见 [ADR-0007](./docs/adr/0007-account-rating.md)。

- 一局结束，房主按开局时的座位把 `winners` 里的真人和其余座位的真人分成两边，连同开局生成的 `matchId`、游戏给的 `weight` 发 `rating.report`。bot 不参与；没有真人赢或没有真人输就不报。
- 服务端按两两比较的多人 Elo 算分（K=32，每场 `2K·weight/N`），写 `matches` 和 `rating_changes`，回 `rating.result` 给房主，并更新各房间成员列表里的积分。同一个 `matchId` 只记一次。
- 房主把回执写进 `GameEnvelope.rating`，随 `sync` 发给所有人显示。没收到回执前结算里显示"积分结算中"；断线没发出去的重连后补发。还没回执的上报都记在快照的 `unrated` 里（包括已经开了下一局的旧局），换房主或刷新后新房主接着报，靠去重保证不重复计分。
- 新游戏什么都不用做就能计分；输赢有大小的游戏在 `Result.weight` 里给分量。

快照格式（平台定义，服务端不解析）：

```ts
interface Checkpoint {
  gameId: string; gameVersion: number; buildId: string;
  options: unknown; seats: SeatAssignment[];  // 每个座位：userId 或 bot 配置
  state: unknown; rng: RngState; seq: number;
  scoreboard: Record<userId, number>;
  matchId: string; rating: MatchRating | null;  // 积分去重键和服务端回执（§4.6）
  unrated: MatchReport[];                        // 已结束、还没收到回执的积分上报（§4.6）
  manual: Seat[];                                // 自己点了托管的座位（§4.5）
}
```

## 5. 服务端 ⇄ 浏览器协议

一条 WebSocket（`/ws`，靠登录 cookie 鉴权），JSON 消息，类型定义在 `protocol/`。服务端只看外层字段。

| 方向 | 消息 | 说明 |
|---|---|---|
| C→S | `lobby.watch` / `lobby.unwatch` | 订阅大厅 |
| S→C | `lobby.rooms` | 房间列表：`{id, hostName, members, meta}` |
| C→S | `room.create {meta}` / `room.join {roomId}` / `room.leave` | |
| S→C | `room.state {roomId, members[], hostId}` | 成员或房主变化时推送 |
| C→S | `room.meta {meta}` | 仅房主；大厅显示用的不透明摘要 |
| C→S | `room.checkpoint {data}` | 仅房主；服务端只存最新一份 |
| S→C | `room.host {hostId, checkpoint?}` | 换房主时发给新房主（带快照）和所有人（不带） |
| C→S | `rating.report {report}` | 仅房主；一局的 `{matchId, gameId, weight, winners[], losers[]}`（§4.6） |
| S→C | `rating.result {result}` | 回给上报的房主：每人积分前后；重复上报回同一份 |
| C→S | `relay {to, data}` | `to` 是 `"host"`、`"all"` 或若干 userId |
| S→C | `relay {from, data}` | 原样转发 |
| 双向 | `ping` / `pong` | 保活，判断掉线 |

`relay.data` 里是平台层自己的消息（`seat`、`act`、`auto`、`view`、`reject`、`input`、`frame`、`chat`……），定义在 `platform/src/wire.ts`，服务端看不懂也不需要看懂。

服务端只做不涉及游戏的兜底：单条消息 ≤ 64 KB，每个连接的发送频率上限，只有房主能发 `room.meta`/`room.checkpoint`。这些是防程序出错把服务器拖垮，不是防作弊。

## 6. 账号

照 auto-tiandao-sign 的 `web/auth.py` 做，细节见 [ADR-0004](./docs/adr/0004-accounts.md)。

- 邮箱 + 6 位验证码登录，不设密码。会话是随机 token 存库、放 HttpOnly cookie，30 天。
- 只有白名单里启用的邮箱和配置里的管理员邮箱能收到验证码；其他邮箱返回同样的"已发送"，不发信。
- 管理员在管理页加白名单（同时发邀请邮件）、写备注（谁带来的）、停用。
- 每个人能改昵称、上传头像。头像在浏览器里裁成 128×128 再上传，存在 SQLite 里。
- 每个账号有一个积分（§4.6），`PublicUser.rating` 带着它；`GET /api/ratings/:id` 给积分、局数、胜局和最近 20 局记录，资料页用。

## 7. 大模型 bot（以后，狼人杀用）

服务端提供 `POST /api/llm`：登录用户才能调，请求体是通用的 messages，服务端带上 key 转给模型供应商，按用户和全站做每日次数上限。服务端不知道这是哪个游戏的 bot。提示词由游戏模块的 bot 在房主浏览器里拼，房主浏览器调这个接口。key 只在服务端环境变量里。

## 8. 代码布局

```
couju/
├── server/          Node 服务端（Hono + ws + node:sqlite），打包成单文件
├── protocol/        服务端 ⇄ 浏览器消息类型
├── platform/        浏览器平台层（React）
├── sdk/             游戏接口、Rng、游戏测试工具
├── games/
│   ├── _kit/cards/  扑克牌共用：牌面组件、点数排序
│   ├── doudizhu/    规则、视图、bot、画面、测试
│   ├── guandan/     掼蛋：4 人两队，从 2 打过 A 是一局（ADR-0002 决定 8）
│   └── liar-roulette/ 唬牌
├── web/             入口：挂载平台外壳 + 游戏注册表 games.ts（Vite）
├── e2e/             Playwright：多浏览器打一局、交接
├── deploy/          Dockerfile、miao 上的部署脚本
└── docs/adr/        选型记录
```

## 9. 测试

- **规则**：每个游戏自己的单测（牌型识别、比大小、结算）。
- **一致性**：`sdk/testing` 的 `conformance(game)`：用 bot 自己跟自己打几百局，检查不抛错、能结束、确定性（同种子同动作同结果）、不改入参、状态 JSON 往返不变、`view` 结果里不含别的座位的私有信息（游戏提供一个"私有信息探针"）。
- **平台**：房主循环、托管、交接用假中继做单测。
- **集成**：`e2e/handover.test.ts` 用真实的服务端 `Rooms` + 平台 `RoomSession` 进程内连线，测建房、开局、换房主、刷新恢复。
- **端到端**：`npm run e2e`（先 `npm run build`）。Playwright 起打包后的服务端（`COUJU_DEV=1`，验证码从 `/api/dev/last-code` 取，这个接口只在开发模式存在，且开发模式拒绝配 https 地址启动），一人建房、两个 bot 补位打完一局；再测房主关页面后另一个人接手打完。

## 10. 部署

miao 上一个容器 `couju`，内存上限 256 MB，只监听 127.0.0.1，由 Caddy 反代到 `https://miao.zyzl.link/game/`。站点可以挂在任意子路径下：前缀由 `COUJU_BASE_URL` 决定，服务端去掉前缀再路由并给页面注入 `<base href>`，前端所有地址都相对它（`platform/src/base.ts`）。前端静态文件放在挂载目录里、由服务端直接读，所以**只改前端（比如加游戏）时换文件不重启进程，进行中的房间不受影响**。服务端有变化时直接换容器、不等房间清空，房间表经交接文件带到新进程。已打开的页面定期拉 `version.json`，发现新版本就弹"刷新一下"的提醒（对局中先不弹），刷新不会退出房间。详见 [ADR-0005](./docs/adr/0005-deployment.md)、[ADR-0006](./docs/adr/0006-hot-update.md)。
