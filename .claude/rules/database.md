# Database Rules (D1)

## 表命名

- 所有新表必须 `int_` 前缀（参考 DECISIONS §5）
- 表名 snake_case，复数（`int_skills`、`int_optimization_suggestions`）
- Junction 表用 `int_<a>_<b>`（如 `int_server_team_map`）

## Schema 变更

- **绝不直接改 D1 远程库**，必须走 `migrations/NNN_xxx.sql` 文件
- migration 文件按 `001_`, `002_`, ... 顺序编号
- 每个 migration 文件必须**幂等**（`CREATE TABLE IF NOT EXISTS`、`ALTER TABLE` 加列）
- 部署流程：
  ```bash
  npx wrangler d1 execute allyclaw-db --local --file=migrations/NNN_xxx.sql   # 本地试
  npx wrangler d1 execute allyclaw-db --remote --file=migrations/NNN_xxx.sql  # 上线
  ```

## 字段约定

每张表必须有：

- `created_at TEXT DEFAULT (datetime('now'))` — 创建时间
- 多租户表必须有 `team_id TEXT` 或可推导出 `team_id` 的外键

不要：

- ❌ 不要用 `INTEGER` 存时间戳（D1 上 TEXT ISO 8601 更易读 + 直接 datetime 函数操作）
- ❌ 不要用浮点存金额（用 `INTEGER` 存最小货币单位，如分）
- ❌ 不要在 Layer 0 表（`servers` / `sessions` / `messages` / `question_stats` / `sync_state`）上加任何字段或索引

## 索引策略

- 每张表索引 ≤ 5 个
- 写入压力大的表（`int_execution_events`）只索引必查路径
- 用 partial index 优化稀疏查询：`CREATE INDEX ... WHERE status = 'open'`

## 查询

- 跨团队查询必须显式带 team_id 过滤（除非 admin 接口）
- 大表查询必须 `EXPLAIN QUERY PLAN` 验证走索引
- 不写 `SELECT *`，列名显式列出
- 分页用 `LIMIT/OFFSET`（D1 没有 keyset 优化）

## Append-only 表

以下表**只追加，不 UPDATE**：

- `int_execution_events`
- `int_optimization_actions`
- `int_taxonomy_rules_history`
- `int_audit_log`
- `int_skill_versions`
- `int_skill_failures`
- `int_skill_regression_runs`

需要"状态变化"时建子表或加 `*_history` 表，**不要覆盖原值**。
