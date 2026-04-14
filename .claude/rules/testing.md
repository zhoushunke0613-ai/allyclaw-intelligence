# Testing Rules

## 测试范围

MVP 阶段不要求高覆盖率，但**关键边界必须有测试**：

- LLM Adapter（mock provider，验证 retry / 错误转换）
- Schema migrations（apply + rollback）
- 优化建议生成的核心算法
- KPI 计算函数（容易因边界条件出错）

## 测试金字塔

```
        E2E (少)
      ↑
    Integration (中)
  ↑
Unit (多)
```

- Unit：纯函数、工具、计算逻辑
- Integration：API 路由（用 wrangler 本地 D1）
- E2E：关键用户路径（建议工作台、报告查看）

## 工具

- Worker 单测：Vitest + `@cloudflare/workers-types`
- 前端单测：Vitest + React Testing Library
- E2E：Playwright（部署后跑）

## 测试命名

```typescript
describe('LLMClassifier', () => {
  describe('classify()', () => {
    it('returns category with confidence > 0.8 for clear questions', () => { ... })
    it('falls back to "general" when LLM returns invalid category', () => { ... })
    it('throws LLMError(rate_limit) on 429 response', () => { ... })
  })
})
```

不写 "should" / "test that"，直接陈述行为。

## Skill 回归测试（特殊）

参考 PRD §16.4.10：

- 每个 active skill 在 `int_skill_golden_questions` 表中维护测试集
- 升级前必跑：`scripts/run-skill-regression.ts <skill_id> <new_version>`
- 失败时自动阻止升级 PR 合并

## CI

- PR 必须跑：`npm run lint && npm run build && npm run test`
- 主分支合并后自动部署到 staging（如有）
- 生产部署需要手动 approve

## Mock 数据

- 测试 fixtures 放在 `worker/test/fixtures/`
- 不要 mock D1 — 用 wrangler 的本地 D1（`--local`）跑真实 SQL
- LLM 必须 mock（成本和确定性考虑）
