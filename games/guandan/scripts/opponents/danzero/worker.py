"""本地 DanZero 桥；上游源码和权重在固定 checkout 中，文件本身不携带模型。"""
import os

for key in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "BLIS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[key] = "1"

import collections
import hashlib
import io
import json
from pathlib import Path
import pickle
import random
import subprocess
import sys
import time
import traceback
import types

import numpy as np

HERE = Path(__file__).resolve().parent
LAB = Path(os.environ.get("DANZERO_LAB", HERE.parents[2] / ".baseline/external-danzero")).resolve()
UPSTREAM = Path(os.environ.get("DANZERO_UPSTREAM", LAB / "upstream")).resolve()
EXPECTED_COMMIT = "6ebe65a14a0bfe6140df9f231e7bf4a340c94f34"
EXPECTED_HASH = "a6f132e50e205709c0efdb1b550d935c5bfc313b21726b0e70e300b6cd7ea1a3"
WEIGHT = UPSTREAM / "guandan_rlcard/baselines/danzero/q_network.ckpt"
RANKS = "23456789TJQKA"


class ArrayUnpickler(pickle.Unpickler):
    """该 checkpoint 只需 NumPy 数组；拒绝任何其他 pickle 全局对象。"""
    def find_class(self, module, name):
        if module in ("numpy.core.multiarray", "numpy._core.multiarray") and name == "_reconstruct":
            return np._core.multiarray._reconstruct
        if module == "numpy" and name in ("ndarray", "dtype"):
            return getattr(np, name)
        raise pickle.UnpicklingError(f"checkpoint contains unexpected global: {module}.{name}")


class NumpyAction:
    """与上游 MLPQNetwork.load_tf_weights/forward 等价的 float32 CPU 前向。"""
    weights = None
    calls = 0
    last_scores = None

    def __init__(self):
        if self.__class__.weights is None:
            payload = WEIGHT.read_bytes()
            if hashlib.sha256(payload).hexdigest() != EXPECTED_HASH:
                raise RuntimeError("DanZero checkpoint SHA256 mismatch")
            arrays = ArrayUnpickler(io.BytesIO(payload), encoding="latin1").load()
            expected = [(567, 512), (512,), (512, 512), (512,), (512, 512), (512,), (512, 512), (512,), (512, 512), (512,), (512, 1), (1,)]
            if len(arrays) != len(expected) or [x.shape for x in arrays] != expected:
                raise RuntimeError(f"Unexpected DanZero layer shapes: {[x.shape for x in arrays]}")
            self.__class__.weights = [np.asarray(x, dtype=np.float32) for x in arrays]

    def scores(self, x):
        x = np.asarray(x, dtype=np.float32)
        if x.ndim != 2 or x.shape[1] != 567:
            raise ValueError(f"Expected complete 567-dimensional DanZero observations, got {x.shape}")
        result = np.empty(x.shape[0], dtype=np.float32)
        # 分块仅限制临时矩阵内存，每个候选都会评分。
        for start in range(0, len(x), 512):
            y = x[start:start + 512]
            for i in range(0, len(self.weights), 2):
                y = y @ self.weights[i] + self.weights[i + 1]
                if i + 2 < len(self.weights):
                    y = np.tanh(y)
            result[start:start + len(y)] = y[:, 0]
        if not np.isfinite(result).all():
            raise FloatingPointError("DanZero returned nonfinite Q values")
        return result

    def step(self, state):
        values = self.scores(state["x_batch"])
        self.__class__.calls += 1
        self.__class__.last_scores = values
        return int(values.argsort()[-1])


# 只替换计算后端，DanzeroAgent 的 parse/prepare 原样导入。
# 不导入 torch，因此每个持久 worker 只保留一份 5.37 MB 的权重。
module_name = "guandan_rlcard.baselines.danzero.actor"
actor_module = types.ModuleType(module_name)
actor_module.Action = NumpyAction
sys.modules[module_name] = actor_module
sys.path.insert(0, str(UPSTREAM))

from guandan_rlcard.baselines.danzero.danzero_agent import DanzeroAgent
from guandan_rlcard.baselines.danzero.danutil import card2num
from guandan_rlcard.game.card_utils import card_from_str
from guandan_rlcard.game.judger import GuandanJudger
from guandan_rlcard.game.action_compare import get_gt_actions


def face(card_id):
    rank = int(card_id[1:3])
    return "SB" if rank == 16 else "HR" if rank == 17 else card_id[0] + RANKS[rank - 2]


def upstream_action(last, level):
    if last is None:
        return []
    names = {"single": "Single", "pair": "Pair", "triple": "Trips", "fullHouse": "ThreeWithTwo", "straight": "Straight", "tube": "ThreePair", "plate": "TwoTrips", "bomb": "Bomb", "straightFlush": "StraightFlush", "jokerBomb": "Bomb"}
    kind, main = last["kind"], last["main"]
    if kind == "jokerBomb":
        key = "R"
    elif kind in ("straight", "straightFlush", "tube", "plate"):
        width = 5 if kind in ("straight", "straightFlush") else 3 if kind == "tube" else 2
        start = main - width + 1
        key = "A" if start == 1 else RANKS[start - 2]
    else:
        rank = level if main == 15 else main
        key = "B" if rank == 16 else "R" if rank == 17 else RANKS[rank - 2]
    return [names[kind], key, [face(x) for x in last["cards"]]]


def couju_action(action, hand, level):
    if action[0] == "PASS":
        return {"type": "pass"}
    pools = collections.defaultdict(list)
    for card in sorted(hand):
        pools[face(card)].append(card)
    cards = []
    for card in action[2]:
        if not pools[card]:
            raise ValueError(f"Upstream played an unowned card: {action}")
        cards.append(pools[card].pop(0))
    if action[0] in ("tribute", "back"):
        return {"type": "tribute" if action[0] == "tribute" else "return", "card": cards[0]}
    names = {"Single": "single", "Pair": "pair", "Trips": "triple", "ThreeWithTwo": "fullHouse", "Straight": "straight", "ThreePair": "tube", "TwoTrips": "plate", "Bomb": "bomb", "StraightFlush": "straightFlush"}
    kind, key = names[action[0]], action[1]
    if action[0] == "Bomb" and key == "R":
        kind, main = "jokerBomb", 17
    elif action[0] in ("Straight", "StraightFlush", "ThreePair", "TwoTrips"):
        start = 1 if key == "A" else RANKS.index(key) + 2
        width = 5 if action[0] in ("Straight", "StraightFlush") else 3 if action[0] == "ThreePair" else 2
        main = start + width - 1
    else:
        main = 16 if key == "B" else 17 if key == "R" else RANKS.index(key) + 2
        if main == level:
            main = 15
    return {"type": "play", "cards": cards, "as": {"kind": kind, "main": main}}


def build_state(v, actions):
    played = [[] for _ in range(4)]
    trace = []
    remain = {s: [2] * 14 for s in "SH"}
    remain.update({s: [2] * 13 + [0] for s in "CD"})
    for entry in v["history"]:
        cards = entry["cards"]
        numeric_seat = entry["seat"]
        if cards is None:
            trace.append([numeric_seat, ["PASS", "PASS", "PASS"]])
        else:
            public_faces = [face(x) for x in cards]
            played[numeric_seat].extend(public_faces)
            # Agent 的历史编码只读取是否 PASS 和 cards，不读取过去动作的牌型。
            trace.append([numeric_seat, ["Play", "", public_faces]])
            for f in public_faces:
                row = 13 if f in ("SB", "HR") else (0 if f[1] == "A" else RANKS.index(f[1]) + 1)
                remain[f[0]][row] -= 1
    return {
        "trace": trace, "played_cards": played, "self": v["me"],
        "teamid": v["me"] % 2, "rank_list": [x - 2 for x in v["teamLevels"]],
        "play_team": v["levelTeam"] if v["levelTeam"] is not None else 0,
        "greaterPos": v["lastPlay"]["seat"] if v["lastPlay"] else -1,
        "pass_num": [0] * 4, "my_pass_num": [0] * 4,
        "greaterAction": upstream_action(v["lastPlay"], v["level"]),
        "current_hand": [face(x) for x in v["hand"]],
        "num_cards_left": list(v["counts"]), "actions": actions,
        "reactions": [[], [], [], []], "remain_cards": remain,
    }


AGENTS = {}


def player(v):
    seat = v["me"]
    if seat not in range(4):
        raise ValueError("DanZero needs a seated public View")
    if seat not in AGENTS:
        AGENTS[seat] = DanzeroAgent(seat, np.random.RandomState(0))
    agent = AGENTS[seat]
    agent.set_current_hand([card_from_str(x) for x in sorted([face(x) for x in v["hand"]], key=lambda c: ("BR".index(c[1]) + 13 if c[1] in "BR" else RANKS.index(c[1]), c[0]))])
    return agent


def rebuild_public_features(agent, v):
    """从公开 View 重建通知阶段累积的瞬时量，支持任意分支和中途接盘。

    other_left_hands 是未知三家手牌的并集：双副牌减自己的现有手牌、再减
    所有公开已出牌。它不包含单家归属，不访问或采样三家的真实手牌。
    prepare 仍由未修改的上游实现计算 567 维特征。
    """
    agent.history_action = {seat: [] for seat in range(4)}
    agent.action_seq = []
    agent.action_order = []
    unknown = [2] * 54
    for number in card2num([face(x) for x in v["hand"]]):
        unknown[number] -= 1
    for entry in v["history"]:
        numbers = [-1] if entry["cards"] is None else card2num([face(x) for x in entry["cards"]])
        agent.history_action[entry["seat"]].append(numbers)
        agent.action_seq.append(numbers)
        agent.action_order.append(entry["seat"])
        for number in numbers:
            if number >= 0:
                unknown[number] -= 1
    if any(x < 0 or x > 2 for x in unknown):
        raise ValueError("Public history and own hand do not form a valid double deck")
    if sum(unknown) != sum(v["counts"]) - len(v["hand"]):
        raise ValueError("Public history is incomplete or counts do not match")
    agent.other_left_hands = unknown
    agent.remaining = list(v["counts"])
    agent.over = list(v["finished"])
    # 与 received_message 的两家出完分支一致：若先出完者位于最近行动者之后，
    # 上游在序列尾补出完座位的虚拟 PASS（prepare 将其编码为零 last_action）。
    # 这是训练时的历史约定，不能用真实的最后一手替代。
    if len(agent.over) == 2 and v["history"]:
        relative = [(agent.player_id + i) % 4 for i in range(1, 4)]
        last_entry = v["history"][-1]
        if last_entry["seat"] == agent.player_id:
            # 上游接风分支会跳过通知序列中的自己，改取 trace[-2]。
            if len(v["history"]) < 2:
                raise ValueError("Two-finished wind-follow history must contain an earlier action")
            last_entry = v["history"][-2]
            cards = last_entry["cards"]
            agent.action_seq.append([-1] if cards is None else card2num([face(x) for x in cards]))
        last_seat = last_entry["seat"]
        if relative.index(agent.over[0]) > relative.index(last_seat):
            agent.action_seq.append([-1])
    agent.count_A = 0
    agent.count_A_self = 0
    agent.count_A_oppo = 0


def decide(v, enumerate_only=False):
    if "hands" in v:
        raise ValueError("A public View must not contain hands")
    start = time.perf_counter()
    # 上游的还贡启发式使用 random.randint；按公开局面固定种子，分支查询顺序无影响。
    random.seed(int.from_bytes(hashlib.sha256(json.dumps(v, sort_keys=True, separators=(",", ":")).encode()).digest()[:8], "big"))
    if v["phase"] == "handOver":
        return {"action": {"type": "ready"}, "candidateCount": 1, "ms": 0}
    if v["phase"] not in ("playing", "tribute", "return"):
        raise ValueError(f"No action in phase {v['phase']}")
    level = v["level"]
    agent = player(v)
    if v["phase"] == "tribute":
        def strength(c):
            r = int(c[1:3])
            return 15 if r == level else r
        legal = [x for x in v["hand"] if not (x[0] == "H" and int(x[1:3]) == level)]
        biggest = max(map(strength, legal))
        actions = [["tribute", face(c)[1], [face(c)]] for c in legal if strength(c) == biggest]
        chosen = agent.tribute_act(actions, RANKS[level - 2])
    elif v["phase"] == "return":
        legal = [x for x in v["hand"] if int(x[1:3]) <= 10] or v["hand"]
        actions = [["back", face(c)[1], [face(c)]] for c in legal]
        pairs = [[x["from"], x["to"]] for x in v["tribute"]["pairs"]]
        chosen = agent.back_act(actions, RANKS[level - 2], pairs)
    else:
        actions = GuandanJudger.playable_actions_from_hand(agent.current_hand, level - 2)
        if v["lastPlay"] is not None:
            greater = types.SimpleNamespace(played_action=upstream_action(v["lastPlay"], level))
            actions = get_gt_actions(level - 2, greater, actions)
        if not actions:
            raise RuntimeError("Upstream generated no legal actions")
        if enumerate_only:
            return {"actions": [couju_action(a, v["hand"], level) for a in actions]}
        rebuild_public_features(agent, v)
        message = agent.parse(build_state(v, actions))
        if message["curRank"] != RANKS[level - 2]:
            raise ValueError("View level and teamLevels/levelTeam do not agree")
        chosen = actions[0] if len(actions) == 1 else actions[agent.action.step(agent.prepare(message))]
    if chosen not in actions:
        raise RuntimeError("DanZero returned an action outside its complete candidate set")
    return {"action": couju_action(chosen, v["hand"], level), "candidateCount": len(actions), "ms": 1000 * (time.perf_counter() - start), "inferenceCalls": NumpyAction.calls}


def main():
    revision = subprocess.check_output(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"], text=True).strip()
    if revision != EXPECTED_COMMIT:
        raise RuntimeError(f"Upstream revision mismatch: {revision}")
    changed = subprocess.check_output(["git", "-C", str(UPSTREAM), "status", "--porcelain", "--untracked-files=no", "--", "guandan_rlcard"], text=True).strip()
    if changed:
        raise RuntimeError("Pinned upstream code/weights have local modifications")
    NumpyAction()
    print(json.dumps({"ready": True, "adapterVersion": "public-rebuild-v3.1", "commit": revision, "checkpointSha256": EXPECTED_HASH, "backend": "numpy-float32", "numpy": np.__version__}), flush=True)
    for line in sys.stdin:
        message = json.loads(line)
        try:
            result = decide(message["view"], message.get("enumerateOnly", False))
            print(json.dumps({"id": message["id"], **result}, ensure_ascii=False), flush=True)
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({"id": message.get("id"), "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
