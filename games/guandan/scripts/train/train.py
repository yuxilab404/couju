"""
训练掼蛋局面估值网络（numpy 手写 MLP + Adam，不依赖深度学习框架）。
python3 -I train.py <隐藏层，如 128,64> <轮数> <输出 value-weights.ts> <数据文件...>
最后一个数据文件当验证集。特征缩放与 src/value.ts 的 SCALE 一致（从 scale.json 读，由 gen 脚本旁边的 dump 生成）。
"""
import base64, json, sys, time
import numpy as np

hidden = [int(x) for x in sys.argv[1].split(',')]
epochs = int(sys.argv[2])
out_file = sys.argv[3]
files = sys.argv[4:]
import os
scale = np.array(json.load(open(os.path.join(os.path.dirname(os.path.abspath(files[0])), 'scale.json'))), dtype=np.float32)
F = len(scale)

def load(f):
    raw = np.fromfile(f, dtype=np.uint8).reshape(-1, F + 1)
    x = raw[:, :F]
    y = raw[:, F].astype(np.int8).astype(np.float32)
    return x, y

parts = [load(f) for f in files[:-1]]
xtr = np.concatenate([p[0] for p in parts]); ytr = np.concatenate([p[1] for p in parts])
xva, yva = load(files[-1])
xva, yva = xva[:200000], yva[:200000]
print(f'训练 {len(ytr)}，验证 {len(yva)}，特征 {F}', flush=True)

rng = np.random.default_rng(0)
sizes = [F] + hidden + [1]
W = [rng.standard_normal((sizes[i], sizes[i + 1])).astype(np.float32) * np.sqrt(2 / sizes[i]) for i in range(len(sizes) - 1)]
B = [np.zeros(sizes[i + 1], dtype=np.float32) for i in range(len(sizes) - 1)]
mW = [np.zeros_like(w) for w in W]; vW = [np.zeros_like(w) for w in W]
mB = [np.zeros_like(b) for b in B]; vB = [np.zeros_like(b) for b in B]

def forward(x):
    acts = [x]
    for i in range(len(W)):
        z = acts[-1] @ W[i] + B[i]
        acts.append(np.maximum(z, 0) if i < len(W) - 1 else z)
    return acts

def predict(xb):
    out = []
    for i in range(0, len(xb), 65536):
        out.append(3 * np.tanh(forward(xb[i:i + 65536].astype(np.float32) * scale)[-1][:, 0]))
    return np.concatenate(out)

def report(tag):
    p = predict(xva)
    mse = float(np.mean((p - yva) ** 2)); base = float(np.var(yva))
    print(f'{tag} 验证 MSE {mse:.4f}（只猜平均值 {base:.4f}，解释了 {100 * (1 - mse / base):.1f}%）', flush=True)
    return mse

lr, bs, t = 1e-3, 512, 0
for ep in range(epochs):
    t0 = time.time()
    perm = rng.permutation(len(ytr))
    if ep == epochs - 1: lr *= 0.3
    for s in range(0, len(perm), bs):
        idx = perm[s:s + bs]
        x = xtr[idx].astype(np.float32) * scale; y = ytr[idx]
        acts = forward(x)
        th = np.tanh(acts[-1][:, 0]); pred = 3 * th
        g = (2 * (pred - y) / len(y) * 3 * (1 - th ** 2))[:, None]
        t += 1
        for i in reversed(range(len(W))):
            gW = acts[i].T @ g; gB = g.sum(0)
            if i > 0: g = (g @ W[i].T) * (acts[i] > 0)
            for P, G, M, V in ((W, gW, mW, vW), (B, gB, mB, vB)):
                M[i] = 0.9 * M[i] + 0.1 * G; V[i] = 0.999 * V[i] + 0.001 * G * G
                P[i] -= lr * (M[i] / (1 - 0.9 ** t)) / (np.sqrt(V[i] / (1 - 0.999 ** t)) + 1e-8)
    report(f'第 {ep + 1} 轮（{time.time() - t0:.0f}s）')

# 导出：每层按 [输出][输入] 展平，float32 小端 base64
layers = []
for w, b in zip(W, B):
    layers.append({'inp': w.shape[0], 'out': w.shape[1],
                   'w': base64.b64encode(np.ascontiguousarray(w.T).astype('<f4').tobytes()).decode(),
                   'b': base64.b64encode(b.astype('<f4').tobytes()).decode()})
with open(out_file, 'w') as f:
    f.write('/** 由 scripts/train/train.py 生成，不要手改。结构：' + ' → '.join(map(str, sizes)) + ' */\n')
    f.write('export const VALUE_WEIGHTS = ' + json.dumps(layers) + ';\n')
print('已写出', out_file)
