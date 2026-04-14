# AllyClaw Intelligence — 架构决策记录

> 项目启动前的关键决策已确认。此文档作为后续开发的依据。
> 日期：2026-04-14

---

## 决策摘要

| # | 决策项 | 选择 | 理由 |
|---|-------|------|------|
| 1 | **D1 数据库部署** | 同库（allyclaw-db） | 避免跨库 JOIN，免费额度够用 |
| 2 | **项目仓库** | 独立 GitHub 仓库（allyclaw-intelligence） | 清晰边界，独立发版 |
| 3 | **LLM 预算** | 不封顶 | 项目价值验证期，按实际需要使用 |
| 4 | **PII 脱敏时机** | MVP 不做，Phase 2 加 | 内部运营数据，先冲速度 |
| 5 | **表命名前缀** | `int_` 前缀 | 与 context-dashboard 表明确区分 |
| 6 | **前端技术栈** | React + Vite | 工作台需要组件化，HTML 单文件不够用 |
| 7 | **用户系统** | MVP 启用简单角色系统 | 多角色协作，需要基础权限 |
| 8 | **自主优化灰度** | 两阶段：单实例 → 全量 | 平衡安全性和效率 |
| 9 | **A/B 实验粒度** | 每天一次快照 | 对话质量指标需要足够样本 |
| 10 | **LLM Provider 策略** | 只用 Claude，代码预留 Adapter 接口 | 现在简单，未来可切换 |

---

## 1. D1 数据库部署：同库

**选择**：所有 Intelligence 表建在 `allyclaw-db` 数据库中，与 context-dashboard 共享。

**影响**：
- Intelligence Worker 通过 wrangler.toml 绑定同一个 `DB`
- 两个项目通过 `int_` 前缀隔离表命名空间
- 写入边界：context-dashboard 只写 Layer 0 表，Intelligence 只写 Layer 1-7 的 `int_*` 表

**备选方案何时启用**：
- D1 存储 > 4GB 时考虑归档
- 团队规模 > 200 时考虑拆库

---

## 2. 项目仓库：独立

**选择**：创建独立仓库 `allyclaw-intelligence`。

**仓库结构**：
```
allyclaw-intelligence/
├── worker/               # Cloudflare Worker 后端
├── frontend/             # React + Vite 工作台
├── migrations/           # D1 schema migrations (按序号命名)
├── docs/                 # 文档
│   ├── PRD.md
│   ├── DATA-MODEL.md
│   └── DECISIONS.md
├── scripts/              # 运维脚本
└── README.md
```

**发布策略**：独立 Cloudflare Worker + 独立 Pages 子项目

---

## 3. LLM 预算：不封顶

**选择**：按实际价值使用，不设月度上限。

**实施**：
- 默认使用 Haiku 做分类（性价比高）
- 失败会话分析、建议生成使用 Sonnet（更深度）
- 每月运营报告中包含成本分析，供调整

**软预算监控**：
- 单日超过 $10 触发告警
- 每月 review 实际支出

---

## 4. PII 脱敏：Phase 2

**MVP 阶段**：
- 不做自动脱敏
- 所有原始对话内容入库
- 内部访问靠 Cloudflare Access 控制

**Phase 2 升级**：
- 查询时脱敏（中间件层面）
- 跨团队共享样本时自动脱敏
- 归档前做全量脱敏

---

## 5. 表命名前缀：`int_`

**选择**：Intelligence 项目的所有新表以 `int_` 开头。

**命名示例**：
```
int_teams
int_server_team_map
int_sessions_enriched
int_execution_events
int_execution_chains
int_taxonomy_categories
int_taxonomy_rules
int_taxonomy_rules_history
int_question_classifications
int_session_tags
int_call_patterns
int_pattern_instances
int_failure_clusters
int_anomaly_signals
int_optimization_suggestions
int_suggestion_evidence
int_suggestion_comments
int_optimization_actions
int_optimization_experiments
int_experiment_results
int_daily_metrics
int_team_snapshots
int_reports
int_report_deliveries
int_users
int_roles
int_role_permissions
int_audit_log
int_access_log
```

Layer 0 保持原名（`servers`、`sessions`、`messages`、`question_stats`、`sync_state`）。

---

## 6. 前端技术栈：React + Vite

**选择**：工作台使用 React + Vite + TypeScript。

**理由**：
- 工作台需要表格、看板、筛选器、图表联动 → 组件化必需
- dashboard.html 作为参考保留，作为 Intelligence 的 "Overview" 子页面
- Vite 构建速度快，部署到 Cloudflare Pages

**UI 库**：shadcn/ui（与项目 Claude Code 风格一致）
**图表**：Recharts 或继续 Chart.js
**状态**：React Query + Zustand（轻量）

---

## 7. 用户系统：简单角色

**MVP 启用**：
- `int_users` 表记录用户基本信息
- `int_roles` 表固定 5 个角色：`business` / `skill_dev` / `product` / `ops` / `admin`
- 身份认证靠 Cloudflare Access（邮箱登录）
- 角色通过后台配置分配

**不做**：
- 自定义角色
- 细粒度权限组合
- 第三方 SSO

---

## 8. 自主优化灰度：两阶段

**流程**：
```
建议审批通过
  ↓
灰度到单个测试实例（推荐用 virginia-1）
  ↓
观察 24-48 小时
  ↓
指标正向 → 全量放开
指标负向或异常 → 自动回滚
```

**单实例观察期指标**：
- 成功率不能低于基线 -5%
- 响应时间不能高于基线 +20%
- 错误数不能增加 > 3x

---

## 10. LLM Provider 策略：Adapter 模式 + Claude only

**选择**：MVP 只接入 Claude（Anthropic API），但所有 LLM 调用通过统一的 Adapter 接口，未来可零侵入式接入 OpenAI / DeepSeek 等其他 Provider。

**实现规范**：

```typescript
// worker/src/llm/types.ts
export interface LLMProvider {
  readonly name: 'claude' | 'openai' | 'deepseek'
  complete(opts: CompleteOptions): Promise<CompleteResponse>
  classify(opts: ClassifyOptions): Promise<ClassifyResponse>
}

export interface CompleteOptions {
  model: string                  // 抽象模型名，由 provider 映射到实际 model id
  system?: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  cache_key?: string             // 用于 Claude prompt caching
}
```

**目录结构**：
```
worker/src/llm/
├── types.ts              # 接口定义
├── claude.ts             # Claude implementation（MVP 实现）
├── openai.ts             # OpenAI implementation（占位 + TODO）
├── factory.ts            # 根据 config 返回 provider
└── tasks/
    ├── classify.ts       # 业务任务，调用 LLMProvider，与具体 provider 解耦
    ├── suggest.ts
    └── summarize.ts
```

**业务代码示例**：

```typescript
// 业务代码不感知 provider
const llm = getLLM(env)   // 返回 LLMProvider 实例
const result = await llm.classify({ text, taxonomy })
```

**未来何时启用 OpenAI**：
- Claude API 持续宕机或限流影响生产（启用 fallback 模式）
- 实测 GPT-4o 在某类任务上质量显著更好（启用任务路由）
- 需要做 A/B 对比验证模型质量差异

**约束**：
- 所有 LLM 调用必须经过 Adapter，禁止业务代码直接 `import Anthropic`
- Prompt 文件独立存储（`worker/src/prompts/`），可被多个 provider 复用
- 模型名抽象层："classifier" / "suggester" / "summarizer"，不要硬编码具体 model id

---

## 9. A/B 实验粒度：每天

**选择**：`int_experiment_results` 每天生成一个快照行。

**理由**：
- 对话成功率、用户追问率等指标需要 n > 100 的样本才稳定
- 单团队日均会话 50-200 条，日级刚好
- 存储成本：每实验 × 每天 = 每年 365 行，可忽略

**例外**：如果某实验需要更敏感监控，可配置 `snapshot_interval_hours` 字段单独调整。

---

## 不启动前必须做

- [ ] 本文档团队 review（发给相关成员）
- [ ] 确认 Cloudflare Access 访问邮箱列表
- [ ] 初始化 GitHub 仓库 `allyclaw-intelligence`

## 启动后第一阶段（Phase 1 W1-W2）交付

- [ ] `migrations/001_phase1_base.sql`（Layer 1 + daily_metrics）
- [ ] Intelligence Worker 骨架（Hono）
- [ ] frontend/ React 骨架
- [ ] 数据模型在 D1 远程库建好
- [ ] 首个 API 能从现有数据推导出 `int_teams` 和 `int_sessions_enriched`

---

**状态**：决策已确认，可以开始 Phase 1 搭建
