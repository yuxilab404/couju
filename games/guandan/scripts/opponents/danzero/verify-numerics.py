"""开发验收：比较原始 PyTorch MLP 与轻量 NumPy 后端；日常对战不用 torch。"""
import json
from pathlib import Path
import sys

import worker
import numpy as np
import torch
from guandan_rlcard.baselines.danzero.model import MLPQNetwork

torch.set_num_threads(1)
reference = MLPQNetwork(567)
network = worker.NumpyAction()
reference.load_tf_weights(network.weights)
reference.eval()

root = worker.LAB
views = [entry["v"] for entry in json.loads((root / "replay-fixtures.json").read_text())]
views.append(json.loads((root / "selfcheck-results.json").read_text())["sample"])
worst = 0.0
rows = 0
mismatches = []
for i, view in enumerate(views):
    player = worker.player(view)
    actions = worker.GuandanJudger.playable_actions_from_hand(player.current_hand, view["level"] - 2)
    if view["lastPlay"]:
        greater = worker.types.SimpleNamespace(played_action=worker.upstream_action(view["lastPlay"], view["level"]))
        actions = worker.get_gt_actions(view["level"] - 2, greater, actions)
    worker.rebuild_public_features(player, view)
    message = player.parse(worker.build_state(view, actions))
    features = player.prepare(message)["x_batch"]
    actual = network.scores(features)
    with torch.inference_mode():
        expected = reference.q(torch.tensor(features).to(torch.float32)).numpy()
    error = float(np.max(np.abs(expected - actual)))
    worst = max(worst, error)
    rows += len(features)
    if int(actual.argsort()[-1]) != int(expected.argsort()[-1]):
        mismatches.append({"view": i, "numpy": int(actual.argsort()[-1]), "torch": int(expected.argsort()[-1]), "error": error})

report = {"views": len(views), "candidateRows": rows, "maxAbsoluteQError": worst, "argmaxMismatches": mismatches, "torch": torch.__version__, "numpy": np.__version__}
(root / "numerics-results.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
assert not mismatches
assert worst < 1e-4
