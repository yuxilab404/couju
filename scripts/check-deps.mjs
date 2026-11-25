#!/usr/bin/env node
/**
 * 依赖方向检查（ARCHITECTURE.md §2）。扫描每个包 src 下的 import，
 * 不在允许列表里的 @couju/* 依赖直接失败。测试文件同样检查。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/** 包目录 → 允许 import 的 @couju 包 */
const RULES = [
  { dir: 'sdk', allow: [] },
  { dir: 'protocol', allow: [] },
  { dir: 'server', allow: ['@couju/protocol'] },
  { dir: 'platform', allow: ['@couju/sdk', '@couju/protocol'] },
  { dir: 'games/_kit', allow: [] , each: true },
  { dir: 'games', allow: ['@couju/sdk', '@couju/kit-*'], each: true, skip: ['_kit'] },
  { dir: 'web', allow: ['@couju/platform', '@couju/sdk', '@couju/game-*'] },
];

/** 游戏模块禁止直接用的全局能力（规则必须确定性；画面可以用时钟） */
const GAME_RULE_BANNED = [/\bMath\.random\b/, /\bDate\.now\b/, /\bnew Date\(/, /\bfetch\(/, /\bWebSocket\b/];
const GAME_RULE_FILES = /(rules|patterns|cards|bot)\.ts$/;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function packages(rule) {
  const base = join(root, rule.dir);
  if (!rule.each) return [base];
  return readdirSync(base)
    .filter((n) => !(rule.skip ?? []).includes(n) && statSync(join(base, n)).isDirectory())
    .map((n) => join(base, n));
}

const allowed = (spec, allow) => allow.some((a) => (a.endsWith('*') ? spec.startsWith(a.slice(0, -1)) : spec === a || spec.startsWith(a + '/')));
const errors = [];

for (const rule of RULES) {
  for (const pkg of packages(rule)) {
    const src = join(pkg, 'src');
    let list;
    try { list = files(src); } catch { continue; }
    for (const f of list) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](@couju\/[^'"]+)['"]/g)) {
        const spec = m[1];
        const pkgName = spec.split('/').slice(0, 2).join('/');
        if (!allowed(pkgName, rule.allow)) errors.push(`${relative(root, f)}: 不允许依赖 ${pkgName}`);
      }
      // 游戏之间不互相引用：相对路径也不能跨出自己的包
      for (const m of text.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
        const target = join(f, '..', m[1]);
        if (!target.startsWith(pkg)) errors.push(`${relative(root, f)}: 相对路径跨出了包 ${relative(root, pkg)}`);
      }
      if (rule.dir === 'games' && GAME_RULE_FILES.test(f) && !f.endsWith('.test.ts')) {
        const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const re of GAME_RULE_BANNED) if (re.test(code)) errors.push(`${relative(root, f)}: 规则代码不能用 ${re.source}`);
      }
    }
  }
}

if (errors.length) {
  console.error('依赖方向检查失败：\n' + errors.map((e) => '  ' + e).join('\n'));
  process.exit(1);
}
console.log('依赖方向检查通过');
