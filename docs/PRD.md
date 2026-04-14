# AllyClaw Conversation Intelligence & Optimization System

> 产品需求文档（PRD）
> 版本：v0.1 · 初稿
> 日期：2026-04-14
> 项目代号：`allyclaw-intelligence`

---

## 1. 项目背景

### 1.1 当前状态

我们已经在腾讯云部署了 12 台以上的 OpenClaw（小龙虾）实例，每个实例对应一个业务团队，通过 [Attribuly Skill](https://clawhub.ai/alexchulee/attribuly) 拉取营销数据。现已具备的能力：

- **多实例 Agent 运行**：每团队独立实例，使用 `ATTRIBULY_API_KEY` 访问各自的数据
- **数据采集基础设施**：[allyclaw-context-dashboard](https://github.com/zhoushunke0613-ai/allyclaw-context-dashboard) 已实现对话日志的集中汇聚，Cloudflare Worker + D1 存储
- **基础可视化**：Dashboard 展示对话列表、Top Questions、Token 消耗、时段分布
- **Skill 生态**：Attribuly DTC 营销分析 skill 已发布至 ClawHub

### 1.2 当前痛点

随着实例数量和用户问题复杂度增加，以下问题逐步暴露：

| 痛点 | 具体表现 |
|------|---------|
| **对话质量不可量化** | 无法知道哪些问题答得好、哪些答错了、哪些需要更深上下文 |
| **Skill 调用低效** | 存在漏调用、过度调用、调用顺序错误、不必要的重复请求 |
| **上下文靠经验** | system prompt、skill prompt、tool rules 缺少数据驱动优化闭环 |
| **无系统学习** | 不能自动总结"最近哪些问题在变"、"哪些 skill 该重构" |
| **无运营视图** | 无法在团队维度对比使用深度、问题分布、优化收益 |

### 1.3 与现有系统的关系

```
           ┌─────────────────────────────────────────────┐
           │   allyclaw-intelligence （本项目）           │
           │   对话分析 · 诊断 · 优化建议 · 报告           │
           └──────────┬──────────────────────────────────┘
                      │ 读取 D1 数据
                      ▼
           ┌─────────────────────────────────────────────┐
           │   allyclaw-context-dashboard （已有）        │
           │   数据采集与展示层                            │
           └──────────┬──────────────────────────────────┘
                      │ agent 推送
                      ▼
           ┌─────────────────────────────────────────────┐
           │   OpenClaw 实例群（12+ 台腾讯云服务器）       │
           └─────────────────────────────────────────────┘
```

`allyclaw-intelligence` 不重复造轮子，复用现有数据采集基础设施，在其上构建 **分析 → 诊断 → 建议 → 报告** 的智能层。

---

## 2. 项目目标

### 2.1 一句话定义

> 让小龙虾不只会回答问题，而是会不断变得更会回答问题。

### 2.2 总体目标

建立一个面向多实例、多团队、多轮对话场景的 **Agent Ops 平台**，具备四项核心能力：

1. **看清楚** — 完整采集对话 / 调用 / 结果 / 反馈数据
2. **找问题** — 自动识别低质回答、低效调用、上下文缺口、skill 缺口
3. **给建议** — 自动输出优化建议，分为"自主执行"和"人工处理"两条线
4. **持续进化** — 形成"观测 → 诊断 → 优化 → 评估"的闭环

### 2.3 目标分解与量化

| 能力 | 第一阶段目标（3 个月） | 第二阶段目标（6 个月） |
|------|-----------------------|----------------------|
| 看清楚 | 关键事件采集覆盖率 ≥ 95% | 事件维度完整度 ≥ 90% |
| 找问题 | 失败对话识别准确率 ≥ 80% | 根因分析覆盖率 ≥ 70% |
| 给建议 | 每周产出 ≥ 10 条高质量优化建议 | 建议采纳率 ≥ 50% |
| 持续进化 | 自主优化动作可审计、可回滚 | 优化后回答成功率提升 ≥ 15% |

---

## 3. 使用场景

### 3.1 场景一：业务运营 — 查看本团队使用健康度

**用户**：DTC 品牌营销负责人
**场景**：每周一早上想知道上周团队用得怎样

- 打开团队周报，看到：本周 xx 次提问、回答成功率 82%、Token 消耗 +12%
- 看到 Top 3 高频问题：「昨天 revenue 怎么跌了」「Meta 和 Google 哪个 ROAS 更好」「这周 campaign 哪个在浪费预算」
- 看到系统对「conversion tracking 缺失」类问题失败率高，建议联系运营团队处理

### 3.2 场景二：开发团队 — 优化 Skill

**用户**：Attribuly skill 维护工程师
**场景**：发现「revenue 异常诊断」类问题回答质量差

- 进入「优化建议工作台」，按「Skill 设计优化」筛选
- 看到一条建议：「**当前 revenue drop diagnosis 调用链缺少 campaign-level breakdown**，建议在 skill prompt 中新增 few-shot 示例」
- 点击查看支持证据：5 段失败对话样本、调用链日志、用户追问记录
- 采纳建议 → skill 版本更新 → 系统在接下来 7 天自动对比优化前后的成功率

### 3.3 场景三：产品团队 — 发现能力缺口

**用户**：产品经理
**场景**：规划下季度功能路线图

- 查看「新出现的问题类型」趋势
- 发现「CRM 用户旅程分析」类问题占比从 2% 升到 11%
- 发现当前无对应 skill，系统失败率 76%
- 得到结论：需要新开发一个 User Journey skill，已有 30+ 条真实用户问题作为 few-shot

### 3.4 场景四：运营团队 — 团队对比

**用户**：ClawHub 运营
**场景**：判断哪些团队用得好、哪些需要扶持

- 查看团队对比面板
- Team A：日均 50 次提问、成功率 88%、使用深度 4.2（高级用户）
- Team B：日均 5 次提问、成功率 52%、使用深度 1.8（基础用户，问题多为「怎么用」）
- 决策：对 Team B 推送入门 onboarding 内容、对 Team A 推送高级功能

---

## 4. 用户角色

| 角色 | 主要诉求 | 使用频率 | 关键功能 |
|------|---------|---------|---------|
| **业务团队**（品牌方） | 了解自己团队的 AI 使用情况 | 周 | 团队周报、健康度面板 |
| **Skill 开发工程师** | 识别需要优化的 skill/prompt | 日 | 优化建议工作台、调用链分析 |
| **产品经理** | 发现用户需求和能力缺口 | 周 | 问题趋势、能力缺口报告 |
| **运营团队** | 管理多团队使用和推广 | 日 | 团队对比、活跃度、使用深度 |
| **平台管理员** | 系统整体健康、成本监控 | 日 | 全局指标、成本报告、告警 |

---

## 5. 系统边界

### 5.1 做什么

- ✅ 对话日志分析、调用链还原、问题分类
- ✅ 失败对话识别、根因分析、优化建议生成
- ✅ 自主优化低风险参数（路由、缓存、权重、分类规则）
- ✅ 日报 / 周报 / 对比面板
- ✅ 优化建议工作台（工单式）
- ✅ 团队 / 实例 / skill / API 维度的使用分析

### 5.2 不做什么

- ❌ 不替代 OpenClaw / Attribuly skill 本身的对话处理逻辑
- ❌ 不直接覆盖 skill 的核心 prompt（只给建议）
- ❌ 不做在线强化学习 / 全自动 prompt 重写（至少 MVP 不做）
- ❌ 不承担数据采集职责（复用 allyclaw-context-dashboard）
- ❌ 不做 Attribuly API 本身的扩展（只提调用优化建议）

### 5.3 与现有系统的分工

| 系统 | 职责 |
|------|------|
| **OpenClaw 实例** | 运行对话、调用 skill、调用 Attribuly API |
| **allyclaw-context-dashboard** | 采集、存储原始日志；展示基础统计 |
| **allyclaw-intelligence**（本项目） | 深度分析、诊断、建议、报告、优化决策 |
| **Attribuly API** | 提供营销数据 |
| **ClawHub** | Skill 分发与版本管理 |

---

## 6. 数据采集设计

### 6.1 复用的数据

从 `allyclaw-context-dashboard` 的 D1 数据库读取（已有）：

```
servers          → 实例信息
sessions         → 会话元数据（id, server_id, agent_id, started_at, token totals, summary）
messages         → 原始消息（role, content, timestamp, token_count, model_id, tool_name）
question_stats   → 清洗后的问题统计（question_text, category, count）
```

### 6.2 需要扩展的数据

为支撑深度分析，需要在现有 schema 上扩展：

#### 6.2.1 会话扩展字段（`sessions_enriched`）

```sql
CREATE TABLE sessions_enriched (
    session_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    team_id TEXT,                    -- 从 server_id 映射
    primary_topic TEXT,              -- 主题归类（Revenue、Campaign、Attribution 等）
    primary_intent TEXT,             -- 用户意图（diagnosis、comparison、report、config）
    complexity_score REAL,           -- 复杂度 0-1
    success_label TEXT,              -- success / partial / failure / refuse
    has_followup BOOLEAN,            -- 是否有追问
    repeated_question BOOLEAN,       -- 是否重复提问
    user_sentiment TEXT,             -- positive / neutral / negative / frustrated
    total_skill_calls INTEGER,
    total_api_calls INTEGER,
    total_duration_ms INTEGER,
    enriched_at TEXT,
    PRIMARY KEY (session_id, server_id)
);
```

#### 6.2.2 调用链事件表（`execution_events`）

```sql
CREATE TABLE execution_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    message_id INTEGER,              -- 对应 messages.id
    event_type TEXT NOT NULL,        -- skill_call, api_call, cache_hit, fallback, error
    skill_name TEXT,
    api_endpoint TEXT,
    api_params_hash TEXT,
    duration_ms INTEGER,
    status TEXT,                     -- success, timeout, error, degraded
    error_message TEXT,
    token_cost INTEGER,
    timestamp TEXT NOT NULL
);

CREATE INDEX idx_events_session ON execution_events(session_id, server_id);
CREATE INDEX idx_events_skill ON execution_events(skill_name);
CREATE INDEX idx_events_api ON execution_events(api_endpoint);
```

#### 6.2.3 问题分类表（`question_taxonomy`）

```sql
CREATE TABLE question_taxonomy (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,    -- 关联 question_stats.id
    l1_category TEXT NOT NULL,       -- 一级分类
    l2_category TEXT,                -- 二级分类
    intent_type TEXT,                -- 意图
    entities_json TEXT,              -- 提取的实体（渠道、时间范围等）
    confidence REAL,
    classified_at TEXT
);
```

#### 6.2.4 优化建议池（`optimization_suggestions`）

```sql
CREATE TABLE optimization_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,              -- skill_redesign, api_optimize, prompt_fix, etc.
    title TEXT NOT NULL,
    description TEXT,
    root_cause TEXT,
    suggested_action TEXT,
    impact_scope TEXT,               -- 影响范围估计
    priority TEXT,                   -- P0 / P1 / P2 / P3
    estimated_value TEXT,            -- 预估收益（成功率 +X%、token -Y%）
    evidence_json TEXT,              -- 支持证据（会话 ID 列表、指标）
    ab_testable BOOLEAN,
    track TEXT,                      -- autonomous / manual
    status TEXT DEFAULT 'open',      -- open / in_progress / applied / rejected / rolled_back
    assignee TEXT,
    created_at TEXT,
    resolved_at TEXT
);
```

#### 6.2.5 团队映射表（`teams`）

```sql
CREATE TABLE teams (
    team_id TEXT PRIMARY KEY,
    team_name TEXT,
    server_ids_json TEXT,            -- 关联的实例列表
    attribuly_api_key_hash TEXT,     -- 脱敏后的 key 指纹
    tier TEXT,                       -- basic / pro / enterprise
    onboarded_at TEXT
);
```

### 6.3 数据采集增强（需 agent 升级）

现有 `allyclaw-agent.py` 只采集 message 级别数据。要支撑事件表，需扩展：

1. **解析 OpenClaw JSONL 中的 `toolCall` 记录** → 写入 `execution_events` 表
2. **解析 `thinking` 记录** → 不存储内容（保护隐私），只记录 thinking token 数
3. **解析 `usage.cost` 字段** → 记录成本维度

Agent 扩展由 `allyclaw-context-dashboard` 的下一版本承担，Intelligence 项目只消费。

---

## 7. 问题分类体系

### 7.1 分类原则

- **业务导向**：分类反映业务场景，不是技术 taxonomy
- **两级结构**：L1 粗粒度（10 个），L2 细粒度（约 50 个）
- **可扩展**：每月根据新问题调整一次
- **多标签**：一个问题可以同时属于多个分类

### 7.2 一级分类（L1）

| ID | 分类 | 描述 | 典型问题 |
|----|------|------|---------|
| 1 | **数据概览** | 整体表现摘要 | "今天收入多少"、"这周怎么样" |
| 2 | **异常诊断** | 为什么下降/异常 | "revenue 怎么跌了"、"ROAS 为啥变差" |
| 3 | **渠道对比** | 多渠道性能比较 | "Meta vs Google 哪个好" |
| 4 | **Campaign 优化** | 单 campaign 层面分析 | "哪个 campaign 在浪费预算" |
| 5 | **Revenue 变化** | 收入维度趋势分析 | "上周收入变化原因" |
| 6 | **Attribution 解释** | 归因模型和路径分析 | "为什么这个订单归到 X 渠道" |
| 7 | **广告投放建议** | 如何优化投放 | "Meta 预算应该加还是减" |
| 8 | **用户旅程** | CRM / audience / journey | "用户从哪里来到哪里去" |
| 9 | **数据可用性** | tracking、API、数据缺失 | "为什么没数据"、"tracking 没配好" |
| 10 | **平台操作** | 如何使用、报告生成 | "怎么导出报告"、"这个功能在哪" |

### 7.3 二级分类示例（L2，以「异常诊断」为例）

- `2.1` Revenue 下跌
- `2.2` ROAS 下降
- `2.3` Spend 上升效果变差
- `2.4` 单渠道波动
- `2.5` Campaign 突然失效
- `2.6` Conversion rate 下滑
- `2.7` Tracking 数据缺失
- `2.8` Audience 质量下降

### 7.4 分类实现方式

**MVP 阶段**：基于关键词规则 + LLM 少量标注

- 用现有 `worker/src/routes/ingest.ts` 中的 `categorizeQuestion` 作为一级分类起点
- 扩展 L1 规则库到 10 个分类
- 对规则无法覆盖的问题，每周批量用 Claude Haiku 做 L1+L2 分类（成本可控）

**第二阶段**：训练轻量分类器

- 使用积累的标注数据训练 embedding + classifier
- 成本 / 准确率权衡

### 7.5 输出统计

系统自动维护：

- **高频问题 Top 20**（按 L1 / L2 / team / 全局）
- **高失败率问题 Top 20**
- **高价值问题 Top 20**（基于响应完整度 + 用户无追问）
- **新出现的问题类型**（过去 7 天首次出现、本周出现次数 ≥ 3）
- **每个团队的问题结构画像**

---

## 8. Skill / API 调用分析设计

### 8.1 分析的核心问题

#### 8.1.1 Skill 选择正确性

对每个 session，评估：

| 指标 | 含义 | 判定方法 |
|------|------|---------|
| `skill_hit_correctness` | 调用的 skill 是否适合该问题 | 基于问题 L1 与 skill 预期匹配表 |
| `skill_missing` | 是否漏调用某个 skill | 基于成功会话的 skill 链路模式对比 |
| `skill_over_invocation` | 是否调用了不必要的 skill | 检测调用后无下游使用的 skill |
| `skill_timing` | 调用时机是否合理 | 是否在追问后才调用（过晚） |

#### 8.1.2 API 调用效率

| 指标 | 含义 | 判定方法 |
|------|------|---------|
| `api_redundancy` | 重复请求率 | 同 params_hash 的重复调用 |
| `api_granularity` | 请求粒度合理性 | 拉全量 attribution vs 拉 summary |
| `api_missing_params` | 缺少关键参数 | 基于 API schema 与业务需求 |
| `api_sequence_optimality` | 调用顺序 | metrics → channels → campaigns 是否合理 |

#### 8.1.3 整体效率

- 平均响应耗时（p50 / p95 / p99）
- API 链路长度（次数）
- 平均 token 使用量（input + output）
- 不同问题类型下的成功调用路径（pattern mining）

### 8.2 调用链分析算法

**MVP 阶段用简单规则**：

```
1. 按 question_category 分组所有 session
2. 对每组，计算：
   - 成功会话的 skill/api 调用序列频次
   - 最短成功路径（shortest successful path）
   - 失败会话与成功会话的路径差异
3. 输出"黄金路径"（Golden Path）和"反模式"（Anti-pattern）
```

**第二阶段**：用序列挖掘算法（如 PrefixSpan）自动发现模式。

### 8.3 输出示例

```yaml
pattern: "Revenue dropped diagnosis"
golden_path:
  - skill: attribuly_metrics
    api: /metrics/daily
    duration_p50_ms: 450
  - skill: attribuly_channels
    api: /channels/compare
    duration_p50_ms: 680
  - skill: attribuly_campaigns
    api: /campaigns/delta
    duration_p50_ms: 900
  - skill: insight_synthesis
    api: none
    duration_p50_ms: 2100

anti_patterns:
  - id: AP-001
    description: "直接拉 attribution 全量，忽略 delta"
    frequency: "27% of failed sessions"
    fix: "先调 delta API 定位异常 campaign，再拉 attribution"

  - id: AP-002
    description: "跳过 channel 层直接看 campaign"
    frequency: "18% of failed sessions"
    fix: "缺少渠道大盘导致下结论过早"
```

---

## 9. 上下文与 Prompt 优化层

### 9.1 优化对象

- **system prompt**（OpenClaw 系统级提示词）
- **skill prompt**（Attribuly skill 的主提示词）
- **tool descriptions**（工具描述文案）
- **context assembly logic**（如何组装历史对话）
- **few-shot examples**（示例库）
- **error recovery strategies**（错误处理）
- **answer formatting rules**（回答格式规则）

### 9.2 待识别的问题

| 问题类型 | 识别方式 |
|---------|---------|
| 上下文太长导致漂移 | 会话长度 vs 成功率负相关 |
| Prompt 规则不明确 | skill 命中但内容误答率高 |
| Tool 描述与用户用词不匹配 | 用户原始问题 vs tool name 相似度低 |
| 同类问题回答风格不一致 | 同类问题回答 embedding 方差大 |
| 缺少关键 few-shot | 某类问题低成功率但样本多 |

### 9.3 输出形式

系统产出的建议示例：

```markdown
[Suggestion #S-2026-0414-017]
Title: Revenue drop diagnosis 缺少 campaign-level few-shot

Type: Prompt Optimization
Track: Manual
Priority: P1

Description:
「revenue 下跌」类问题共 34 条，其中 22 条回答停留在「渠道大盘分析」
层面，未下钻到 campaign。用户追问率 73%。

Root Cause:
当前 Attribuly skill prompt 中 few-shot 只涵盖了「渠道对比」场景，
缺少「campaign-level delta analysis」示例。

Suggested Action:
在 skill prompt 中新增 1 个 few-shot：
  - 用户问题：上周 revenue 突然下跌
  - 正确调用链：metrics → channels → campaigns(delta) → insight
  - 期望输出格式：按 campaign 列出贡献变化 Top 5

Evidence:
  - 22 个失败会话 ID（点击查看）
  - 平均 token 消耗：12,400
  - 对照组（成功会话）平均 token：8,600

Estimated Value:
  - 成功率预计提升 +25%
  - Token 消耗预计降低 -30%
  - A/B Testable: YES
```

---

## 10. 自主优化机制

### 10.1 可自主优化的范围

**严格限制在低风险、可审计、可回滚的参数**：

| 类别 | 可自主操作 | 示例 |
|------|-----------|------|
| ✅ 路由参数 | 允许 | 某类问题路由到哪个 skill |
| ✅ 分类器规则 | 允许 | 新增一个 L2 分类规则 |
| ✅ 缓存 TTL | 允许 | 高频 API 缓存时长 |
| ✅ 排序权重 | 允许 | 报告内容优先级 |
| ✅ 可控 prompt 片段 | 允许 | 标准化时间范围解析规则（预定义片段） |
| ❌ 核心业务逻辑 | 禁止 | skill 调用链的主控制流 |
| ❌ API 权限规则 | 禁止 | 高风险 API 访问控制 |
| ❌ 合规相关输出 | 禁止 | 敏感数据脱敏规则 |
| ❌ skill 主 prompt 覆盖 | 禁止 | 只能提建议，不能直接改 |

### 10.2 自主优化执行流程

```
1. 优化引擎从 optimization_suggestions 表中筛选 track='autonomous' 的条目
2. 通过预定义的安全检查（影响范围、风险等级、回滚方案）
3. 生成变更 PR（GitHub PR 或配置仓库 commit）
4. 自动应用到灰度环境（10% 流量）
5. 24 小时后对比灰度 vs 生产的关键指标
6. 通过 → 全量发布；不通过 → 自动回滚 + 标记为人工处理
```

### 10.3 审计与回滚

每次自主优化必须记录：

- 变更内容（diff）
- 触发原因（关联的 suggestion id）
- 应用时间、执行者（system 或 admin）
- 灰度观察期指标
- 回滚条件与方案
- 当前状态（active / rolled_back）

---

## 11. 人工优化机制

### 11.1 人工优化池分类

| 分类 | 说明 | 目标角色 |
|------|------|---------|
| **Skill 设计优化** | 拆分 skill、调整输入输出协议、修改 skill 描述 | Skill 开发 |
| **API 能力优化** | 新增聚合接口、改细粒度、加缓存、预计算 | 后端工程师 |
| **Prompt / Context 优化** | 加 few-shot、加反例、缩减上下文 | Skill 开发 |
| **产品侧优化** | 新增报告模式、诊断模式、分析深度选择 | 产品经理 |

### 11.2 优化建议标准格式

每条建议统一结构：

```yaml
id: S-<date>-<seq>
title: <简短标题>
type: skill_redesign | api_optimize | prompt_fix | product_feature
track: manual
priority: P0 | P1 | P2 | P3
impact_scope:
  teams: [team_a, team_b, ...]   # 或 "all"
  estimated_affected_sessions: 120
  affected_metrics: ["success_rate", "token_cost"]
evidence:
  session_samples: [id1, id2, ...]
  root_cause: <分析结论>
  supporting_data:
    - metric: ...
      value: ...
suggested_action: <具体操作>
estimated_value:
  success_rate_delta: "+25%"
  token_cost_delta: "-30%"
  response_time_delta: "-200ms"
ab_testable: true
status: open
assignee: null
created_at: <timestamp>
```

### 11.3 人工优化工作台 UI

- **看板视图**：按 priority 和 type 分列
- **筛选**：按 team / skill / API / 日期范围
- **详情页**：证据、样本对话、调用链、指标对比图
- **状态流转**：open → in_progress → applied → verified / rolled_back

---

## 12. 报告系统设计

### 12.1 每日报告

**受众**：运营、产品
**生成时间**：每天 UTC 00:00（北京时间 08:00）

**内容结构**：

1. 顶部卡片：昨日总会话、活跃团队、成功率、平均响应耗时
2. 高频问题 Top 10（含分类标签）
3. 失败问题 Top 10（含失败类型）
4. 最低效调用链 Top 5（含建议）
5. 新出现的问题模式
6. 自主优化动作列表（昨日执行）
7. 待人工处理建议列表（新增）

**输出**：Markdown + HTML + 可选邮件 / Slack 通知

### 12.2 每周报告

**受众**：管理层、产品负责人
**生成时间**：每周一 UTC 01:00

**内容结构**：

1. 本周整体使用趋势（环比、同比）
2. 各团队使用情况对比（活跃度、成功率、Token）
3. 问题分类分布变化（本周 vs 上周）
4. 回答成功率变化
5. Skill 命中率 / 成功率趋势
6. API 调用效率变化（响应耗时、重复率）
7. 本周新增失败模式
8. 本周完成的自主优化项（含效果评估）
9. 本周需要开发介入的优化建议
10. 下周重点优化方向（由系统自动推荐 + 人工 review）

### 12.3 优化建议面板

**受众**：开发、产品、运营
**实时更新**

**核心视图**：

- **工单列表**：可按优先级、类型、状态、受众筛选
- **工单详情**：证据、调用链、样本、可回溯原始会话
- **处理状态**：流转历史、评论、关联变更
- **效果追踪**：已 applied 工单的指标前后对比

### 12.4 团队对比面板

**受众**：运营、管理层

- 所有团队在一个表格中排序（活跃度、成功率、Token、使用深度）
- 支持按时间范围对比
- 单团队详情页展示：问题画像、常用 skill、成功率趋势

---

## 13. 权限与安全

### 13.1 数据分层

| 数据类型 | 敏感级别 | 处理方式 |
|---------|---------|---------|
| 用户原始问题 | 高 | 团队隔离，默认团队内可见 |
| 系统回答内容 | 高 | 同上 |
| Skill / API 元数据 | 中 | 平台管理员可见 |
| 聚合统计（问题频次等） | 低 | 可跨团队汇总 |
| Attribuly API Key | 极高 | 只存哈希指纹，不存明文 |

### 13.2 角色权限

| 角色 | 可见数据范围 | 可执行操作 |
|------|------------|-----------|
| 业务用户 | 本团队数据 | 查看报告、反馈 |
| Skill 开发 | 所有团队聚合数据、脱敏样本 | 查看建议、提交优化 |
| 产品 | 所有团队聚合数据 | 查看、标注 |
| 运营 | 所有团队数据 | 查看、管理团队配置 |
| 平台管理员 | 全部 | 系统配置、自主优化审批 |

### 13.3 脱敏规则

- 跨团队共享的样本对话：自动脱敏团队名、产品名、数值（保留数量级）
- 对外报告：不出现团队原始名称、API 明文
- 日志存档：7 天后自动匿名化用户问题中的专有名词

### 13.4 审计

- 所有数据访问记录（谁、何时、查了什么）
- 所有自主优化变更记录（不可删除）
- 所有权限变更记录

---

## 14. MVP 范围

### 14.1 MVP 只做这 5 件事

1. **扩展数据采集**：升级 agent + Worker，记录 `execution_events`
2. **问题分类体系**：实现 L1 十分类 + 规则+LLM 混合分类
3. **失败识别与调用链分析**：识别失败会话、挖掘调用模式
4. **日报 / 周报**：自动生成 Markdown 报告
5. **优化建议池**：产出人工优化建议（不做自主优化）

### 14.2 MVP 明确不做

- 全自动 prompt 重写
- 全自动 skill 版本发布
- 在线强化学习
- 自主直接修改生产逻辑
- 多租户账号系统（沿用现有身份机制）
- 复杂权限后台（先用简单角色表）

### 14.3 MVP 验收标准

| 指标 | 目标 |
|------|------|
| 事件采集覆盖率 | ≥ 90% 的会话有完整 skill / api 事件 |
| 问题分类准确率 | L1 分类人工抽检 ≥ 85% |
| 失败识别准确率 | 人工抽检 ≥ 80% |
| 每周建议产出量 | ≥ 10 条高质量建议 |
| 建议质量 | 人工评审「有用」比例 ≥ 60% |
| 报告按时产出 | 日报 7:00 前、周报周一 9:00 前 |

---

## 15. 里程碑规划

### Phase 1：可观测性建设（第 1-6 周）

**目标**：先看见

| 周次 | 交付 |
|-----|------|
| W1 | 项目初始化、数据模型设计评审通过 |
| W2-3 | agent + Worker 升级：事件表、调用链采集 |
| W4 | 问题分类 L1 规则库 + LLM fallback |
| W5 | 成功 / 失败会话识别 |
| W6 | 初版日报 / 周报上线 |

**Exit Criteria**：能看到团队级的会话统计、Top 问题、成功率

### Phase 2：诊断与建议（第 7-12 周）

**目标**：先找到问题

| 周次 | 交付 |
|-----|------|
| W7-8 | 调用链模式挖掘（Golden Path / Anti-pattern） |
| W9 | 上下文缺口识别（few-shot 缺失等） |
| W10 | 优化建议池 + 工作台 UI |
| W11 | 团队画像分析 |
| W12 | 对比面板 + 第一次完整周报评审 |

**Exit Criteria**：每周产出 ≥ 10 条建议、人工评审可用率 ≥ 60%

### Phase 3：低风险自主优化（第 13-18 周）

**目标**：先自动优化一部分

| 周次 | 交付 |
|-----|------|
| W13-14 | 自主优化引擎框架 + 审批流 |
| W15 | 灰度发布 + 监控 + 回滚机制 |
| W16 | 路由规则自主优化 |
| W17 | 缓存策略自主优化 |
| W18 | 自主优化效果评估报告 |

**Exit Criteria**：≥ 3 个自主优化动作上线并有正向收益

### Phase 4：持续学习与策略迭代（第 19-24 周）

**目标**：形成闭环

| 周次 | 交付 |
|-----|------|
| W19-20 | 优化前后效果评估框架（A/B 测试） |
| W21 | skill / prompt 版本实验系统 |
| W22 | 长期知识库（FAQ、已知问题、黄金路径） |
| W23 | Agent Ops 方法论文档 |
| W24 | Phase 4 整体评审 |

**Exit Criteria**：优化后回答成功率提升 ≥ 15%，闭环机制文档化

---

## 16. KPI 定义

### 16.0 KPI 设计原则

1. **绝对值优先**：所有质量指标使用百分点（pp），避免「+15%」相对/绝对二义性
2. **基线驱动**：M1 必须先测出基线 B，后续目标都是 B + Δ
3. **月度节点**：每个月有明确的可验证目标，避免最后一个月"突击"
4. **承诺保守**：宁可超额完成不要打不到，目标基于现实改进曲线
5. **测量先于优化**：M1 不设质量提升目标，专注采集与基线测量

### 16.1 效果类（核心）

> 单位：pp = 百分点（绝对差），% = 相对百分比
> 基线 B 在 M1 测出，是项目启动时的实际值

| 月份 | 主要工作 | 成功率 | 追问率 | 重复提问率 | 用户不满率 |
|------|---------|--------|--------|-----------|-----------|
| **M1** | 基线测量、采集打通 | B + 0pp | B + 0pp | B + 0pp | 建采集 |
| **M2** | 分类体系、日报上线 | B + 2pp | -2pp | -3pp | 建基线 |
| **M3** | 失败识别、首批人工建议落地 | B + 5pp | -5pp | -7pp | -3pp |
| **M4** | 自主路由优化、缓存策略 | B + 7pp | -8pp | -12pp | -7pp |
| **M5** | 上下文优化、深度建议 | B + 9pp | -12pp | -16pp | -12pp |
| **M6** | A/B 实验、闭环验证 | **B + 10pp** | **-15pp** | **-20pp** | **-18pp** |

**指标定义**：

| 指标 | 计算方式 |
|------|---------|
| 成功率 | `count(success_label='success')` / `count(*)` |
| 追问率 | 当前会话后 30min 内同用户再开新会话或继续追问的比例 |
| 重复提问率 | 同用户 7 天内提出相似问题（normalized_text 相同）的比例 |
| 用户不满率 | `user_sentiment IN ('negative','frustrated')` 占比 |

**高价值回答占比**（独立指标，不在曲线中）：
- M3 起开始统计，目标 M6 ≥ 15%
- 定义：人工标注 = high_value 的会话占比

### 16.2 效率类

| 月份 | 响应时间 (p50) | Skill 调用 | API 调用 | Token 消耗 | 缓存命中 |
|------|---------------|-----------|----------|-----------|---------|
| **M1** | 基线 | 基线 | 基线 | 基线 | 测量 |
| **M2** | -3% | -3% | -5% | -5% | 5% |
| **M3** | -10% | -8% | -12% | -10% | 12% |
| **M4** | -18% | -13% | -18% | -15% | 22% |
| **M5** | -25% | -17% | -22% | -20% | 32% |
| **M6** | **-30%** | **-20%** | **-25%** | **-25%** | **40%** |

**指标定义**：

| 指标 | 计算方式 |
|------|---------|
| 响应时间 (p50) | 用户提问到首条 assistant 文本回复的延迟，取 P50 |
| Skill 调用 | 每会话平均 skill_call 事件数 |
| API 调用 | 每会话平均 api_call 事件数 |
| Token 消耗 | 每会话平均 (input_tokens + output_tokens) |
| 缓存命中 | `count(cache_hit=1)` / `count(*)` |

### 16.3 优化类

| 月份 | 周均发现问题 | 周均关闭问题 | 自主优化命中率 | 人工采纳率 |
|------|------------|------------|--------------|----------|
| **M1** | 0 | 0 | — | — |
| **M2** | 5 | 2 | — | — |
| **M3** | 10 | 5 | — | 30% |
| **M4** | 12 | 8 | 70% | 40% |
| **M5** | 15 | 10 | 75% | 45% |
| **M6** | **15** | **12** | **80%** | **50%** |

**指标定义**：

| 指标 | 计算方式 |
|------|---------|
| 周均发现问题 | 每周新增 `optimization_suggestions.status='open'` 数量 |
| 周均关闭问题 | 每周状态变为 `applied` 或 `rejected` 的数量 |
| 自主优化命中率 | `track='autonomous'` 中通过灰度评估的比例 |
| 人工采纳率 | `track='manual'` 中状态为 `applied` 的比例（已 review 中） |

### 16.4 Skill 层 KPI（核心新增）

> Skill 是回答质量的上游。优化 prompt / context 是治标，**升级 skill 才是治本**。
> 本节专门追踪 Attribuly skill（及未来其他 skill）的健康度和迭代速度。

#### 16.4.1 单 Skill 健康度

为每个已注册的 skill（如 `attribuly_metrics`、`attribuly_attribution`、`attribuly_diagnose` 等子能力）追踪：

| 指标 | 计算方式 | M6 目标 |
|------|---------|---------|
| Skill 调用成功率 | 调用了该 skill 的会话中 success_label='success' 的占比 | ≥ 80% |
| Skill 错误率 | `count(status='error') / count(*)` | ≤ 5% |
| Skill 平均响应时间 | 该 skill 事件的 avg duration_ms | -30% vs 基线 |
| Skill 平均 token 成本 | 每次 skill 调用平均消耗 token | -20% vs 基线 |
| Skill 贡献度 | 在成功会话中，该 skill 是否在调用链中（命中率） | ≥ 90% 高频场景命中 |
| Skill 必要性 | 调用了该 skill 但未使用其结果的会话比例 | ≤ 10% |

#### 16.4.2 Skill 迭代速度

| 月份 | Skill 升级数 | 新建 Skill 数 | 升级后成功率提升 |
|------|------------|------------|--------------|
| **M1** | 0（基线） | 0 | — |
| **M2** | 1 | 0 | — |
| **M3** | 2 | 1 | +3pp |
| **M4** | 3 | 1 | +5pp |
| **M5** | 3 | 2 | +6pp |
| **M6** | **4** | **2** | **+8pp** |

- "升级"指 skill 版本号变化（如 v1 → v2）
- "新建"指识别出能力缺口后开发的全新 skill
- "升级后提升"是该 skill 升级前 30 天 vs 升级后 30 天的成功率差

#### 16.4.3 Skill 覆盖率

| 月份 | 高频场景 Skill 覆盖 | 失败场景 Skill 缺口 | Skill 之间重叠率 |
|------|-------------------|------------------|--------------|
| **M1** | 测量 | 测量 | 测量 |
| **M3** | 70% | 识别 ≥ 5 处 | < 30% |
| **M6** | **90%** | **识别 ≥ 15 处，关闭 ≥ 8 处** | **< 15%** |

- **覆盖**：高频问题分类是否有专门 skill 服务
- **缺口**：失败会话中"找不到合适 skill"的问题数
- **重叠**：两个 skill 都能处理同一问题且效果相近

#### 16.4.4 Skill 优化产出 KPI

为 skill 优化建立专门的工单分类：

| 工单类型 | M3 目标 | M6 目标 |
|---------|--------|--------|
| `skill_prompt_fix`（prompt 微调） | 8 条 | 24 条累计 |
| `skill_redesign`（重新设计） | 1 条 | 5 条累计 |
| `skill_split`（拆分子能力） | 0 | 2 条累计 |
| `skill_new`（新建 skill） | 1 条 | 4 条累计 |
| `skill_retire`（废弃合并） | 0 | 1 条累计 |

#### 16.4.5 Skill ↔ 业务效果关联

最重要的指标 — 验证"优化 skill 真的让用户更满意"：

| 指标 | 定义 | M6 目标 |
|------|------|---------|
| Skill 升级 ROI | 每次升级带来的 success_rate 提升 | 平均 ≥ +2pp / 次 |
| Skill 升级生效时长 | 升级后多久能稳定看到效果 | ≤ 14 天 |
| Skill 升级回滚率 | 升级后因负面影响回滚的比例 | ≤ 10% |
| 新建 Skill 命中率 | 新 skill 上线 30 天内被实际调用的占比 | ≥ 70% |

#### 16.4.6 Skill 故障模式分类（Failure Mode Taxonomy）

只统计"失败"远不够。同样是失败，治理路径完全不同。建立故障分类体系：

| 故障类型 | 表现 | 治理方向 | 主要责任 |
|---------|------|---------|---------|
| `timeout` | API 调用超时（> 30s） | 加缓存、API 优化、降级 | 后端 |
| `schema_mismatch` | LLM 给的参数 API 不接受 | 改 skill prompt 中 schema 描述 | Skill 开发 |
| `empty_result` | API 返回空数据 | 上游补全、提醒用户 | 数据团队 |
| `hallucination` | Skill 编造未证实数据 | 加 grounding、强制引用 | Skill 开发 |
| `wrong_skill` | 调错 skill 处理不了 | 改路由、改 skill 描述 | Skill 开发 |
| `partial_answer` | 调对了但答不全 | 加 few-shot、强化输出格式 | Skill 开发 |
| `auth_error` | API key 失效或权限不足 | 配置层修复 | 运营 |
| `rate_limit` | 触发 API 限流 | 加缓存、错峰、升级套餐 | 后端 |
| `format_error` | 输出格式错误（如非法 JSON） | 加 retry / 强 prompt | Skill 开发 |
| `unknown` | 无法分类 | 进人工 review 队列 | 平台 |

**KPI**：
- M3：完成 80% 失败会话的故障分类
- M6：每类故障各有对应的优化路径，未分类率 < 10%
- 各故障类型环比下降（如 timeout 率每月降 -10%）

#### 16.4.7 Skill 协作图分析（Skill DAG）

挖掘 skill 之间的关系，识别冗余与缺口：

**分析维度**：

| 模式 | 信号 | 优化方向 |
|------|-----|---------|
| **共现** | A 与 B 90% 一起调用 | 候选合并为宏 skill |
| **替代** | A 和 B 在相似场景互相替代 | 重叠，候选裁剪一个 |
| **顺序固定** | 总是 A → B → C | 候选打包成 pipeline |
| **错位** | A → C，但 A → B → C 成功率更高 | 缺中间 B，应补 |

**输出**：
- 每周生成 Skill 协作图（可视化 DAG）
- 自动产出"合并候选"、"裁剪候选"、"补缺候选"工单
- M6 目标：识别 ≥ 5 处优化机会，落地 ≥ 3 处

#### 16.4.8 Skill I/O 质量分析

**输入侧**：
- 参数提取准确率（用户问题 → skill 参数）
- 各参数字段的错误率（时间范围、渠道、metric 名）
- 缺失参数自动补全率

**输出侧**：
- 输出 schema 漂移检测（同一 skill 不同版本字段对比）
- 字段缺失率、空值率
- 输出对下游 skill 的可消费率

| 指标 | M3 | M6 |
|------|----|----|
| 参数提取准确率 | ≥ 85% | ≥ 95% |
| 输出 schema 一致性 | 监控 | 100%（无 breaking change） |
| 字段缺失率 | ≤ 10% | ≤ 5% |
| 下游可消费率 | ≥ 80% | ≥ 95% |

#### 16.4.9 Skill 性价比矩阵（Cost-Value Quadrant）

每个 skill 在二维平面上定位：

```
       价值高
        ↑
  [推广]│ [明星]
   高成本│ 低成本
   保留  │ 保留
─────────────→ 成本
   裁剪 │ 边缘
   候选 │ 观察
  低价值│低价值
        ↓
```

**价值定义**：贡献度 = (该 skill 出现在成功会话的次数 × 难替代度)
**成本定义**：调用频次 × 平均 token 消耗 × API 调用成本

**月度产出**：四象限报告，明确每个 skill 的归属象限和趋势变化（升 / 稳 / 降）

**KPI**：
- M3：所有活跃 skill 完成首次性价比定位
- M6：「裁剪候选」象限的 skill 数量减少 50%（被优化或下线）

#### 16.4.10 Skill 回归测试集（Golden Questions）

每个 skill 维护一组金标问题。**升级前必跑回归**，回归失败禁止上线。

**Golden Question 数据结构**：

```yaml
golden_question:
  id: GQ-attribuly-metrics-001
  skill_id: attribuly_metrics
  question: "上周收入是多少"
  expected_chain:
    - skill: attribuly_metrics
    - api: /metrics/daily
      params: {period: "last_week"}
  expected_output_schema:
    must_have_fields: ["total_revenue", "currency", "period"]
  performance_targets:
    max_duration_ms: 2000
    max_tokens: 5000
  validation_rules:
    - "total_revenue must be positive number"
    - "currency must be valid ISO 4217"
```

**KPI**：

| 指标 | M3 | M6 |
|------|----|----|
| 每个 active skill 的 golden questions 数 | ≥ 5 | ≥ 20 |
| 回归测试覆盖率 | 60% | 100% |
| 升级回归失败率 | 监控 | < 5% |
| 回归发现的 bug 数 / 总 bug | 监控 | ≥ 70% |

**回归失败的处置**：自动阻止 skill 升级 PR 合并、生成详细对比报告、通知 owner

#### 16.4.11 Skill 团队差异化（Personalization）

同一个 `attribuly_metrics`，不同行业团队用法天差地别：
- **DTC 服装**：关心 SKU、变体、季节性
- **SaaS 工具**：关心 LTV、churn、cohort
- **B2B 企业**：关心 lead source、deal pipeline

**分析维度**：
- 同 skill 在不同团队的 success_rate 方差
- 团队特有的失败模式
- 团队特有的高频参数

**优化方向**（按风险递增）：

| 等级 | 操作 | 风险 |
|-----|------|------|
| L1 | 团队级 few-shot 注入 | 极低 |
| L2 | 团队级 prompt 片段定制 | 低 |
| L3 | 团队级 routing 规则 | 中 |
| L4 | 团队级 skill fork | 高 |

**KPI**：
- M5：识别 ≥ 3 个跨团队差异显著的 skill
- M6：完成至少 2 个 skill 的 L1-L2 个性化，团队 success_rate 差异收窄 50%

#### 16.4.12 Skill 自评机制（Confidence & Self-Evaluation）

让 skill 输出时附带置信度，让系统能"自己识别没答好"：

**置信度等级**：

| 等级 | 阈值 | 系统行为 |
|------|------|---------|
| `high` | ≥ 0.8 | 直接输出 |
| `medium` | 0.5 - 0.8 | 加上"以下分析基于 X，可能不完全"等免责 |
| `low` | < 0.5 | 主动追问澄清 / 降级到通用回答 / 标记需人工 |

**置信度的产生方式**：

1. **数据完整性**：API 返回字段是否完整
2. **时间范围匹配**：用户问的时间范围是否被完整覆盖
3. **模型自评**：让 LLM 在生成答案时同时输出 confidence
4. **历史校准**：同类问题的历史成功率作为先验

**KPI**：

| 指标 | M3 | M6 |
|------|----|----|
| 启用置信度的 skill 数 | 1（试点） | 全部活跃 skill |
| 置信度准确率（高置信会话的实际成功率） | ≥ 85% | ≥ 95% |
| 低置信会话的主动追问率 | 试点 | ≥ 80% |
| 用户对置信度提示的接受度 | 收集反馈 | ≥ 70% |

**长期价值**：让 Skill 学会说"我不确定"，比强行编造答案更可靠。

#### 16.4.13 与 ClawHub 集成

Attribuly skill 发布在 [ClawHub](https://clawhub.ai/alexchulee/attribuly)，需要建立：

- **版本同步**：ClawHub 的 skill 版本变更自动同步到 `int_skill_versions` 表
- **效果反馈**：每次升级后 30 天报告自动写回 ClawHub PR comment（如可能）
- **缺口反向贡献**：识别出的能力缺口可作为 skill 路线图输入

---

### 16.6 业务类

| 月份 | 团队活跃度 | 团队留存 | 高频场景覆盖 | 高价值问题覆盖 |
|------|-----------|---------|------------|--------------|
| **M1** | 测量 | 基线 | 测量 | 测量 |
| **M2** | 50% | 75% | 60% | 50% |
| **M3** | 60% | 80% | 70% | 60% |
| **M4** | 65% | 82% | 78% | 68% |
| **M5** | 68% | 84% | 85% | 75% |
| **M6** | **70%** | **85%** | **90%** | **80%** |

**指标定义**：

| 指标 | 计算方式 |
|------|---------|
| 团队活跃度 | 过去 7 天有 ≥1 会话的团队 / 总团队 |
| 团队月留存 | 上月活跃 & 本月仍活跃的团队 / 上月活跃团队 |
| 高频场景覆盖 | Top 20 高频问题中 success_rate ≥ 80% 的占比 |
| 高价值问题覆盖 | 高价值问题中已有"黄金路径" Golden Path 的占比 |

### 16.7 KPI 评审节奏

- **每月第一周**：上月 KPI 总结报告，与目标对比
- **未达标处理**：连续两个月未达单项 KPI → 触发评估会议，决定是调整目标还是加强执行
- **超额处理**：连续两个月超额完成 → 上调下个月目标 5-10%
- **季度复盘**：每 3 个月做一次大复盘，调整 KPI 体系本身

---

## 16.8 Month 1 基线测量 SOP

Month 1 是整个项目最关键的月份。所有后续 KPI 都建立在这个月测出的基线上，**测错就全错**。

### 16.8.1 必须测出的基线值

| 基线值 | 来源 | 测量方法 |
|-------|------|---------|
| `B_success_rate` | 全量对话 | 会话级标注，见 16.5.3 |
| `B_followup_rate` | 全量对话 | 同用户 30min 内行为追踪 |
| `B_repeat_rate` | 全量对话 | 7 天滚动窗口比对 normalized_text |
| `B_response_p50` | 全量事件 | 从首条 user message 到首条 assistant text 的 ms 差 |
| `B_skill_calls_avg` | 全量事件 | `execution_events` 按 session 聚合 |
| `B_api_calls_avg` | 全量事件 | 同上 |
| `B_token_avg` | 全量事件 | sum(input + output) / session count |
| `B_cache_hit_rate` | 全量事件 | `count(cache_hit=1) / count(*)` |
| `B_team_active_rate` | 团队级 | 过去 7 天有会话的团队 / 总团队 |

### 16.8.2 success_label 判定规则

判定优先级（从上往下匹配）：

```
1. 如果 assistant 最后一条消息明显拒答（包含 "无法"、"抱歉，我不能" 等关键词）
   → refuse
2. 如果会话有 error 事件且最终未恢复（最后回复为空或错误信息）
   → failure
3. 如果用户在 30min 内追问了相似问题（重复提问）
   → partial
4. 如果会话长度 > 10 轮，且最后 3 轮都是用户追问
   → partial
5. 如果 assistant 给出了完整数据/分析回复，用户没有追问
   → success
6. 其他情况
   → unknown（人工 review）
```

**注意**：
- 该规则基于规则匹配，准确率约 70-80%
- 用 LLM (Claude Haiku) 作为补充判定，覆盖规则未匹配的情况
- 每周抽样 50 条人工 review，校准准确率

### 16.8.3 标注流程

```
全量历史会话
  ↓
[规则判定] → 大部分会话快速打标签
  ↓
[LLM 判定] → 处理规则未覆盖的会话
  ↓
[人工抽样 review] → 50 条/周，纠正系统偏差
  ↓
[置信度 > 0.8] 入库为 success_label
[置信度 < 0.8] 标记为 unknown，进人工队列
```

### 16.8.4 反偏差措施

避免基线测量偏差的三个保护：

1. **多分类器交叉验证**：规则、LLM Haiku、LLM Sonnet 三套独立打标签，看一致性
2. **时段均衡**：不要只取最近 7 天，取过去 60 天均匀采样，避免周期性偏差
3. **团队均衡**：不能让某个高活跃团队主导基线，按团队加权后再算总体

### 16.8.5 基线锁定

M1 末（约第 4 周末）：

- [ ] 基线测量报告发出
- [ ] 团队评审会议确认基线值
- [ ] 基线值写入 `int_kpi_baselines` 表（不可修改，只能新增版本）
- [ ] 后续所有 KPI 报告以 `baseline_version=v1` 为参照

```sql
CREATE TABLE int_kpi_baselines (
    baseline_version TEXT PRIMARY KEY,        -- v1, v2, ...
    measured_at      TEXT NOT NULL,
    sample_size      INTEGER NOT NULL,
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,
    metrics_json     TEXT NOT NULL,           -- 所有基线值
    notes            TEXT,
    locked           INTEGER DEFAULT 1
);
```

如果将来发现 v1 基线测量错了，可以发布 v2 基线，但 v1 永久保留作为历史参照。

---

## 17. 风险点与应对

| 风险 | 可能后果 | 应对 |
|------|---------|------|
| **过早追求自学习** | 不可控变更、生产事故 | MVP 严格不做自动 prompt 重写，优化全部人工审批 |
| **只看最终回答** | 漏掉调用链问题 | 强制四维分析：问题 + 调用链 + API 数据 + 回答 |
| **把所有问题归因于 prompt** | 忽视 API 粒度、缓存、skill 拆分 | 根因分析必须覆盖 4 个层次 |
| **缺版本管理** | 改完不知道改对了没 | 每次优化必有 diff + 原因 + 审批 + 前后对比 |
| **数据权限泄漏** | 团队间数据混淆 | 硬编码团队隔离、脱敏默认开启、审计日志 |
| **分类器漂移** | 新问题被错误归类 | 每月人工抽检 + 规则库滚动更新 |
| **报告无人看** | 价值无法验证 | 报告必须可点击下钻、可反馈有用/无用 |

---

## 18. 技术栈建议

沿用现有基础设施，尽量不引入新运维负担：

| 层 | 方案 |
|----|------|
| 存储 | Cloudflare D1（复用 allyclaw-db，新增表） |
| 计算 | Cloudflare Worker（分析任务） + Scheduled Workers（定时报告） |
| LLM 分类 / 建议生成 | Claude Haiku（成本低）+ Claude Sonnet（复杂建议） |
| 工作台 UI | 扩展现有 dashboard.html 或新建 Cloudflare Pages 子项目 |
| 通知 | 邮件 / Slack / Feishu Webhook |
| 版本管理 | GitHub（所有规则、prompt 片段纳入 git） |

---

## 19. 附录

### 19.1 术语表

| 术语 | 定义 |
|------|------|
| **Session（会话）** | 用户一次完整对话，从打开到关闭 |
| **Message** | 会话中的单条消息（user / assistant / tool） |
| **Skill** | OpenClaw 可调用的工具集合（如 Attribuly skill） |
| **Golden Path** | 某类问题下的最优调用链 |
| **Anti-pattern** | 某类问题下的低效或错误调用模式 |
| **Suggestion** | 系统产出的优化建议（可自主 / 可人工） |
| **Track** | 优化建议的执行轨道：autonomous / manual |

### 19.2 参考资料

- [allyclaw-context-dashboard](https://github.com/zhoushunke0613-ai/allyclaw-context-dashboard)
- [Attribuly DTC Skill](https://clawhub.ai/alexchulee/attribuly)
- OpenClaw JSONL 格式规范（内部文档）

### 19.3 待决策项

- [ ] 新项目独立仓库 vs monorepo？
- [ ] 工作台前端技术栈：继续单文件 HTML，还是引入 React/Next.js？
- [ ] Claude API 成本预算：每月上限？
- [ ] 分类器是否允许用 GPT-4 作为 fallback？
- [ ] 自主优化灰度放量节奏：10% → 50% → 100% 还是直接全量？

---

**文档状态**：v0.1 初稿
**下一步**：
1. 组内评审
2. 明确待决策项
3. 启动 Phase 1
