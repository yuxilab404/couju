# DanZero 本地对手

用原作者发布的 DanZero Q 网络与完整上游动作枚举，给凑局 bot 做本地对战。
只接收当前玩家的 `View`，支持从中盘快照接着打；同一局面不受查询顺序影响。

## 安装和使用

从仓库根目录执行（Python 3.12、Node 24）：

```powershell
git clone https://github.com/Choysang/rlcard-guandan.git games/guandan/.baseline/external-danzero/upstream
git -C games/guandan/.baseline/external-danzero/upstream checkout 6ebe65a14a0bfe6140df9f231e7bf4a340c94f34
python -m venv games/guandan/.baseline/external-danzero/.venv
& games/guandan/.baseline/external-danzero/.venv/Scripts/python.exe -m pip install -r games/guandan/scripts/opponents/danzero/requirements.txt
```

权重已包含在固定的上游版本里，不用另找下载地址。启动时检查 Git SHA、上游工作区和权重 SHA256；检查失败会直接报错。

```js
import { createOpponent } from './games/guandan/scripts/opponents/danzero/opponent.mjs';

const opponent = await createOpponent();
try {
  const action = await opponent.decide(playerView);
  console.log(action, opponent.info);
} finally {
  opponent.close();
}
```

每个 Node worker 创建一个 `opponent` 并复用，完成后调用 `close()`。Python 使用单线程 NumPy，进程内多个座位共用一份权重；日常推理不需要 PyTorch。

自定义位置使用 `DANZERO_LAB`、`DANZERO_UPSTREAM`、`DANZERO_PYTHON`。默认实验目录是 `games/guandan/.baseline/external-danzero/`，默认源码和 Python 分别在它的 `upstream/`、`.venv/`。

## 校准

```powershell
node games/guandan/scripts/opponents/danzero/selfcheck.mjs
& games/guandan/.baseline/external-danzero/.venv/Scripts/python.exe games/guandan/scripts/opponents/danzero/verify-features.py
```

第一步跑 8 副不同级牌，逐个检查完整候选是否合法，覆盖大炸、天王炸、A 小/大的连续牌型、同花顺、三张带王对，并把中晚盘快照逆序重放、在新进程中冷启动。固定回归 `fixtures/wind-follow.json` 覆盖两家出完、自己刚 PASS 后接风的局面。第二步仅凭这些快照的公开历史重放上游通知状态机，比较完整 567 维特征。结果写入实验目录的 `selfcheck-results.json`、`features-results.json`。

核对 NumPy 与原 PyTorch 网络（只在校准时安装）：

```powershell
& games/guandan/.baseline/external-danzero/.venv/Scripts/python.exe -m pip install torch==2.15.0
& games/guandan/.baseline/external-danzero/.venv/Scripts/python.exe games/guandan/scripts/opponents/danzero/verify-numerics.py
```

结果在 `numerics-results.json`；要求 argmax 一致且最大绝对 Q 误差小于 `1e-4`。校准程序没有加载对手真实手牌。

## 来源和边界

- 接口、牌型枚举、特征实现：[Choysang/rlcard-guandan](https://github.com/Choysang/rlcard-guandan/tree/6ebe65a14a0bfe6140df9f231e7bf4a340c94f34)，固定 SHA `6ebe65a14a0bfe6140df9f231e7bf4a340c94f34`，上游声明 MIT。源码从独立 checkout 导入，本目录不包含它。
- 权重：`guandan_rlcard/baselines/danzero/q_network.ckpt`，5,368,401 字节，SHA256 `a6f132e50e205709c0efdb1b550d935c5bfc313b21726b0e70e300b6cd7ea1a3`。
- 原作者来源：[submit-paper/Danzero_plus](https://github.com/submit-paper/Danzero_plus/tree/e2b900b01096e0743de945f9963df35cd544f36d)，固定 SHA `e2b900b01096e0743de945f9963df35cd544f36d`。它的 `actor_torch/q_network.ckpt`、`wintest/danzero/q_network.ckpt`、`wintest/torch/q_network.ckpt` 与上述权重 SHA256 完全相同。原作者仓库未附独立 LICENSE，因此只用于本地实验，本目录不再分发权重。这个 checkpoint 没有训练轮数元数据，不能把论文中的训练成绩直接当作它的实测强度。
- 更早的代码来源：[AltmanD/guandan_mcc](https://github.com/AltmanD/guandan_mcc/tree/e816ca3af431678903d051365d7c19a6dd4ebdb8)，Apache-2.0。
- 推理：上游的 `DanzeroAgent.parse/prepare` 和 `GuandanJudger` 原样使用；自编 NumPy 前向执行同一组权重、float32 和 Tanh，不做训练、不截断候选、不借用凑局 bot 的候选剪枝。取上游完整候选的最大 Q 动作，出错直接失败。
- 公开信息：未知牌集合等于双副牌减自己的现有手牌、减全部公开已出牌；没有单家未知手牌的归属信息。每次重建历史特征，包括上游在两家出完后补的虚拟 PASS；无跨请求记账依赖。
- 动作：上游连续牌型的 `key_rank` 是起点，凑局的 `as.main` 是终点，桥接双向按长度转换；重复副牌只从自己的实际手牌中匹配。
- 上游动作枚举把同花顺只声明为 `StraightFlush`，不额外声明成普通 `Straight`；桥保留这个上游动作空间。进贡和还贡使用上游启发式，公开局面固定随机种子；本轮校准覆盖单副出牌，整场升级/进还贡另测。
