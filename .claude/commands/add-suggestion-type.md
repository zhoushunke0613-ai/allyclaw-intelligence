---
description: Add a new optimization suggestion type with full integration
---

# Add Suggestion Type

为本项目新增一种 `optimization_suggestions.type`，并把所有相关代码都串起来。

## 适用场景

当你发现新的优化方向（比如想加 `cache_warming`、`prompt_compression` 这种之前没有的类型），用这个命令系统化落地。

## 步骤

1. **询问用户**：
   - 类型 ID（snake_case，如 `cache_warming`）
   - 中文说明
   - track：`autonomous` / `manual` / `both`
   - 触发逻辑（什么场景下应该生成这种建议？）
   - 优化动作（落地时要做什么？）

2. **更新文档**：
   - 在 `docs/PRD.md` §11 人工优化机制（如果是 manual track）或 §10 自主优化（如果是 autonomous）的列表中加一行
   - 在 `docs/DATA-MODEL.md` 中 `int_optimization_suggestions.type` 的注释里补充

3. **生成检测器代码**：
   在 `worker/src/jobs/detectors/<type>.ts` 创建检测器：
   ```typescript
   export async function detect<TypeName>(env: Env): Promise<NewSuggestion[]> {
     // 1. 查 D1，找出符合触发条件的 session/skill/api
     // 2. 为每个发现生成 suggestion + evidence
     // 3. 返回待写入的建议列表
   }
   ```

4. **注册到主 detector loop**：
   `worker/src/jobs/discover-suggestions.ts` 中加入新 detector

5. **如果是 autonomous track**，还需要：
   - 在 `worker/src/jobs/apply-autonomous.ts` 中实现 apply 函数
   - 实现回滚函数
   - 写到 `int_optimization_actions` 的逻辑

6. **添加 LLM prompt**（如果建议描述需要 LLM 生成）：
   - `worker/src/prompts/<type>-suggestion.ts`

7. **加测试**：
   `worker/test/jobs/detectors/<type>.test.ts`

8. **更新前端**（如果工作台要展示）：
   - `frontend/src/lib/suggestion-types.ts` 中加入显示标签和颜色

## 检查清单

- [ ] PRD 已更新（保持文档与代码同步）
- [ ] 检测器有单元测试
- [ ] 如果 autonomous，有 apply + rollback 函数
- [ ] 如果 autonomous，apply 逻辑有审计日志写入
- [ ] 前端能正确显示新类型

## 输出

完成后总结：
- 新增的文件列表
- 新的 detector 触发频率（cron schedule）
- 是否需要 backfill 历史数据
