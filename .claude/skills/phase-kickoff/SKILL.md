---
description: Kick off a new development phase with deliverables checklist, schema migrations, and tracking
---

# Phase Kickoff

每个 Phase 启动时跑这个 skill。把 PRD §15 的里程碑转成具体的开发任务清单。

## 触发场景

- 用户说 "启动 Phase N"、"开始 Phase 2"、"phase kickoff" 等
- 完成上一个 Phase 后准备下一阶段

## 前置检查

1. 上一个 Phase 是否真的完成？检查 PRD §15 的 Exit Criteria
2. 上一个 Phase 的回顾报告是否存在？

## 执行步骤

### 1. 读 PRD §15 找出对应 Phase 的内容

确认：
- Phase 名称和目标
- 周次范围（Wn-Wm）
- 主要交付物
- Exit Criteria

### 2. 拆解为可执行任务

把每周的交付转为具体的：
- 文件 / 模块（要建什么）
- 数据模型变更（参考 DATA-MODEL §14 Migration 计划）
- 路由 / API（要新增什么 endpoint）
- 前端页面（要做什么 UI）

### 3. 生成 schema migrations

对应该 Phase 应该上线的表（DATA-MODEL §14）：

```bash
# 例如 Phase 1 W1-W2 应建：
# - int_teams
# - int_server_team_map
# - int_sessions_enriched
# - int_daily_metrics
```

调用 `create-migration` command 为每个表生成 migration。

### 4. 创建 GitHub Issues（如有 GitHub）

为每个交付物建一个 issue，打 `phase-N` 标签。

### 5. 生成 Phase 开发文档

`docs/phases/phase-N-plan.md`：
```markdown
# Phase N — <name>

## 时间窗口
W<n> ~ W<m>（约 X 周）

## 目标
<from PRD §15>

## 交付清单
- [ ] 任务 1（owner: ?, deadline: ?）
- [ ] 任务 2
- ...

## Schema 变更
- migration NNN: <描述>

## Exit Criteria
<from PRD §15>

## 风险与依赖
- ...
```

### 6. 输出

告诉用户：
- 已生成的文件清单
- 待人工补充的内容（owner、deadline 等）
- 第一周建议先做的 3 个任务

## 检查清单

- [ ] PRD §15 中对应 Phase 已读
- [ ] 数据模型 migrations 已规划
- [ ] 任务清单包含前后端、数据、文档
- [ ] Exit Criteria 已写清楚
- [ ] 风险已识别
