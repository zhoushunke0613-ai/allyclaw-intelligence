# AllyClaw Intelligence — Claude Instructions

> 这份文件是 Claude Code 在本项目工作时的**总指南**。
> 任何 AI 助手介入本项目前必须读完本文件。

---

## 项目一句话定位

**让小龙虾不只会回答问题，而是会不断变得更会回答问题。**

构建对话观测、调用诊断、上下文优化、Skill 迭代的持续学习闭环。

---

## 必读文档（按顺序）

1. [docs/PRD.md](./docs/PRD.md) — 完整需求（19 章，含监控指标和 Skill 优化体系）
2. [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) — 数据模型详细设计（含 SQL DDL）
3. [docs/DECISIONS.md](./docs/DECISIONS.md) — 10 项关键架构决策

**任何代码工作开始前**：先确认上述文档中是否有相关决策，避免和已有约束冲突。

---

## 技术栈（已锁定，勿擅自更改）

| 层 | 技术 | 备注 |
|----|------|------|
| 后端 | Cloudflare Worker + Hono | 与 allyclaw-context-dashboard 风格一致 |
| 数据库 | Cloudflare D1（共享 `allyclaw-db`） | 只能写 `int_*` 前缀的表 |
| LLM | Anthropic Claude (default) | 通过 Adapter 接口调用，禁止直接 import SDK |
| 前端 | React + Vite + TypeScript | shadcn/ui + Recharts |
| 部署 | Cloudflare Workers + Pages | 与现有项目同账号 |

---

## 核心工作约束

### 1. 数据库

- **绝不修改 Layer 0 表**：`servers` / `sessions` / `messages` / `question_stats` / `sync_state` 由 allyclaw-context-dashboard 维护，本项目只读
- 所有新表必须 `int_` 前缀
- 所有 schema 变更走 `migrations/NNN_xxx.sql`，按编号顺序累加
- 每张表必须有 `team_id` 或可推导出 `team_id` 的字段（多租户隔离）

### 2. LLM 调用

- 业务代码**禁止直接** `import Anthropic` 或 `import OpenAI`
- 必须通过 `worker/src/llm/factory.ts` 获取 `LLMProvider` 实例
- Prompt 文件独立放在 `worker/src/prompts/`，可被多个 provider 复用
- 模型名用抽象层：`classifier` / `suggester` / `summarizer`，禁止硬编码 `claude-3-haiku-20240307`

### 3. 优化建议生成

- 任何写入 `int_optimization_suggestions` 的代码必须同时附带 `int_suggestion_evidence`
- 自主优化（`track='autonomous'`）必须有 `int_optimization_actions` 审计日志
- 灰度策略遵循 DECISIONS §8：单实例 → 全量

### 4. Skill 优化

- 任何 skill 升级前必须跑 `int_skill_golden_questions` 回归测试
- 回归 pass_rate < 95% 自动阻止上线
- 升级后 30 天必须填充 `int_skill_upgrades.post_*` 指标
- 故障必须分类（参考 `int_skill_failure_modes` 字典）

### 5. 隐私与审计

- MVP 阶段不脱敏（DECISIONS §4），但**所有跨团队展示必须经过审批**
- 所有敏感操作写入 `int_audit_log`（append-only）
- API key、token 严禁入库（哪怕 hash 也只存指纹，不存原值）

---

## 目录约定

```
/
├── CLAUDE.md                    # 本文件（团队级）
├── CLAUDE.local.md              # 个人补充（gitignored）
├── .claude/
│   ├── settings.json            # 共享配置
│   ├── settings.local.json      # 个人配置（gitignored）
│   ├── commands/                # 自定义 slash 命令
│   ├── rules/                   # 开发规范模块
│   ├── skills/                  # 复杂工作流
│   └── agents/                  # 专家角色
├── docs/                        # 项目文档
│   ├── PRD.md
│   ├── DATA-MODEL.md
│   └── DECISIONS.md
├── worker/                      # Cloudflare Worker
│   ├── src/
│   │   ├── routes/              # API 路由
│   │   ├── llm/                 # LLM Adapter（必经之路）
│   │   ├── jobs/                # 定时任务（cron triggers）
│   │   ├── db/                  # D1 schema 和 client
│   │   ├── prompts/             # Prompt 模板
│   │   └── utils/
│   └── wrangler.toml
├── frontend/                    # React + Vite 工作台
│   └── src/
├── migrations/                  # D1 schema migrations（按 NNN 编号）
├── scripts/                     # 运维脚本
└── README.md
```

**不要随意建顶级目录**。如需新分类先讨论。

---

## 提交规范

- 提交前必跑：`cd worker && npm run build`（确保 TypeScript 编译通过）
- 提交信息格式：`<type>(<scope>): <summary>` 例如 `feat(llm): add Claude adapter`
- type: `feat` / `fix` / `chore` / `docs` / `refactor` / `perf` / `test`
- scope: `worker` / `frontend` / `migrations` / `docs` / `infra`
- 涉及 schema 变更的 commit 必须包含 migration 文件

---

## 禁止事项

1. ❌ 不要在 Layer 0 表上加索引或字段
2. ❌ 不要硬编码 LLM model id
3. ❌ 不要在自主优化中触碰核心业务逻辑（参考 PRD §10）
4. ❌ 不要 DROP 任何表（只能 ADD COLUMN）
5. ❌ 不要把 API key / 用户 PII 入库
6. ❌ 不要在不读 DECISIONS.md 的情况下做架构选择
7. ❌ 不要绕过 LLM Adapter 直接调用 Anthropic SDK

---

## 与 allyclaw-context-dashboard 的关系

本项目是 [allyclaw-context-dashboard](https://github.com/zhoushunke0613-ai/allyclaw-context-dashboard) 的**上层智能层**：

- context-dashboard：负责数据采集、原始日志、基础展示
- 本项目（intelligence）：负责分析、诊断、建议、报告

**两者共享同一个 D1 数据库**（`allyclaw-db`），通过表前缀隔离写入边界：
- context-dashboard 写：`servers` / `sessions` / `messages` / `question_stats` / `sync_state`
- intelligence 写：所有 `int_*` 表

如果发现 context-dashboard 的某些数据采集不够用（如缺少 `toolCall` 解析），通过 issue 协调，**禁止直接修改** context-dashboard。

---

## 出错时怎么办

- **Schema 不匹配**：先看 `migrations/` 最新版本，再看 D1 远程库实际状态（`wrangler d1 execute --remote --command "PRAGMA table_info(int_xxx)"`）
- **Worker 部署失败**：先 `wrangler dev` 本地复现
- **LLM 调用失败**：先确认 `env.ANTHROPIC_API_KEY` 存在，再看 Adapter 错误处理
- **D1 配额超限**：参考 DATA-MODEL §15 容量规划，归档过期数据

---

## 给 Claude 的最后一条规则

**先问，再做**。如果遇到本文件未明确的决策点（特别是涉及数据模型、LLM 调用方式、优化策略），先在对话里说明你看到的歧义，让人决定，不要凭直觉推进。
