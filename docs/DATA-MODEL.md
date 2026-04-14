# AllyClaw Intelligence — 数据模型详细设计

> 配套文档：[PRD.md](./PRD.md)
> 版本：v0.1
> 存储：Cloudflare D1 (SQLite)

---

## 1. 设计原则

在开始具体表设计前，先明确六个原则。这些原则决定了后面每个字段、每个索引的取舍。

### 1.1 复用而非重造

`allyclaw-context-dashboard` 已有的数据表（`servers`、`sessions`、`messages`、`question_stats`、`sync_state`）**直接复用**，不复制、不迁移。Intelligence 层通过外键（`server_id`、`session_id`）引用它们。

### 1.2 分层隔离

数据按"加工程度"分 7 层，每层只依赖下面几层：

```
Layer 7  审计与访问控制（只读、append-only）
Layer 6  报告与快照（物化视图）
Layer 5  优化生命周期（业务核心）
Layer 4  模式与洞察（挖掘结果）
Layer 3  分类与标签（可变规则）
Layer 2  执行事件（不可变原始记录）
Layer 1  团队与富化（基础实体）
Layer 0  现有 context-dashboard 表（只读）
```

### 1.3 Append-only 优先

事件、审计、执行动作等表**只追加不更新**。需要"状态变化"时用 `status_history` 子表或 `status_changed_at` 字段，不覆盖原值。

> 理由：D1 没有回滚快照，数据一旦被 UPDATE 就回不来了。审计场景必须保留历史。

### 1.4 多租户硬隔离

**每张表都带 `team_id` 或可推导出 `team_id` 的外键**。所有查询必须带 team_id 过滤（除非 admin 角色）。团队间数据默认不可见。

### 1.5 幂等可重入

所有写入（ingest、分类、建议生成）都是幂等的：
- 用业务主键 + `ON CONFLICT` upsert
- 或用 (source_id, hash) 唯一索引去重

这让重建、补数据、灾难恢复都安全。

### 1.6 延迟物化

热路径（Dashboard 实时查询）走物化表（`daily_metrics`、`team_snapshots`），冷路径（深度分析）实时 JOIN。
写入成本换读取性能，避免每次点 Dashboard 都扫全表。

---

## 2. 分层概览

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 0: allyclaw-context-dashboard（只读复用）               │
│  servers · sessions · messages · question_stats · sync_state │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Layer 1: 基础实体                                             │
│  teams · server_team_map · sessions_enriched                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Layer 2: 执行事件（append-only）                              │
│  execution_events · execution_chains                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Layer 3: 分类与标签（版本化）                                  │
│  taxonomy_categories · taxonomy_rules · taxonomy_rules_history│
│  question_classifications · session_tags                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Layer 4: 模式与洞察                                           │
│  call_patterns · pattern_instances · failure_clusters        │
│  anomaly_signals                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Layer 5: 优化生命周期                                         │
│  optimization_suggestions · suggestion_evidence              │
│  suggestion_comments · optimization_actions                  │
│  optimization_experiments · experiment_results               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Layer 6: 报告与快照（物化）                                    │
│  daily_metrics · team_snapshots · reports · report_deliveries│
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Layer 7: 审计与访问控制                                        │
│  audit_log · access_log · users · roles · role_permissions   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1：基础实体

### 3.1 `teams`

团队主表。`team_id` 是整个 Intelligence 层的主要租户维度。

```sql
CREATE TABLE teams (
    team_id       TEXT PRIMARY KEY,           -- 业务键，如 't100108'
    team_name     TEXT NOT NULL,
    tier          TEXT DEFAULT 'basic',       -- basic / pro / enterprise
    status        TEXT DEFAULT 'active',      -- active / paused / churned
    onboarded_at  TEXT NOT NULL,
    primary_contact TEXT,
    attribuly_key_fingerprint TEXT,           -- sha256(api_key)[:16]，不存明文
    metadata_json TEXT,                       -- 扩展字段
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);
```

**设计说明**：
- `team_id` 用业务键（如腾讯云 team_id）而非 UUID — 方便与外部系统对账
- `attribuly_key_fingerprint` 只存哈希指纹，原始 key 永不入库
- `metadata_json` 留给未来扩展，避免频繁 schema 迁移

### 3.2 `server_team_map`

服务器到团队的映射。一个 server 属于一个 team，但一个 team 可有多个 server。

```sql
CREATE TABLE server_team_map (
    server_id     TEXT PRIMARY KEY,           -- 来自 allyclaw-context-dashboard.servers.id
    team_id       TEXT NOT NULL REFERENCES teams(team_id),
    role          TEXT DEFAULT 'production',  -- production / staging / test
    mapped_at     TEXT DEFAULT (datetime('now')),
    unmapped_at   TEXT                        -- NULL 表示当前有效
);

CREATE INDEX idx_stm_team ON server_team_map(team_id) WHERE unmapped_at IS NULL;
```

**设计说明**：
- `unmapped_at` 允许历史轨迹：某台机器曾经属于 team A，后来迁移到 team B
- 查"当前有效映射"用 `WHERE unmapped_at IS NULL`

### 3.3 `sessions_enriched`

对 `sessions` 的派生分析，一对一。**异步写入**，不阻塞采集。

```sql
CREATE TABLE sessions_enriched (
    session_id       TEXT NOT NULL,
    server_id        TEXT NOT NULL,
    team_id          TEXT NOT NULL,

    -- 问题特征
    primary_l1       TEXT,                    -- 一级分类
    primary_l2       TEXT,                    -- 二级分类
    primary_intent   TEXT,                    -- diagnosis / comparison / report / config / how-to
    entities_json    TEXT,                    -- 提取的实体（渠道、时间、metric 名）
    complexity       REAL,                    -- 0-1
    is_followup      INTEGER DEFAULT 0,       -- 是否追问（非 session 首条）

    -- 结果特征
    success_label    TEXT,                    -- success / partial / failure / refuse / unknown
    success_conf     REAL,                    -- 判定置信度 0-1
    user_sentiment   TEXT,                    -- positive / neutral / negative / frustrated
    has_followup     INTEGER DEFAULT 0,       -- 用户后续有追问
    repeated_question INTEGER DEFAULT 0,      -- 7 天内问过相同问题

    -- 执行特征
    skill_call_count INTEGER DEFAULT 0,
    api_call_count   INTEGER DEFAULT 0,
    tool_call_count  INTEGER DEFAULT 0,
    total_duration_ms INTEGER,
    error_count      INTEGER DEFAULT 0,

    -- 元信息
    enrichment_version TEXT,                  -- 富化算法版本，如 'v1.2'
    enriched_at      TEXT DEFAULT (datetime('now')),

    PRIMARY KEY (session_id, server_id)
);

CREATE INDEX idx_se_team_time ON sessions_enriched(team_id, enriched_at DESC);
CREATE INDEX idx_se_l1_success ON sessions_enriched(primary_l1, success_label);
CREATE INDEX idx_se_failure ON sessions_enriched(success_label) WHERE success_label IN ('failure', 'refuse');
```

**设计说明**：
- **不修改原 `sessions` 表**，所有派生字段独立 → 可随时重算
- `enrichment_version` 让你知道哪些行是旧版本分析，可按需重跑
- 部分索引（`WHERE success_label IN ...`）专为失败会话查询优化 — D1 支持

### 3.4 `messages_enriched`（可选，按需启用）

如果 L3 问题分类需要 message 级细节（而不只是 session 级），再建此表。MVP 阶段不建议用。

---

## 4. Layer 2：执行事件（append-only）

### 4.1 `execution_events`

每次 skill 调用、API 请求、tool 调用都产生一个事件。**不可变**，永不 UPDATE。

```sql
CREATE TABLE execution_events (
    event_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT NOT NULL,
    server_id        TEXT NOT NULL,
    team_id          TEXT NOT NULL,
    message_id       INTEGER,                 -- 关联 messages.id（可能为 NULL）
    parent_event_id  INTEGER,                 -- 父事件（skill 调了 api 就指向 skill 事件）

    event_type       TEXT NOT NULL,           -- skill_call / api_call / tool_call / cache_hit / fallback / error
    event_name       TEXT NOT NULL,           -- 如 'attribuly_metrics' / '/api/v1/campaigns'

    params_hash      TEXT,                    -- 请求参数 hash（用于查重复）
    params_preview   TEXT,                    -- 参数摘要（脱敏后，< 500 字符）

    status           TEXT,                    -- success / timeout / error / degraded / partial
    error_code       TEXT,
    error_preview    TEXT,                    -- 错误信息摘要

    duration_ms      INTEGER,
    input_tokens     INTEGER,
    output_tokens    INTEGER,
    cache_hit        INTEGER DEFAULT 0,

    started_at       TEXT NOT NULL,
    ended_at         TEXT,

    ingested_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_ee_session ON execution_events(session_id, server_id, started_at);
CREATE INDEX idx_ee_team_time ON execution_events(team_id, started_at DESC);
CREATE INDEX idx_ee_type_name ON execution_events(event_type, event_name);
CREATE INDEX idx_ee_failures ON execution_events(status) WHERE status IN ('error', 'timeout');
CREATE INDEX idx_ee_dedup ON execution_events(session_id, params_hash) WHERE params_hash IS NOT NULL;
```

**设计说明**：
- `parent_event_id` 让父子调用形成树，可还原完整调用链
- `params_hash` 是判断"重复调用"的核心（相同 session、相同 hash → 冗余）
- `params_preview` 只存摘要用于调试，不存完整 payload（省空间 + 保护隐私）
- **没有 `updated_at`**：任何变化都是新事件

### 4.2 `execution_chains`

对一个 message，聚合其完整调用链成为一个"链 snapshot"。方便快速查询"这个问题调了哪些东西"。

```sql
CREATE TABLE execution_chains (
    chain_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT NOT NULL,
    server_id        TEXT NOT NULL,
    team_id          TEXT NOT NULL,
    message_id       INTEGER NOT NULL,

    chain_signature  TEXT NOT NULL,           -- 链指纹，用于模式匹配
    chain_json       TEXT NOT NULL,           -- 完整链结构 JSON
    event_count      INTEGER NOT NULL,
    unique_skills    INTEGER,
    unique_apis      INTEGER,
    total_duration_ms INTEGER,

    success          INTEGER,                 -- 0/1 整条链是否成功
    anti_pattern_ids TEXT,                    -- CSV of matched anti-pattern IDs

    built_at         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_ec_session ON execution_chains(session_id, message_id);
CREATE INDEX idx_ec_signature ON execution_chains(chain_signature);
CREATE INDEX idx_ec_team_time ON execution_chains(team_id, built_at DESC);
```

**设计说明**：
- `chain_signature` 是把链上事件名按顺序拼起来的哈希（如 `sha256("skill:metrics→api:/v1/daily→skill:synth")[:12]`）
- 有了 signature 可以 `GROUP BY chain_signature` 快速发现常见模式
- `chain_json` 是冗余存储，方便直接展示链路图（避免反向从 events 聚合）

---

## 5. Layer 3：分类与标签（版本化）

### 5.1 `taxonomy_categories`

L1/L2 分类字典。

```sql
CREATE TABLE taxonomy_categories (
    category_id   TEXT PRIMARY KEY,           -- 如 'L1.data_overview' / 'L2.revenue_drop'
    level         INTEGER NOT NULL,           -- 1 or 2
    parent_id     TEXT REFERENCES taxonomy_categories(category_id),
    name          TEXT NOT NULL,
    description   TEXT,
    color         TEXT,                       -- UI 显示颜色
    active        INTEGER DEFAULT 1,
    sort_order    INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);
```

**设计说明**：
- 一级和二级用同一张表，`level` 区分
- `active=0` 表示已废弃（不删除，保留历史归因）

### 5.2 `taxonomy_rules`

分类规则（关键词、正则、LLM prompt 片段）。**支持版本化**。

```sql
CREATE TABLE taxonomy_rules (
    rule_id       TEXT PRIMARY KEY,           -- 如 'R-2026-0414-001'
    category_id   TEXT NOT NULL REFERENCES taxonomy_categories(category_id),
    rule_type     TEXT NOT NULL,              -- keyword / regex / llm_prompt / embedding_ref
    rule_content  TEXT NOT NULL,              -- 规则内容（关键词 CSV / 正则 / prompt）
    priority      INTEGER DEFAULT 0,          -- 优先级（高优先级先匹配）
    version       INTEGER DEFAULT 1,
    active        INTEGER DEFAULT 1,

    created_by    TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    deprecated_at TEXT                        -- NULL 表示当前有效
);

CREATE INDEX idx_tr_active ON taxonomy_rules(active, priority DESC) WHERE active = 1;
CREATE INDEX idx_tr_category ON taxonomy_rules(category_id);
```

### 5.3 `taxonomy_rules_history`

规则变更历史（append-only，审计用）。

```sql
CREATE TABLE taxonomy_rules_history (
    history_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id       TEXT NOT NULL,
    version       INTEGER NOT NULL,
    operation     TEXT NOT NULL,              -- create / update / deprecate / reactivate
    diff_json     TEXT,                       -- 变更内容
    changed_by    TEXT,
    changed_at    TEXT DEFAULT (datetime('now')),
    change_reason TEXT                        -- 关联 suggestion_id 或人工说明
);
```

### 5.4 `question_classifications`

每个 session 的分类结果。一个 session 可以命中多个分类（多标签）。

```sql
CREATE TABLE question_classifications (
    classification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL,
    server_id     TEXT NOT NULL,
    team_id       TEXT NOT NULL,

    category_id   TEXT NOT NULL REFERENCES taxonomy_categories(category_id),
    is_primary    INTEGER DEFAULT 0,          -- 是否主分类（每 session 至多 1 个 primary）
    confidence    REAL,
    method        TEXT NOT NULL,              -- rule / llm_haiku / llm_sonnet / human

    rule_id       TEXT,                       -- 如果是 rule 方法
    model_version TEXT,                       -- 如果是 llm 方法

    classified_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_qc_session ON question_classifications(session_id, server_id);
CREATE INDEX idx_qc_team_category ON question_classifications(team_id, category_id);
CREATE INDEX idx_qc_primary ON question_classifications(category_id) WHERE is_primary = 1;
```

**设计说明**：
- 分类是**可重做**的：如果规则更新了，可以重跑分类，写入新记录
- 用 `method` + `model_version` 标记来源，方便对比不同分类器的效果

### 5.5 `session_tags`

自由标签，灵活标注（不走分类体系）。

```sql
CREATE TABLE session_tags (
    session_id    TEXT NOT NULL,
    server_id     TEXT NOT NULL,
    tag           TEXT NOT NULL,
    tagged_by     TEXT,                       -- system / user_id
    tagged_at     TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, server_id, tag)
);

CREATE INDEX idx_st_tag ON session_tags(tag);
```

常见标签：`high_value`、`needs_review`、`a_b_test_group_a`、`contains_pii`、`golden_example`。

---

## 6. Layer 4：模式与洞察

### 6.1 `call_patterns`

挖掘出的调用模式（黄金路径、反模式）。

```sql
CREATE TABLE call_patterns (
    pattern_id       TEXT PRIMARY KEY,        -- 'GP-revenue-diag-v1' / 'AP-skip-channels-v1'
    pattern_kind     TEXT NOT NULL,           -- golden_path / anti_pattern / neutral
    category_id      TEXT REFERENCES taxonomy_categories(category_id),
    signature_pattern TEXT NOT NULL,          -- 序列模式（支持通配符），如 'metrics→*→campaigns'
    description      TEXT,

    sample_count     INTEGER,                 -- 挖掘时的样本数
    success_rate     REAL,                    -- 命中该模式的会话成功率
    avg_duration_ms  INTEGER,
    avg_token_cost   INTEGER,

    discovered_at    TEXT,
    last_seen_at     TEXT,
    active           INTEGER DEFAULT 1
);

CREATE INDEX idx_cp_kind ON call_patterns(pattern_kind, active);
```

### 6.2 `pattern_instances`

每个 chain 命中的 pattern 记录。

```sql
CREATE TABLE pattern_instances (
    instance_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id      INTEGER NOT NULL REFERENCES execution_chains(chain_id),
    pattern_id    TEXT NOT NULL REFERENCES call_patterns(pattern_id),
    team_id       TEXT NOT NULL,
    matched_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_pi_pattern ON pattern_instances(pattern_id, matched_at DESC);
CREATE INDEX idx_pi_team ON pattern_instances(team_id, pattern_id);
```

### 6.3 `failure_clusters`

相似失败会话的聚类（用于归因）。

```sql
CREATE TABLE failure_clusters (
    cluster_id       TEXT PRIMARY KEY,
    cluster_name     TEXT,                    -- 人类可读标签，如 'Missing conversion tracking'
    category_id      TEXT REFERENCES taxonomy_categories(category_id),
    root_cause       TEXT,
    sample_session_ids TEXT,                  -- CSV of representative sessions
    session_count    INTEGER,
    first_seen_at    TEXT,
    last_seen_at     TEXT,
    trend            TEXT,                    -- increasing / stable / decreasing / new
    status           TEXT DEFAULT 'open'      -- open / linked_to_suggestion / resolved
);
```

### 6.4 `anomaly_signals`

系统运行时检测到的异常信号（响应突然变慢、某 skill 失败率飙升等）。

```sql
CREATE TABLE anomaly_signals (
    signal_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id       TEXT,                       -- NULL 表示全局
    signal_type   TEXT NOT NULL,              -- latency_spike / error_surge / token_blowup / drop
    subject_type  TEXT,                       -- skill / api / pattern / overall
    subject_id    TEXT,
    severity      TEXT,                       -- P0 / P1 / P2
    baseline_value REAL,
    observed_value REAL,
    deviation_pct REAL,
    window_start  TEXT,
    window_end    TEXT,
    detected_at   TEXT DEFAULT (datetime('now')),
    acknowledged_at TEXT,
    resolved_at   TEXT
);

CREATE INDEX idx_as_unresolved ON anomaly_signals(detected_at DESC) WHERE resolved_at IS NULL;
```

---

## 6.5 Skill 注册与版本管理（重要补充）

> Skill 是回答质量的根本上游。本节专门定义 skill 的注册、版本、指标追踪表。

### 6.5.1 `int_skills`

Skill 注册表。一个 skill 一行（如 `attribuly_metrics`、`attribuly_attribution`）。

```sql
CREATE TABLE int_skills (
    skill_id         TEXT PRIMARY KEY,        -- 'attribuly_metrics' 等业务键
    display_name     TEXT NOT NULL,
    description      TEXT,
    source           TEXT,                    -- clawhub_url / internal / community
    source_url       TEXT,
    current_version  TEXT,                    -- 当前生效版本
    category         TEXT,                    -- attribution / metrics / diagnose / report 等
    status           TEXT DEFAULT 'active',   -- active / deprecated / experimental
    owner            TEXT,                    -- 维护者
    first_seen_at    TEXT,                    -- 首次被调用的时间
    registered_at    TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_skills_status ON int_skills(status);
CREATE INDEX idx_skills_category ON int_skills(category);
```

**设计说明**：
- `skill_id` 是业务键，与 OpenClaw JSONL 中 `skill_name` 一致
- 自动发现：执行事件中遇到新 skill 时自动 INSERT 一行（`status='experimental'`），人工 review 后改为 `active`

### 6.5.2 `int_skill_versions`

Skill 版本历史。**append-only**，每次升级 INSERT 新行。

```sql
CREATE TABLE int_skill_versions (
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    version          TEXT NOT NULL,           -- semver 或 git short sha
    released_at      TEXT NOT NULL,
    deployed_at      TEXT,                    -- 实际生效时间（可能滞后于发布）
    superseded_at    TEXT,                    -- 被下一版替代时间
    changelog        TEXT,
    prompt_hash      TEXT,                    -- skill prompt 的 hash，识别 prompt 变更
    schema_hash      TEXT,                    -- 输入输出 schema hash
    source_commit    TEXT,                    -- 关联的 git commit 或 ClawHub 版本
    upgrade_reason   TEXT,                    -- 升级原因（关联 suggestion_id 或人工说明）
    PRIMARY KEY (skill_id, version)
);

CREATE INDEX idx_sv_deployed ON int_skill_versions(deployed_at DESC);
```

**设计说明**：
- `superseded_at IS NULL` 表示是当前版本
- `prompt_hash` 让我们知道两个版本的 prompt 是否有实质变化（仅 schema 变更不算 prompt 升级）

### 6.5.3 `int_skill_metrics_daily`

每个 skill 每天的指标快照。Phase 1 起就要建。

```sql
CREATE TABLE int_skill_metrics_daily (
    metric_date      TEXT NOT NULL,
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    skill_version    TEXT,                    -- 当天该 skill 主要使用的版本
    team_id          TEXT,                    -- NULL 表示全局聚合

    invocation_count INTEGER DEFAULT 0,
    success_count    INTEGER DEFAULT 0,       -- 调用了且会话最终成功
    error_count      INTEGER DEFAULT 0,
    unused_count     INTEGER DEFAULT 0,       -- 调用了但结果未被使用（无下游消费）

    avg_duration_ms  INTEGER,
    p95_duration_ms  INTEGER,
    avg_input_tokens INTEGER,
    avg_output_tokens INTEGER,
    cache_hit_rate   REAL,

    -- 推导指标
    success_rate     REAL,                    -- success_count / invocation_count
    error_rate       REAL,
    necessity_score  REAL,                    -- 1 - (unused_count / invocation_count)

    computed_at      TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (metric_date, skill_id, team_id)
);

CREATE INDEX idx_smd_skill_date ON int_skill_metrics_daily(skill_id, metric_date DESC);
CREATE INDEX idx_smd_team_skill ON int_skill_metrics_daily(team_id, skill_id);
```

**设计说明**：
- 三维聚合：date × skill × team
- `necessity_score` 反映 skill 是否真的有用 — 调用了但没人用结果说明被错误触发
- 报告查询直接走这张表，不用每次聚合 raw events

### 6.5.4 `int_skill_upgrades`

Skill 升级事件 + 前后效果对比。

```sql
CREATE TABLE int_skill_upgrades (
    upgrade_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    from_version     TEXT NOT NULL,
    to_version       TEXT NOT NULL,
    upgraded_at      TEXT NOT NULL,
    triggered_by     TEXT,                    -- system / suggestion_id / manual_<user_id>
    rationale        TEXT,                    -- 升级理由

    -- 前后对比（升级后 30 天数据出来才填）
    pre_window_start TEXT,
    pre_window_end   TEXT,
    post_window_start TEXT,
    post_window_end  TEXT,
    pre_success_rate REAL,
    post_success_rate REAL,
    success_delta_pp REAL,                    -- 百分点变化
    pre_avg_tokens   INTEGER,
    post_avg_tokens  INTEGER,

    rollback         INTEGER DEFAULT 0,       -- 是否被回滚
    rollback_reason  TEXT,

    evaluated_at     TEXT                     -- 效果评估完成时间（升级 30 天后）
);

CREATE INDEX idx_su_skill ON int_skill_upgrades(skill_id, upgraded_at DESC);
CREATE INDEX idx_su_unevaluated ON int_skill_upgrades(upgraded_at) WHERE evaluated_at IS NULL;
```

**设计说明**：
- 这是 PRD §16.4.5 "Skill 升级 ROI" KPI 的数据源
- 升级 30 天后自动跑评估任务填充 post_* 字段
- `idx_su_unevaluated` 让评估任务高效找到待评估的升级

### 6.5.5 `int_skill_coverage`

Skill 与问题分类的覆盖关系矩阵。**周级更新**。

```sql
CREATE TABLE int_skill_coverage (
    coverage_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start       TEXT NOT NULL,           -- ISO week 的周一
    category_id      TEXT NOT NULL REFERENCES taxonomy_categories(category_id),
    skill_id         TEXT REFERENCES int_skills(skill_id),

    session_count    INTEGER,                 -- 该 (周, 分类) 下的会话数
    handled_count    INTEGER,                 -- 该 skill 实际处理的会话数
    success_count    INTEGER,
    coverage_rate    REAL,                    -- handled_count / session_count
    success_rate     REAL,

    is_primary       INTEGER DEFAULT 0,       -- 是否该分类的主力 skill
    UNIQUE (week_start, category_id, skill_id)
);

CREATE INDEX idx_sc_week_cat ON int_skill_coverage(week_start, category_id);
```

**用途**：
- 找出"高频问题但无主力 skill"的缺口
- 找出"多个 skill 抢着处理同一问题"的重叠
- 报告中输出"Skill ↔ Category 矩阵"

### 6.5.6 `int_skill_failure_modes`

故障类型字典（PRD §16.4.6 配套）。

```sql
CREATE TABLE int_skill_failure_modes (
    failure_mode_id  TEXT PRIMARY KEY,        -- 'timeout' / 'schema_mismatch' / ...
    display_name     TEXT NOT NULL,
    description      TEXT,
    severity_default TEXT,                    -- 默认严重度 P0/P1/P2
    treatment_path   TEXT,                    -- 治理方向描述
    owner_team       TEXT,                    -- 负责团队（backend/skill_dev/data/ops）
    active           INTEGER DEFAULT 1
);
```

**初始值**：

```sql
INSERT INTO int_skill_failure_modes VALUES
  ('timeout', 'API 超时', 'API 调用 > 30s 未返回', 'P1', '加缓存、优化 API、设降级', 'backend', 1),
  ('schema_mismatch', 'Schema 不匹配', 'LLM 给的参数 API 不接受', 'P1', '改 skill prompt 中 schema 描述', 'skill_dev', 1),
  ('empty_result', '空结果', 'API 返回空数据', 'P2', '上游补全、提醒用户', 'data', 1),
  ('hallucination', '幻觉', 'Skill 编造未证实数据', 'P0', '加 grounding、强制引用', 'skill_dev', 1),
  ('wrong_skill', '错调 skill', '调错 skill 处理不了', 'P1', '改路由、改 skill 描述', 'skill_dev', 1),
  ('partial_answer', '不完整答案', '调对了但答不全', 'P2', '加 few-shot、强化输出格式', 'skill_dev', 1),
  ('auth_error', '认证失败', 'API key 失效或权限不足', 'P0', '配置层修复', 'ops', 1),
  ('rate_limit', '限流', '触发 API 限流', 'P1', '加缓存、错峰、升级套餐', 'backend', 1),
  ('format_error', '格式错误', '输出格式错误（非法 JSON 等）', 'P1', '加 retry / 强 prompt', 'skill_dev', 1),
  ('unknown', '未知', '无法分类', 'P2', '人工 review', 'platform', 1);
```

### 6.5.7 `int_skill_failures`

每次故障的实例记录。每个失败会话至少一行。

```sql
CREATE TABLE int_skill_failures (
    failure_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT NOT NULL,
    server_id        TEXT NOT NULL,
    team_id          TEXT NOT NULL,
    skill_id         TEXT REFERENCES int_skills(skill_id),
    skill_version    TEXT,

    failure_mode_id  TEXT NOT NULL REFERENCES int_skill_failure_modes(failure_mode_id),
    confidence       REAL,                    -- 分类置信度
    classifier       TEXT,                    -- rule / llm / human

    error_signature  TEXT,                    -- 错误指纹（用于聚类）
    error_preview    TEXT,
    related_event_id INTEGER REFERENCES execution_events(event_id),

    detected_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sf_skill_mode ON int_skill_failures(skill_id, failure_mode_id);
CREATE INDEX idx_sf_team_time ON int_skill_failures(team_id, detected_at DESC);
CREATE INDEX idx_sf_signature ON int_skill_failures(error_signature);
```

### 6.5.8 `int_skill_coinvocations`

Skill 共现矩阵（PRD §16.4.7 配套）。**周级更新**。

```sql
CREATE TABLE int_skill_coinvocations (
    week_start       TEXT NOT NULL,
    skill_a_id       TEXT NOT NULL REFERENCES int_skills(skill_id),
    skill_b_id       TEXT NOT NULL REFERENCES int_skills(skill_id),

    cooccurrence_count INTEGER,               -- 共现次数
    a_only_count     INTEGER,                 -- A 出现但 B 没出现
    b_only_count     INTEGER,
    jaccard_score    REAL,                    -- Jaccard 相似度

    typical_order    TEXT,                    -- 'a_then_b' / 'b_then_a' / 'parallel' / 'mixed'
    success_rate_when_both REAL,
    success_rate_a_only REAL,
    success_rate_b_only REAL,

    relationship     TEXT,                    -- complement / substitute / sequence / unknown
    PRIMARY KEY (week_start, skill_a_id, skill_b_id),
    CHECK (skill_a_id < skill_b_id)           -- 避免 (a,b) 和 (b,a) 重复
);

CREATE INDEX idx_sci_high_jaccard ON int_skill_coinvocations(jaccard_score DESC) WHERE jaccard_score > 0.7;
```

### 6.5.9 `int_skill_io_quality_daily`

I/O 质量日级追踪（PRD §16.4.8 配套）。

```sql
CREATE TABLE int_skill_io_quality_daily (
    metric_date      TEXT NOT NULL,
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    skill_version    TEXT,

    -- 输入侧
    invocation_count INTEGER,
    param_extract_correct INTEGER,            -- 参数提取正确数
    param_extract_partial INTEGER,
    param_extract_failed INTEGER,
    param_missing_count INTEGER,
    param_extract_accuracy REAL,

    -- 输出侧
    schema_valid_count INTEGER,
    schema_drift_count INTEGER,               -- 与上一版 schema 不一致的输出数
    field_missing_avg REAL,                   -- 平均缺失字段数
    empty_field_rate REAL,
    downstream_consumable_rate REAL,          -- 输出能被下游成功消费的比例

    PRIMARY KEY (metric_date, skill_id)
);

CREATE INDEX idx_sioq_skill_date ON int_skill_io_quality_daily(skill_id, metric_date DESC);
```

### 6.5.10 `int_skill_value_cost_snapshot`

性价比矩阵月度快照（PRD §16.4.9 配套）。

```sql
CREATE TABLE int_skill_value_cost_snapshot (
    snapshot_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_month   TEXT NOT NULL,           -- 'YYYY-MM'
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),

    value_score      REAL,                    -- 0-100，贡献度评分
    cost_score       REAL,                    -- 0-100，成本评分
    quadrant         TEXT,                    -- star / promote / optimize / cull
    invocation_count INTEGER,
    contribution_count INTEGER,                -- 出现在成功会话的次数
    irreplaceability REAL,                    -- 0-1，难替代度
    monthly_cost_usd REAL,                    -- 月成本估算

    quadrant_change  TEXT,                    -- vs 上月：promoted / demoted / stable / new
    recommendation   TEXT,                    -- 自动生成的处置建议
    UNIQUE (snapshot_month, skill_id)
);

CREATE INDEX idx_svcs_quadrant ON int_skill_value_cost_snapshot(snapshot_month, quadrant);
```

### 6.5.11 `int_skill_golden_questions`

回归测试集（PRD §16.4.10 配套）。

```sql
CREATE TABLE int_skill_golden_questions (
    gq_id            TEXT PRIMARY KEY,        -- 'GQ-attribuly-metrics-001'
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    question         TEXT NOT NULL,           -- 输入问题
    expected_chain_json TEXT,                 -- 期望调用链
    expected_schema_json TEXT,                -- 期望输出 schema
    validation_rules_json TEXT,               -- 验证规则
    max_duration_ms  INTEGER,
    max_tokens       INTEGER,

    category_id      TEXT REFERENCES taxonomy_categories(category_id),
    tags             TEXT,                    -- CSV: 'happy_path' / 'edge_case' / 'regression_2026_q1'

    created_by       TEXT,
    created_at       TEXT DEFAULT (datetime('now')),
    last_run_at      TEXT,
    last_status      TEXT,                    -- pass / fail / error / skipped
    active           INTEGER DEFAULT 1
);

CREATE INDEX idx_gq_skill ON int_skill_golden_questions(skill_id, active);
CREATE INDEX idx_gq_failing ON int_skill_golden_questions(skill_id) WHERE last_status = 'fail';
```

### 6.5.12 `int_skill_regression_runs`

回归测试运行历史。

```sql
CREATE TABLE int_skill_regression_runs (
    run_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    skill_version    TEXT NOT NULL,           -- 被测版本
    triggered_by     TEXT,                    -- pre_upgrade / scheduled / manual

    total_questions  INTEGER,
    pass_count       INTEGER,
    fail_count       INTEGER,
    error_count      INTEGER,
    pass_rate        REAL,

    failed_gq_ids    TEXT,                    -- CSV
    duration_ms      INTEGER,
    blocked_upgrade  INTEGER DEFAULT 0,       -- 是否因失败阻止了升级

    started_at       TEXT NOT NULL,
    completed_at     TEXT
);

CREATE INDEX idx_srr_skill_time ON int_skill_regression_runs(skill_id, started_at DESC);
```

### 6.5.13 `int_skill_team_metrics`

Skill × Team 维度的差异化分析（PRD §16.4.11 配套）。

```sql
CREATE TABLE int_skill_team_metrics (
    metric_date      TEXT NOT NULL,
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    team_id          TEXT NOT NULL,

    invocation_count INTEGER,
    success_rate     REAL,
    avg_token_cost   INTEGER,
    top_failure_mode TEXT,                    -- 该团队该 skill 的主要故障类型
    top_param_pattern TEXT,                   -- 该团队最常用的参数模式

    -- 差异化建议
    suggested_personalization_level TEXT,    -- L1 / L2 / L3 / L4
    deviation_from_baseline REAL,             -- 与该 skill 全局基线的偏离度

    PRIMARY KEY (metric_date, skill_id, team_id)
);

CREATE INDEX idx_stm_skill_date ON int_skill_team_metrics(skill_id, metric_date DESC);
CREATE INDEX idx_stm_high_deviation ON int_skill_team_metrics(skill_id) WHERE deviation_from_baseline > 0.2;
```

### 6.5.14 `int_skill_personalization_configs`

团队级 skill 个性化配置（PRD §16.4.11 的 L1-L4 落地）。

```sql
CREATE TABLE int_skill_personalization_configs (
    config_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    team_id          TEXT NOT NULL,
    level            TEXT NOT NULL,           -- L1 / L2 / L3 / L4
    config_kind      TEXT NOT NULL,           -- few_shot / prompt_fragment / routing_rule / fork
    config_json      TEXT NOT NULL,           -- 实际配置内容

    related_suggestion_id TEXT REFERENCES optimization_suggestions(suggestion_id),
    status           TEXT DEFAULT 'active',   -- active / paused / removed
    activated_at     TEXT DEFAULT (datetime('now')),
    deactivated_at   TEXT
);

CREATE INDEX idx_spc_team_skill ON int_skill_personalization_configs(team_id, skill_id) WHERE status = 'active';
```

### 6.5.15 `int_skill_confidence_log`

Skill 自评置信度日志（PRD §16.4.12 配套）。

```sql
CREATE TABLE int_skill_confidence_log (
    log_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT NOT NULL,
    server_id        TEXT NOT NULL,
    skill_id         TEXT NOT NULL REFERENCES int_skills(skill_id),
    event_id         INTEGER REFERENCES execution_events(event_id),

    confidence_score REAL,                    -- 0-1
    confidence_level TEXT,                    -- high / medium / low
    confidence_source TEXT,                   -- model_self / data_completeness / time_match / historical / composite
    reason           TEXT,                    -- 置信度判定理由

    system_action    TEXT,                    -- direct_output / disclaimer / followup / escalate
    user_outcome     TEXT,                    -- accepted / followup / negative / unknown

    logged_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_scl_skill_level ON int_skill_confidence_log(skill_id, confidence_level);
CREATE INDEX idx_scl_calibration ON int_skill_confidence_log(confidence_level, user_outcome);
```

**用途**：
- 校准置信度：高置信会话实际成功率应 ≥ 85%（若不达，说明置信度估算虚高）
- 优化阈值：根据 user_outcome 反推最优置信度阈值

---

## 7. Layer 5：优化生命周期（业务核心）

这一层是整个 Intelligence 系统最有业务价值的部分。设计目标：**每条建议从产生到落地可追踪、可回滚、可评估**。

### 7.1 `optimization_suggestions`

建议池主表。

```sql
CREATE TABLE optimization_suggestions (
    suggestion_id    TEXT PRIMARY KEY,        -- 'S-2026-0414-017'
    type             TEXT NOT NULL,           -- skill_redesign / api_optimize / prompt_fix / product_feature / routing / cache / taxonomy
    title            TEXT NOT NULL,
    description      TEXT,
    root_cause       TEXT,
    suggested_action TEXT,

    priority         TEXT NOT NULL,           -- P0 / P1 / P2 / P3
    track            TEXT NOT NULL,           -- autonomous / manual

    -- 影响范围
    scope_team_ids   TEXT,                    -- CSV 或 'all'
    scope_skill_ids  TEXT,
    scope_api_ids    TEXT,
    affected_sessions INTEGER,

    -- 预估收益
    estimated_success_delta REAL,             -- +0.15 = +15%
    estimated_token_delta REAL,
    estimated_latency_delta_ms INTEGER,
    ab_testable      INTEGER DEFAULT 0,

    -- 生成来源
    generated_by     TEXT NOT NULL,           -- system / llm_claude_sonnet / human_<user_id>
    generator_version TEXT,
    source_cluster_id TEXT REFERENCES failure_clusters(cluster_id),
    source_pattern_id TEXT REFERENCES call_patterns(pattern_id),

    status           TEXT DEFAULT 'open',     -- open / in_review / approved / in_progress / applied / rolled_back / rejected / obsolete
    assignee         TEXT,

    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now')),
    resolved_at      TEXT
);

CREATE INDEX idx_os_status_priority ON optimization_suggestions(status, priority);
CREATE INDEX idx_os_track ON optimization_suggestions(track, status);
CREATE INDEX idx_os_type ON optimization_suggestions(type);
```

### 7.2 `suggestion_evidence`

建议的证据（样本会话、指标对比等）。多对一。

```sql
CREATE TABLE suggestion_evidence (
    evidence_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id TEXT NOT NULL REFERENCES optimization_suggestions(suggestion_id),
    evidence_kind TEXT NOT NULL,              -- session_sample / metric / chain / comparison
    reference_type TEXT,                      -- session / chain / pattern / cluster
    reference_id  TEXT,
    snapshot_json TEXT,                       -- 快照数据，防止原始数据变了导致证据消失
    note          TEXT,
    added_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_se_suggestion ON suggestion_evidence(suggestion_id);
```

**设计说明**：`snapshot_json` 很重要 — 原始 session 可能被脱敏或归档，证据快照必须独立保留。

### 7.3 `suggestion_comments`

建议的讨论流（开发、产品、运营协作）。

```sql
CREATE TABLE suggestion_comments (
    comment_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id TEXT NOT NULL REFERENCES optimization_suggestions(suggestion_id),
    author_id     TEXT NOT NULL,
    body          TEXT NOT NULL,
    action        TEXT,                       -- status_change / comment / attach / approve / reject
    metadata_json TEXT,                       -- 如 status_change 时记录 old/new
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sc_suggestion ON suggestion_comments(suggestion_id, created_at DESC);
```

### 7.4 `optimization_actions`

已执行的优化动作（不管是自主的还是人工的）。**append-only 审计核心**。

```sql
CREATE TABLE optimization_actions (
    action_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id    TEXT NOT NULL REFERENCES optimization_suggestions(suggestion_id),

    action_type      TEXT NOT NULL,           -- route_update / cache_ttl_change / rule_add / rule_update / rollout / rollback
    target_kind      TEXT,                    -- routing_table / cache_config / taxonomy_rule / prompt_fragment
    target_id        TEXT,
    diff_json        TEXT NOT NULL,           -- 变更前后 diff
    applied_by       TEXT NOT NULL,           -- system / user_id
    applied_at       TEXT DEFAULT (datetime('now')),

    rollout_stage    TEXT,                    -- canary_10 / canary_50 / full / rollback
    rollout_status   TEXT,                    -- pending / live / observing / promoted / failed / rolled_back
    observation_until TEXT,                   -- 灰度观察期结束时间
    rollback_action_id INTEGER                -- 如果是回滚，指向被回滚的 action_id
);

CREATE INDEX idx_oa_suggestion ON optimization_actions(suggestion_id, applied_at DESC);
CREATE INDEX idx_oa_status ON optimization_actions(rollout_status, observation_until);
```

### 7.5 `optimization_experiments`

A/B 实验配置。

```sql
CREATE TABLE optimization_experiments (
    experiment_id    TEXT PRIMARY KEY,
    suggestion_id    TEXT NOT NULL REFERENCES optimization_suggestions(suggestion_id),
    name             TEXT NOT NULL,
    hypothesis       TEXT,
    control_config   TEXT,                    -- 控制组配置 JSON
    treatment_config TEXT,                    -- 处理组配置 JSON
    split_strategy   TEXT,                    -- team_level / session_level / random
    split_ratio      REAL DEFAULT 0.5,        -- 处理组比例

    success_metric   TEXT NOT NULL,           -- 主指标名
    guard_metrics    TEXT,                    -- 护栏指标 CSV

    status           TEXT DEFAULT 'planned',  -- planned / running / paused / concluded / aborted
    started_at       TEXT,
    ended_at         TEXT,
    conclusion       TEXT                     -- winner_control / winner_treatment / inconclusive / aborted
);
```

### 7.6 `experiment_results`

实验每天的指标快照。

```sql
CREATE TABLE experiment_results (
    result_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id    TEXT NOT NULL REFERENCES optimization_experiments(experiment_id),
    observation_date TEXT NOT NULL,

    control_sample_size INTEGER,
    treatment_sample_size INTEGER,
    control_metric_value REAL,
    treatment_metric_value REAL,
    p_value          REAL,
    confidence       REAL,

    metrics_snapshot_json TEXT,

    computed_at      TEXT DEFAULT (datetime('now')),
    UNIQUE (experiment_id, observation_date)
);
```

---

## 8. Layer 6：报告与快照（物化）

### 8.1 `daily_metrics`

每日滚动指标，按 (team, L1 category) 维度聚合。

```sql
CREATE TABLE daily_metrics (
    metric_date      TEXT NOT NULL,           -- YYYY-MM-DD
    team_id          TEXT NOT NULL,
    category_id      TEXT,                    -- NULL 表示 team 汇总

    session_count    INTEGER DEFAULT 0,
    user_message_count INTEGER DEFAULT 0,
    success_count    INTEGER DEFAULT 0,
    failure_count    INTEGER DEFAULT 0,
    refuse_count     INTEGER DEFAULT 0,
    followup_count   INTEGER DEFAULT 0,
    repeated_count   INTEGER DEFAULT 0,

    avg_duration_ms  INTEGER,
    p50_duration_ms  INTEGER,
    p95_duration_ms  INTEGER,

    total_skill_calls INTEGER,
    total_api_calls  INTEGER,
    total_input_tokens INTEGER,
    total_output_tokens INTEGER,

    computed_at      TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (metric_date, team_id, category_id)
);

CREATE INDEX idx_dm_team_date ON daily_metrics(team_id, metric_date DESC);
```

**设计说明**：
- 每天凌晨跑一次汇总（Cloudflare Scheduled Worker），避免每次 Dashboard 查询都扫原始表
- 粒度：(date × team × category)。更细粒度（小时级、skill 级）可建单独表

### 8.2 `team_snapshots`

团队周级快照（用于趋势对比）。

```sql
CREATE TABLE team_snapshots (
    snapshot_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id          TEXT NOT NULL,
    period_type      TEXT NOT NULL,           -- day / week / month
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,

    session_count    INTEGER,
    success_rate     REAL,
    avg_token_cost   INTEGER,
    active_user_count INTEGER,
    usage_depth      REAL,                    -- 复杂度得分平均值
    top_categories_json TEXT,                 -- Top N 分类
    top_questions_json TEXT,                  -- Top N 问题

    health_score     REAL,                    -- 综合健康度 0-100
    tier_change      TEXT,                    -- upgrade / downgrade / stable

    computed_at      TEXT DEFAULT (datetime('now')),
    UNIQUE (team_id, period_type, period_start)
);

CREATE INDEX idx_ts_team_period ON team_snapshots(team_id, period_type, period_start DESC);
```

### 8.3 `reports`

生成的报告（日报 / 周报 / 自定义报告）。

```sql
CREATE TABLE reports (
    report_id        TEXT PRIMARY KEY,        -- 'R-2026-0414-daily'
    report_type      TEXT NOT NULL,           -- daily / weekly / monthly / custom
    scope            TEXT NOT NULL,           -- global / team_<id>
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,

    markdown         TEXT,                    -- 报告正文
    html             TEXT,                    -- HTML 版本
    metadata_json    TEXT,                    -- 报告中的关键指标

    generated_at     TEXT DEFAULT (datetime('now')),
    generator_version TEXT
);

CREATE INDEX idx_r_type_scope ON reports(report_type, scope, period_start DESC);
```

### 8.4 `report_deliveries`

报告投递记录（邮件 / Slack / Feishu / Webhook）。

```sql
CREATE TABLE report_deliveries (
    delivery_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id        TEXT NOT NULL REFERENCES reports(report_id),
    channel          TEXT NOT NULL,           -- email / slack / feishu / webhook
    recipient        TEXT NOT NULL,
    status           TEXT,                    -- pending / sent / failed / retried
    attempt_count    INTEGER DEFAULT 0,
    error_message    TEXT,
    sent_at          TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
);
```

---

## 9. Layer 7：审计与访问控制

### 9.1 `users`

用户表。MVP 可能先不启用完整账号系统，但表先建。

```sql
CREATE TABLE users (
    user_id       TEXT PRIMARY KEY,
    email         TEXT UNIQUE,
    display_name  TEXT,
    role          TEXT NOT NULL,              -- business / skill_dev / product / ops / admin
    team_ids      TEXT,                       -- CSV of accessible team_ids, 'all' for admin
    status        TEXT DEFAULT 'active',
    created_at    TEXT DEFAULT (datetime('now')),
    last_login_at TEXT
);
```

### 9.2 `roles` & `role_permissions`

简单的 RBAC。

```sql
CREATE TABLE roles (
    role_id       TEXT PRIMARY KEY,
    description   TEXT
);

CREATE TABLE role_permissions (
    role_id       TEXT NOT NULL REFERENCES roles(role_id),
    resource      TEXT NOT NULL,              -- conversations / analytics / suggestions / experiments
    action        TEXT NOT NULL,              -- read / write / approve / execute
    scope         TEXT,                       -- own_team / any_team / aggregated_only
    PRIMARY KEY (role_id, resource, action)
);
```

### 9.3 `audit_log`

所有敏感操作。**永远 append-only，永不删除**。

```sql
CREATE TABLE audit_log (
    audit_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id      TEXT NOT NULL,
    actor_type    TEXT NOT NULL,              -- user / system / agent
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT,
    before_json   TEXT,
    after_json    TEXT,
    ip_address    TEXT,
    user_agent    TEXT,
    occurred_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_al_actor_time ON audit_log(actor_id, occurred_at DESC);
CREATE INDEX idx_al_resource ON audit_log(resource_type, resource_id);
```

### 9.4 `access_log`

数据访问记录。用于检查"谁在看什么"。

```sql
CREATE TABLE access_log (
    access_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id      TEXT,
    endpoint      TEXT NOT NULL,
    query_params_hash TEXT,
    team_scope    TEXT,                       -- 查询涉及的 team_ids
    row_count     INTEGER,
    duration_ms   INTEGER,
    accessed_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_acl_actor ON access_log(actor_id, accessed_at DESC);
```

---

## 10. 索引策略总览

D1 没有原生的自动索引建议。每个索引都要想清楚覆盖的查询。

### 10.1 常用查询 → 索引映射

| 查询模式 | 索引 |
|---------|------|
| 某团队最近 N 天失败会话 | `idx_se_team_time` + `idx_se_failure` |
| 某调用链指纹的所有实例 | `idx_ec_signature` |
| 按 category 统计问题 | `idx_qc_team_category` |
| 未解决的异常信号 | `idx_as_unresolved` |
| 某 suggestion 的所有证据 | `idx_se_suggestion` |
| 待审批的自主优化 | `idx_os_track` |
| Dashboard 日指标 | `idx_dm_team_date` |

### 10.2 部分索引（Partial Index）

D1 支持 `WHERE` 子句的部分索引，用于"稀疏查询"场景：

```sql
-- 只索引失败会话（失败率一般 < 20%，省空间）
CREATE INDEX idx_se_failure ON sessions_enriched(success_label) WHERE success_label IN ('failure', 'refuse');

-- 只索引有效的映射
CREATE INDEX idx_stm_team ON server_team_map(team_id) WHERE unmapped_at IS NULL;

-- 只索引未解决的信号
CREATE INDEX idx_as_unresolved ON anomaly_signals(detected_at DESC) WHERE resolved_at IS NULL;
```

### 10.3 避免过度索引

D1 写入成本随索引数量线性增加。原则：
- 只为**实际查询**建索引，不做"以防万一"
- 定期用 `EXPLAIN QUERY PLAN` 检查索引命中
- 维度大的表（`execution_events`、`messages`）索引 ≤ 5 个

---

## 11. 数据生命周期

不同层数据保留策略不同。

| 表 | 保留期 | 归档策略 |
|----|-------|---------|
| `execution_events` | 90 天 | 归档到 R2 冷存储，按月打包 |
| `execution_chains` | 180 天 | 保留 signature 和聚合统计，清理 chain_json |
| `messages_enriched` | 180 天 | 归档 |
| `sessions_enriched` | 2 年 | 保留 |
| `question_classifications` | 2 年 | 保留 |
| `optimization_suggestions` | 永久 | 永不删除（审计价值） |
| `optimization_actions` | 永久 | 永不删除 |
| `audit_log` | 永久 | 永不删除 |
| `daily_metrics` | 永久 | 永不删除 |
| `team_snapshots` | 永久 | 保留 |
| `reports` | 1 年 | 归档（只保留 metadata） |
| `access_log` | 90 天 | 合规要求 |

**实现**：每周跑一次清理任务（Scheduled Worker），把过期数据导出到 R2，然后 D1 中删除。

---

## 12. 与 allyclaw-context-dashboard 的集成方案

### 12.1 物理部署

**推荐：同一个 D1 数据库**

```
allyclaw-db (D1)
├─ Layer 0 表（由 context-dashboard 维护）
└─ Layer 1-7 表（由 intelligence 维护）
```

**理由**：
- D1 免费额度内完全够用（< 10GB）
- 避免跨库 JOIN 的复杂性
- 两个 Worker 共享一个数据库，权限通过 binding 控制

**风险**：
- 两个项目同时改 schema 有冲突风险
- **对策**：`intelligence` 的表名前缀用 `int_` 或统一放在 schema 文档明确归属

**备选方案**：独立数据库 + 定时同步
只在 D1 容量吃紧或隔离要求强时采用。

### 12.2 写入边界

| 表 | 只读 | 可写 |
|----|-----|------|
| `servers`, `sessions`, `messages`, `question_stats`, `sync_state` | intelligence | context-dashboard |
| Layer 1-7 所有表 | context-dashboard（可读） | intelligence |

### 12.3 Agent 升级路径

**Layer 2 的 `execution_events`** 需要 OpenClaw JSONL 中的 `toolCall` 数据，当前 agent 只解析 `message` 记录。

升级步骤：
1. 在 `allyclaw-context-dashboard` 的 agent 中增加 `toolCall` 解析
2. 通过新增 `/api/ingest/events` 端点推送到 D1
3. Agent 自动更新机制生效后，所有 12 台服务器自动升级

---

## 13. 典型查询示例

### 13.1 查找某团队本周失败率最高的问题分类

```sql
SELECT
    c.name AS category,
    COUNT(*) AS total,
    SUM(CASE WHEN se.success_label = 'failure' THEN 1 ELSE 0 END) AS failures,
    ROUND(SUM(CASE WHEN se.success_label = 'failure' THEN 1 ELSE 0 END) * 1.0 / COUNT(*), 3) AS failure_rate
FROM sessions_enriched se
JOIN question_classifications qc
    ON qc.session_id = se.session_id AND qc.server_id = se.server_id AND qc.is_primary = 1
JOIN taxonomy_categories c ON c.category_id = qc.category_id
WHERE se.team_id = ?
  AND se.enriched_at >= datetime('now', '-7 days')
GROUP BY c.category_id
HAVING total >= 5
ORDER BY failure_rate DESC
LIMIT 10;
```

### 13.2 挖掘某分类下的黄金路径

```sql
SELECT
    ec.chain_signature,
    COUNT(*) AS match_count,
    AVG(ec.total_duration_ms) AS avg_duration,
    SUM(CASE WHEN ec.success = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS success_rate
FROM execution_chains ec
JOIN question_classifications qc
    ON qc.session_id = ec.session_id AND qc.server_id = ec.server_id
WHERE qc.category_id = 'L2.revenue_drop'
  AND ec.built_at >= datetime('now', '-30 days')
GROUP BY ec.chain_signature
HAVING match_count >= 10
ORDER BY success_rate DESC, avg_duration ASC
LIMIT 5;
```

### 13.3 列出待审批的自主优化（带证据摘要）

```sql
SELECT
    s.suggestion_id,
    s.title,
    s.priority,
    s.estimated_success_delta,
    COUNT(e.evidence_id) AS evidence_count,
    s.created_at
FROM optimization_suggestions s
LEFT JOIN suggestion_evidence e ON e.suggestion_id = s.suggestion_id
WHERE s.track = 'autonomous'
  AND s.status = 'in_review'
GROUP BY s.suggestion_id
ORDER BY
    CASE s.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
    s.created_at DESC;
```

### 13.4 某建议的"优化前 vs 优化后"对比

```sql
WITH action AS (
    SELECT applied_at FROM optimization_actions
    WHERE suggestion_id = ? AND rollout_stage = 'full'
    LIMIT 1
)
SELECT
    'before' AS period,
    AVG(CASE WHEN success_label = 'success' THEN 1.0 ELSE 0.0 END) AS success_rate,
    AVG(total_duration_ms) AS avg_duration
FROM sessions_enriched, action
WHERE enriched_at BETWEEN datetime(action.applied_at, '-14 days') AND action.applied_at
UNION ALL
SELECT
    'after',
    AVG(CASE WHEN success_label = 'success' THEN 1.0 ELSE 0.0 END),
    AVG(total_duration_ms)
FROM sessions_enriched, action
WHERE enriched_at BETWEEN action.applied_at AND datetime(action.applied_at, '+14 days');
```

---

## 14. Migration 计划

### 14.1 Phase 1 上线表（Week 1-2）

基础设施必须，先建：

```
teams
server_team_map
sessions_enriched（空表，待富化任务填充）
daily_metrics
```

### 14.2 Phase 1 后期（Week 3-6）

分类 + 事件 + 报告：

```
taxonomy_categories
taxonomy_rules
taxonomy_rules_history
question_classifications
execution_events  -- 需要 agent 升级
execution_chains
reports
report_deliveries
```

### 14.3 Phase 2（Week 7-12）

分析 + 建议生命周期：

```
call_patterns
pattern_instances
failure_clusters
anomaly_signals
optimization_suggestions
suggestion_evidence
suggestion_comments
optimization_actions
```

### 14.4 Phase 3（Week 13-18）

实验 + 审计完整化：

```
optimization_experiments
experiment_results
team_snapshots
audit_log
users / roles / role_permissions
access_log
session_tags
```

### 14.5 Migration 原则

- **永不 DROP**：表一旦上线，字段可加（`ALTER ADD COLUMN`），不可删
- **变更审批**：每次 schema 变更走 GitHub PR，记录在 `deploy/migrations/` 目录
- **向前兼容**：新字段都有默认值，保证老代码能跑

---

## 15. 容量规划

基于当前观测（12 台服务器）外推，未来 6 个月（假设扩到 50 台）：

| 表 | 日增行数 | 年累计 | 大小估计 |
|----|---------|-------|---------|
| `execution_events` | ~50k | 18M | ~3 GB |
| `execution_chains` | ~15k | 5.5M | ~1 GB |
| `sessions_enriched` | ~2.5k | 900k | ~200 MB |
| `question_classifications` | ~3k | 1M | ~100 MB |
| `daily_metrics` | ~500 | 180k | ~20 MB |
| `optimization_suggestions` | ~5 | 1800 | ~1 MB |
| `audit_log` | ~1k | 360k | ~50 MB |

**D1 免费额度**：5 GB 存储、500 万行读/天、10 万行写/天

**结论**：
- 存储空间充足（4.4 GB < 5 GB）
- 写入压力 ≈ 70k/天 < 10 万（刚够）
- **超限前要做的事**：
  1. `execution_events` 归档到 R2（90 天后）
  2. 升级到 D1 付费（$5/月 起，配额翻数十倍）

---

## 16. 取舍与备选方案

### 16.1 为什么不用 JSON 列代替大部分表？

D1 / SQLite 的 JSON 支持一般：
- 索引 JSON 字段要 virtual column + expression index，复杂且慢
- 聚合查询性能差
- 字段语义靠文档约定，容易漂移

**只有以下场景用 JSON**：
- 证据快照（`snapshot_json`）
- 元数据扩展（`metadata_json`）
- 配置 / diff（`diff_json`、`control_config`）

### 16.2 为什么不用 PostgreSQL / 自建数据库？

- D1 免运维、免费、与现有 Worker 无缝集成
- 当前 / 未来 1 年数据量完全在 D1 能力范围
- 切换到 PG 的成本 > 收益

**何时切换**：
- 数据量 > 50 GB
- 需要复杂全文检索（PG `tsvector`）
- 团队有专职 DBA

### 16.3 为什么不为每个团队建独立库？

- 物理隔离运维成本高（50 个 D1 数据库）
- 跨团队分析（平台视角）不可能做
- 当前的行级 `team_id` 隔离 + 应用层过滤已够用

**除非**：有强合规要求（医疗、金融），才考虑独立库。

### 16.4 为什么把 `execution_chains` 和 `execution_events` 分开？

- `events` 是细粒度、不可变的原始记录
- `chains` 是聚合结果，可重算，含快照 JSON
- 分开后：`events` 可以归档而不影响模式挖掘（`chains` 保留）

### 16.5 物化视图 vs 实时查询

**选择物化视图的场景**（建独立表）：
- Dashboard 首屏数据（Top 问题、日/周指标）
- 报告生成

**选择实时 JOIN 的场景**：
- 建议工作台（数据敏感、查询维度多变）
- 深度分析 / 调试

---

## 17. 待决策项

上报团队 review 时请明确以下取舍：

- [ ] **数据库部署**：和 allyclaw-db 同库 vs 独立 D1 库？
- [ ] **表命名前缀**：是否给 intelligence 表加 `int_` 前缀区分？
- [ ] **用户系统**：MVP 阶段是否启用 `users` 表，还是用现有 Cloudflare Access？
- [ ] **审计日志存储**：`audit_log` 超过 100 万行时迁到 R2 还是升级 D1？
- [ ] **分类器成本**：LLM 分类预算上限？（影响每日处理会话数）
- [ ] **PII 脱敏时机**：入库前脱敏还是查询时脱敏？
- [ ] **experiment_results 粒度**：每天一次快照 vs 每小时一次快照？

---

**文档状态**：v0.1
**下一步**：
1. Review 上述待决策项
2. 确认后，生成 `migrations/001_init_phase1.sql` 开始落地
3. 在 PRD.md Phase 1 W1-W2 的"数据模型设计评审通过"节点上完成确认
