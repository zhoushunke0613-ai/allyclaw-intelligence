# AllyClaw Intelligence

> 面向多团队营销 Agent 的对话分析、调用优化与持续学习平台

**一句话定位**：让小龙虾不只会回答问题，而是会不断变得更会回答问题。

## 项目状态

📝 **Phase 0**：规划完成，骨架就绪，Phase 1 可启动

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

## Phase 规划

参考 [PRD §15](./docs/PRD.md#15-里程碑规划)：

| Phase | 周次 | 目标 |
|-------|-----|------|
| Phase 1 | W1-W6 | 可观测性建设 — 先看见 |
| Phase 2 | W7-W12 | 诊断与建议 — 先找到问题 |
| Phase 3 | W13-W18 | 低风险自主优化 — 先自动优化一部分 |
| Phase 4 | W19-W24 | 持续学习与策略迭代 — 形成闭环 |

## 与 allyclaw-context-dashboard 的关系

本项目复用 [allyclaw-context-dashboard](https://github.com/zhoushunke0613-ai/allyclaw-context-dashboard) 采集的数据。

- context-dashboard 写 Layer 0 表：`servers` / `sessions` / `messages` / `question_stats`
- intelligence 写 Layer 1-7 表：所有 `int_*` 前缀的表
- 两个项目**共享同一个 D1 数据库**，通过表前缀隔离写入边界

## License

MIT
