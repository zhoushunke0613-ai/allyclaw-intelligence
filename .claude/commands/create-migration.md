---
description: Create a new D1 migration file with proper numbering and template
---

# Create Migration

为本项目生成一个新的 D1 schema migration 文件。

## 步骤

1. **检查当前 migration 编号**：
   ```bash
   ls migrations/ | sort | tail -5
   ```
   找到最大的 NNN 编号，新文件用 NNN+1。

2. **询问用户**：
   - 这次 migration 的目的（用于文件名描述部分）
   - 是创建新表 / 加字段 / 加索引 / 数据迁移

3. **创建文件**：`migrations/NNN_<描述>.sql`
   - 文件名 snake_case，描述简短
   - 例如：`migrations/003_add_skill_failure_tables.sql`

4. **文件模板**：
   ```sql
   -- Migration NNN: <人类可读描述>
   -- Created: YYYY-MM-DD
   -- Author: <name>
   -- Reason: <为什么需要这次变更>

   -- 必须幂等：使用 IF NOT EXISTS / IF EXISTS

   CREATE TABLE IF NOT EXISTS int_xxx (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       team_id TEXT NOT NULL,  -- 多租户必备
       created_at TEXT DEFAULT (datetime('now'))
   );

   CREATE INDEX IF NOT EXISTS idx_xxx_team ON int_xxx(team_id);
   ```

5. **检查清单**（每条都要满足）：
   - [ ] 表名 `int_` 前缀
   - [ ] 包含 `team_id` 或可推导的外键
   - [ ] 必要的 created_at / updated_at
   - [ ] 索引按 `database.md` 规则（≤ 5 个）
   - [ ] 所有 DDL 都用 `IF NOT EXISTS` / `IF EXISTS`
   - [ ] **不**触碰 Layer 0 表

6. **本地验证**：
   ```bash
   cd worker
   npx wrangler d1 execute allyclaw-db --local --file=../migrations/NNN_xxx.sql
   ```

7. **不自动应用到 remote**。Migration 上线由人工触发。

## 输出

完成后，告诉用户：
- 文件路径
- 应用到 remote 的命令（让用户复制执行）
- 是否需要更新 `docs/DATA-MODEL.md` 中的 schema 章节
