---
description: Safely evolve D1 schema with migration, doc sync, and rollout
---

# Schema Evolution

需要修改数据模型时（加表、加列、加索引）的标准流程。**所有 schema 变更必须走这个 skill**。

## 触发场景

- 用户说 "加一个表"、"扩展 schema"、"加字段"
- 实现新功能时发现现有表不够用

## 严格遵守的约束

1. ❌ 不修改 Layer 0 表（`servers`、`sessions`、`messages`、`question_stats`、`sync_state`）
2. ❌ 不 DROP 表 / 列
3. ❌ 不直接在 D1 远程库改 schema
4. ✅ 所有变更走 migration 文件，按 NNN 编号
5. ✅ 必须同步更新 `docs/DATA-MODEL.md`

## 工作流

### 阶段 1：设计

1. **明确变更目的**：
   - 为什么需要？关联哪个 PRD 章节 / suggestion？
   - 是否真的需要新表，还是现有表加字段就够？

2. **检查 DECISIONS.md**：
   - 命名规范（`int_` 前缀）
   - 多租户约束（`team_id`）
   - Append-only 约定

3. **写出 schema**：
   - SQL DDL 草稿
   - 索引列表（理由）
   - 字段语义说明

### 阶段 2：评审

让用户 review 草稿 schema。必须 review 通过才进入阶段 3。Review 关注点：

- 命名是否合规？
- 字段类型是否合适？
- 索引是否过多 / 缺失？
- 是否会和现有表冲突？

### 阶段 3：实现

1. **创建 migration**：调用 `/project:create-migration` command
2. **本地应用**：
   ```bash
   npx wrangler d1 execute allyclaw-db --local --file=migrations/NNN_xxx.sql
   ```
3. **本地验证**：
   ```bash
   npx wrangler d1 execute allyclaw-db --local --command "PRAGMA table_info(int_xxx)"
   ```

### 阶段 4：文档同步

更新 `docs/DATA-MODEL.md`：
- 在对应 Layer 章节加表定义
- 如果改了已有表，更新原表说明
- 在 §14 Migration 计划中记录这次变更属于哪个 Phase

### 阶段 5：上线

```bash
npx wrangler d1 execute allyclaw-db --remote --file=migrations/NNN_xxx.sql
```

**注意**：
- 上线前务必通知（同库共享，会影响 context-dashboard）
- 上线后立即验证 D1 状态
- 部署对应的 Worker 代码（如有）

### 阶段 6：监控

上线后 24 小时内检查：
- 是否有写入失败的日志
- 索引是否被实际使用（EXPLAIN QUERY PLAN）
- D1 容量增长是否符合预期

## 输出

完成后给用户：
- migration 文件路径
- 远程应用命令
- DATA-MODEL.md 更新摘要
- 后续监控提醒
