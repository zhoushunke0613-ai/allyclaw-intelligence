---
description: Comprehensive pre-release checklist before deploying to production
---

# Pre-Release Check

部署到生产前的最后检查。**不要跳步**。

## 触发场景

- 用户说 "上线"、"发布"、"部署到生产"、"pre-release"
- 任何 `wrangler deploy` 之前

## 检查清单（13 项）

### 代码质量

- [ ] 1. TypeScript 编译通过（`cd worker && npm run build`）
- [ ] 2. ESLint 无 error（`npm run lint`，warning 可暂留）
- [ ] 3. 测试通过（`npm run test`）
- [ ] 4. 没有 console.log 残留（生产代码用 logger）
- [ ] 5. 没有 TODO 标记 P0/P1 任务待完成

### Schema & 数据

- [ ] 6. 所有 migration 已应用到 remote D1（用 PRAGMA 确认）
- [ ] 7. DECISIONS.md 中的约定都满足（int_ 前缀、team_id、append-only）
- [ ] 8. 没有 DROP / RENAME 操作

### 业务逻辑

- [ ] 9. 自主优化代码有 audit log + rollback 路径
- [ ] 10. LLM 调用全部经过 Adapter（grep 没有 `import Anthropic` / `import OpenAI`）
- [ ] 11. 错误处理：边界 try/catch + LLMError 转换

### 文档

- [ ] 12. 涉及新功能的，PRD / DATA-MODEL 已更新
- [ ] 13. CHANGELOG.md 加入本次变更摘要

## 验证脚本

依次跑：

```bash
# 1. 编译
cd worker && npm run build

# 2. 测试（如配置）
npm run test

# 3. 检查危险 import
grep -r "from '@anthropic-ai/sdk'" worker/src/routes/ worker/src/jobs/
grep -r "from 'openai'" worker/src/routes/ worker/src/jobs/
# ↑ 这两条应该没结果（只能在 worker/src/llm/ 里出现）

# 4. 检查 console
grep -rn "console.log" worker/src/

# 5. 检查 schema 同步状态
npx wrangler d1 execute allyclaw-db --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'int_%' ORDER BY name"
# 对照 docs/DATA-MODEL.md 查缺漏
```

## 失败处置

- 任何一项失败 → **不部署**，先修
- 不要跳过任何一项
- 如果某项确实可以暂时放过，必须在 `docs/known-issues.md` 记录

## 部署后立即做

1. `wrangler tail` 看 30-60 秒日志
2. 关键 endpoint smoke test
3. 在团队渠道发布部署通知（包含版本号、变更摘要）

## 输出

完成后告诉用户：
- 13 项检查的逐项结果
- 任何阻塞 / 警告
- 是否可以继续部署
