"""用公开历史重放上游通知状态机，对照无状态重建的 567 维特征。"""
import json
from pathlib import Path

import numpy as np
import worker

root = worker.LAB
entries = json.loads((root / "replay-fixtures.json").read_text())
reports = []
for entry in entries:
    final = entry["v"]
    me = final["me"]
    original = worker.DanzeroAgent(me, np.random.RandomState(0))
    captures = []
    original.action.step = lambda state: (captures.append(state["x_batch"].copy()) or 0)
    counts = [27] * 4
    finished = []
    for i, action in enumerate(final["history"]):
        if action["seat"] == me:
            current = dict(final)
            current["history"] = final["history"][:i]
            current["counts"] = list(counts)
            current["finished"] = list(finished)
            current["hand"] = list(final["hand"])
            for future in final["history"][i:]:
                if future["seat"] == me and future["cards"]:
                    current["hand"].extend(future["cards"])
            dummy = [["Single", "2", [worker.face(current["hand"][0])]], ["PASS", "PASS", "PASS"]]
            original.step(worker.build_state(current, dummy))
        if action["cards"]:
            counts[action["seat"]] -= len(action["cards"])
            if counts[action["seat"]] == 0:
                finished.append(action["seat"])
    fresh = worker.player(final)
    actions = worker.GuandanJudger.playable_actions_from_hand(fresh.current_hand, final["level"] - 2)
    actions = actions[:2] if len(actions) >= 2 else actions * 2
    original.step(worker.build_state(final, actions))
    expected = captures[-1]
    worker.rebuild_public_features(fresh, final)
    actual = fresh.prepare(fresh.parse(worker.build_state(final, actions)))["x_batch"]
    changed = np.flatnonzero(np.any(expected != actual, axis=0)).tolist()
    reports.append({"historyLength": len(final["history"]), "me": me, "changedColumns": changed})
report = {"views": len(reports), "matchingViews": sum(not x["changedColumns"] for x in reports), "results": reports}
(root / "features-results.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
assert report["matchingViews"] == report["views"], "Public reconstruction must match upstream's full 567-dimensional observation"
