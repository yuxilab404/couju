---
name: pr-closeout
description: 当任务提到 PR、合并或"收口"时使用。先区分无实际 PR 工作、只读检查/讨论与已授权收口；只在用户明确要求合并/收口时持续到合并，不负责找新需求或扩大设计。
argument-hint: "[PR 或分支，可选]"
---

# PR Closeout（Claude Code 兼容入口）

本 skill 的 canonical 内容维护在 [`../../../.agents/skills/pr-closeout/SKILL.md`](../../../.agents/skills/pr-closeout/SKILL.md)。请完整读取并执行该文件；它不依赖其它运行时文档。

> `.agents/skills/` 是仓库级 agent-agnostic canonical；`.claude/skills/` 只负责 Claude Code 自动发现，不复制正文。修改时先改 canonical，再同步本 stub 的 frontmatter description。
