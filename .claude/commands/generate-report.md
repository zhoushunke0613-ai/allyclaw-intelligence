---
description: Generate daily or weekly Intelligence report
---

# Generate Report

按 PRD §12 生成日报或周报。

## 用法

`/project:generate-report <type> [date]`

- type: `daily` / `weekly` / `monthly`
- date: 报告参考日期（可选，默认昨天/上周/上月）

例如：
- `/project:generate-report daily` → 昨天的日报
- `/project:generate-report weekly 2026-04-07` → 包含 2026-04-07 那一周的周报

## 步骤

1. **确定时间窗口**：
   - daily: 昨日 00:00 ~ 23:59 UTC
   - weekly: 上周一 ~ 上周日
   - monthly: 上月 1 号 ~ 上月最后一天

2. **聚合数据**（参考 PRD §12 报告内容结构）：

   **日报数据**：
   - 总会话数、活跃团队数、成功率、平均响应耗时
   - Top 10 高频问题（按 question_classifications 聚合）
   - Top 10 失败问题
   - 最低效调用链 Top 5（按 execution_chains 找 success=0 + duration 长）
   - 新出现的问题模式（首次出现在过去 7 天）
   - 昨日自主优化动作列表
   - 待处理建议列表

   **周报增加**：
   - 环比、同比趋势
   - 团队对比（活跃度、成功率、Token）
   - Skill 升级清单（本周 int_skill_upgrades）
   - Skill 性价比矩阵象限变化（int_skill_value_cost_snapshot 月度）

3. **生成 Markdown**：
   用模板 `worker/src/prompts/report-template.md`，让 LLM (`summarizer` 抽象模型) 渲染最终文本。

4. **写入 reports 表**：
   ```sql
   INSERT INTO int_reports (report_id, report_type, scope, period_start, period_end, markdown, html, metadata_json, generated_at)
   VALUES (?, ?, 'global', ?, ?, ?, ?, ?, datetime('now'));
   ```

5. **触发投递**（如配置了订阅）：
   - 查 `int_report_subscriptions`
   - 对每个订阅生成 `int_report_deliveries` 记录
   - 通过 channel（email / slack / feishu）发送

## 输出

完成后告诉用户：
- 报告 ID 和访问 URL
- 投递的目标列表（如有）
- 报告关键指标摘要（前 5 行）

## 错误处理

- 如果数据不足（如新部署 < 7 天），生成"数据不足"占位报告而不是空报告
- 如果 LLM 失败，降级到模板填充（不调用 LLM）
- 报告生成失败必须写 `int_audit_log`
