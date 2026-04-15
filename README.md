# AllyClaw Intelligence

> 面向多团队营销 Agent 的对话分析、调用优化与持续学习平台

**一句话定位**：让小龙虾不只会回答问题，而是会不断变得更会回答问题。

## 项目状态

🚀 **Phase 2 W12 已落地** — 前端工作台 MVP 上线。详见下方 [里程碑表](#里程碑)。

**生产 URL**：
- 工作台：https://allyclaw-intelligence-dashboard.pages.dev
- API：https://allyclaw-intelligence.zhoushunke0613.workers.dev

## 文档

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | AI 助手工作指南 |
| [docs/PRD.md](./docs/PRD.md) | 完整需求（19 章） |
| [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) | 数据模型设计（含 DDL） |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | 10 项关键决策 |

## 架构

```
   allyclaw-intelligence （本项目）
   对话分析 · 诊断 · 优化建议 · 报告
              ↓ 读取 D1
   allyclaw-context-dashboard （已有）
   数据采集与基础展示层
              ↓ agent 推送
   OpenClaw 实例群（12+ 台腾讯云）
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Cloudflare Worker + Hono |
| 数据库 | Cloudflare D1（共享 `allyclaw-db`） |
| LLM | Claude（通过 Adapter，未来可切换） |
| 前端 | React + Vite + TypeScript |
| 部署 | Cloudflare Workers + Pages |

## 项目结构

```
allyclaw-intelligence/
├── CLAUDE.md                # AI 助手指南
├── .claude/                 # 项目控制中心
│   ├── settings.json        # 共享配置
│   ├── commands/            # 自定义 slash 命令
│   ├── rules/               # 开发规范
│   ├── skills/              # 复杂工作流
│   └── agents/              # 专家角色
├── docs/                    # 项目文档
├── worker/                  # Cloudflare Worker
│   └── src/
│       ├── llm/             # LLM Adapter（必经之路）
│       ├── routes/          # API 路由
│       ├── jobs/            # 定时任务
│       ├── db/              # D1 client
│       └── prompts/         # LLM prompt 模板
├── frontend/                # React + Vite 工作台
├── migrations/              # D1 schema migrations
└── scripts/                 # 运维脚本
```

## 快速开始

### 1. Clone 并安装

```bash
git clone https://github.com/zhoushunke0613-ai/allyclaw-intelligence.git
cd allyclaw-intelligence
cd worker && npm install
cd ../frontend && npm install
```

### 2. 配置 Cloudflare

```bash
cd worker
npx wrangler login

# Anthropic API key
npx wrangler secret put ANTHROPIC_API_KEY
```

### 3. 初始化 schema

```bash
# 本地（测试）
npx wrangler d1 execute allyclaw-db --local --file=../migrations/001_phase1_base.sql

# 远程（生产）- 谨慎！
npx wrangler d1 execute allyclaw-db --remote --file=../migrations/001_phase1_base.sql
```

### 4. 开发

```bash
# 后端
cd worker && npm run dev

# 前端
cd frontend && npm run dev
```

## 里程碑

参考 [PRD §15](./docs/PRD.md#15-里程碑规划) 拆解。状态图例：✅ 完成 · 🚧 进行中 · ⏸ 待启动 · ⏳ 阻塞中。

### Phase 1：可观测性建设（W1-W6）— 🚧 收口阶段

| 周次 | 交付 | 状态 | 备注 |
|------|------|------|------|
| W1 | 项目初始化 + 数据模型评审 | ✅ | PRD/DATA-MODEL/DECISIONS 三份文档锁定 |
| W1 | GitHub 仓库 + .claude/ 控制中心 | ✅ | 5 rules + 5 commands + 3 skills + 3 agents |
| W1 | Cloudflare Worker 骨架部署 | ✅ | https://allyclaw-intelligence.zhoushunke0613.workers.dev |
| W1 | Migration 001：基础表 (4 张) | ✅ | int_teams / server_team_map / sessions_enriched / daily_metrics |
| W2 | LLM Adapter 抽象 | ✅ | Claude 实现 + OpenAI 占位 |
| W3 | `/api/teams` 自动发现 | ✅ | 12 servers → 9 teams |
| W3 | Enrichment job (规则版) | ✅ | 19 sessions enriched |
| W4 | `/api/analytics/daily-metrics` 物化 | ✅ | 9 daily rows |
| W4 | `/api/analytics/overview` | ✅ | success_rate 84.21% |
| W5 | Migration 002：分类 + 报告表 | ✅ | 10 L1 categories + 10 keyword rules seeded |
| W5 | 规则分类引擎 | ✅ | 12/19 sessions classified |
| W5 | success_label 6-rule cascade (PRD §16.8.2) | ✅ | refuse/failure/partial/success/unknown |
| W6 | 日报 Markdown 生成器 | ✅ | R-2026-04-15-daily-global |
| W6 | Migration 003：dedup BUG 修复 | ✅ | NULL → '_overall' sentinel |
| W6 | Cron triggers (15min/h/day) | ✅ | 自动跑 enrichment + 分类 + 报告 |
| W6 | LLM Haiku 兜底分类 (graceful) | ⏳ | 代码就绪，等 ANTHROPIC_API_KEY |

### Phase 2：诊断与建议（W7-W12）— 🚧 进行中

| 周次 | 交付 | 状态 | 依赖 |
|------|------|------|------|
| W7-8 | 调用链模式挖掘（Golden Path / Anti-pattern） | ⏸ | execution_events 表 |
| W9 | 上下文缺口识别（few-shot 缺失等） | ⏸ | LLM 启用 |
| W10 | Migration 004：suggestion lifecycle 4 张表 | ✅ | dedup_key 防重复 |
| W10 | 第一个检测器：高失败率分类（D-001） | ✅ | 当前数据量未触发，等积累 |
| W10 | Suggestions API（list / detail / status / comments） | ✅ | 含状态机校验 |
| W10 | 日报新增 Open Suggestions 章节 | ✅ | 自动列待审建议 |
| W10 | Cron `:23 hourly` 跑 detector | ✅ | 错峰于 metrics |
| W11 | Migration 005：team_snapshots + outcome 字段 | ✅ | weekly 粒度 |
| W11 | 团队画像 + 健康度评分（4 维度加权） | ✅ | 9 团队 ranked |
| W11 | `/api/teams/:id/profile` + `/api/teams/comparison` | ✅ | 描述性轨道 |
| W11 | 第二个检测器 D-002：分类覆盖缺口 | ✅ | 行动性轨道 |
| W11 | Suggestion outcome tracker（30d 前后对比） | ✅ | 闭环 |
| W11 | Cron `:weekly` 跑团队快照 | ✅ | 周一 03:47 UTC |
| W12 | React 工作台 MVP（7 页面 + 状态机 UI） | ✅ | https://allyclaw-intelligence-dashboard.pages.dev |
| W12 | Markdown 报告查看器（自渲染） | ✅ | 覆盖 h1/h2/table/code/list |
| W12 | 团队对比 + 健康度可视化 | ✅ | health bar 渐变 |
| W12 | 报告投递通道（飞书/Slack） | ⏸ | 后置到 Phase 3 |

**Exit Criteria**：每周产出 ≥ 10 条建议、人工评审可用率 ≥ 60%

### Phase 3：低风险自主优化（W13-W18）— ⏸ 待启动

| 周次 | 交付 | 状态 |
|------|------|------|
| W13-14 | 自主优化引擎 + 审批流 | ⏸ |
| W15 | 灰度发布 + 回滚机制 | ⏸ |
| W16 | 路由规则自主优化 | ⏸ |
| W17 | 缓存策略自主优化 | ⏸ |
| W18 | 自主优化效果评估 | ⏸ |

**Exit Criteria**：≥ 3 个自主优化动作上线并有正向收益

### Phase 4：持续学习与策略迭代（W19-W24）— ⏸ 待启动

| 周次 | 交付 | 状态 |
|------|------|------|
| W19-20 | A/B 测试框架 | ⏸ |
| W21 | skill / prompt 版本实验 | ⏸ |
| W22 | 长期知识库 (FAQ / 黄金路径 / 已知问题) | ⏸ |
| W23 | Agent Ops 方法论文档 | ⏸ |
| W24 | Phase 4 整体评审 | ⏸ |

**Exit Criteria**：优化后回答成功率提升 ≥ 15%（PRD §16.1 M6 目标）

---

### 待人工事项（跨 Phase 累计）

| # | 事项 | 优先级 | 阻塞 |
|---|------|------|------|
| 1 | `wrangler secret put ANTHROPIC_API_KEY` | 🔴 高 | LLM 兜底分类、Phase 2 诊断 |
| 2 | 关键词规则扩充（9 个 0 命中分类） | 🟠 中 | 分类覆盖率提升 |
| 3 | 拉 20 条对照判定 success_label 准确率 | 🟠 中 | PRD §16.8.4 校准 |
| 4 | scheduled 日志持久化到 audit_log | 🟡 低 | 排错时再做 |
| 5 | 真实"追问检测"（跨 session） | 🟡 低 | Phase 2 |
| 6 | 报告投递通道（飞书/Slack webhook） | 🟡 低 | Phase 2 |
| 7 | L2 二级分类 | 🟡 低 | Phase 2 |

## 与 allyclaw-context-dashboard 的关系

本项目复用 [allyclaw-context-dashboard](https://github.com/zhoushunke0613-ai/allyclaw-context-dashboard) 采集的数据。

- context-dashboard 写 Layer 0 表：`servers` / `sessions` / `messages` / `question_stats`
- intelligence 写 Layer 1-7 表：所有 `int_*` 前缀的表
- 两个项目**共享同一个 D1 数据库**，通过表前缀隔离写入边界

## License

MIT
