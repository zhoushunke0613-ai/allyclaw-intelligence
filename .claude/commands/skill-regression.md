---
description: Run regression tests for a skill before upgrade
---

# Skill Regression

为某个 skill 跑回归测试集（Golden Questions），评估升级是否安全。

## 用法

`/project:skill-regression <skill_id> [target_version]`

例如：
- `/project:skill-regression attribuly_metrics`
- `/project:skill-regression attribuly_metrics v1.2.0`

## 步骤

1. **加载 Golden Questions**：
   ```sql
   SELECT * FROM int_skill_golden_questions
   WHERE skill_id = ? AND active = 1;
   ```
   如果数量 < 5，警告用户测试集不足。

2. **创建 regression run 记录**：
   ```sql
   INSERT INTO int_skill_regression_runs (skill_id, skill_version, triggered_by, started_at, total_questions)
   VALUES (?, ?, 'pre_upgrade', datetime('now'), ?);
   ```

3. **逐个执行测试**：
   - 对每个 GQ：
     - 把 question 发到测试环境的 skill（如果没有 staging，跳过实际调用，仅做静态检查）
     - 对比实际 chain vs `expected_chain_json`
     - 对比实际 output schema vs `expected_schema_json`
     - 验证 `validation_rules_json` 中的规则
     - 检查 `duration_ms <= max_duration_ms`
     - 检查 `tokens <= max_tokens`
   - 记录 pass / fail / error

4. **更新 GQ 表**：
   ```sql
   UPDATE int_skill_golden_questions
   SET last_run_at = ?, last_status = ?
   WHERE gq_id = ?;
   ```

5. **完成 regression run**：
   ```sql
   UPDATE int_skill_regression_runs
   SET pass_count = ?, fail_count = ?, error_count = ?,
       pass_rate = ?, completed_at = datetime('now'),
       failed_gq_ids = ?,
       blocked_upgrade = CASE WHEN pass_rate < 0.95 THEN 1 ELSE 0 END
   WHERE run_id = ?;
   ```

6. **输出报告**：
   ```
   Regression Result for <skill_id>@<version>
   ─────────────────────────────────────────
   Total: 24 questions
   Passed: 22 (91.7%)
   Failed: 2
   Errors: 0

   Failed cases:
   - GQ-attribuly-metrics-007: schema_drift (missing 'currency' field)
   - GQ-attribuly-metrics-019: timeout (4200ms > 2000ms limit)

   ⚠️ Pass rate < 95%, upgrade BLOCKED.
   Fix failures before re-running.
   ```

## 失败处置

- pass_rate ≥ 95%：通过，可以升级
- pass_rate < 95%：阻止升级，报告失败 case
- 任何 case 是 `error`（非 fail）：调查是否是测试基础设施问题

## 关联建议

如果 regression 失败，自动创建一条 `optimization_suggestion`：

```typescript
{
  type: 'skill_regression_failure',
  title: `Skill ${skill_id} regression failed at ${pass_rate}`,
  priority: 'P1',
  track: 'manual',
  evidence: failed_gq_ids,
}
```

让维护者必须处理。
