-- Migration 007: L2 sub-category starter skeleton
-- Created: 2026-04-15
-- Reason: Phase 1/2 wrap-up — seed 30 L2 categories (3 per L1) so Phase 3
--   classifiers / suggesters have a hook point. No L2 keyword rules yet;
--   real rules come with LLM-assisted classification in W9.
-- Reference: docs/PRD.md §7.2 (taxonomy roadmap)

-- L1.data_overview children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.overview_daily',    2, 'L1.data_overview', '每日概览',         '单日整体表现摘要',              '#6366f1', 1),
  ('L2.overview_period',   2, 'L1.data_overview', '周期概览',         '周/月/季度维度总结',            '#6366f1', 2),
  ('L2.overview_channel',  2, 'L1.data_overview', '渠道汇总',         '按 channel 维度总览',           '#6366f1', 3);

-- L1.diagnosis children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.diag_drop',         2, 'L1.diagnosis',     '下降诊断',         'conversion / revenue / roas 跌的原因',  '#ef4444', 1),
  ('L2.diag_spike',        2, 'L1.diagnosis',     '暴涨诊断',         '异常高值的归因',                '#ef4444', 2),
  ('L2.diag_anomaly',      2, 'L1.diagnosis',     '异常点定位',       '单点异常或数据突变',            '#ef4444', 3);

-- L1.channel_compare children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.ch_paid_social',    2, 'L1.channel_compare','付费社交对比',   'meta / tiktok / snapchat 等',   '#10b981', 1),
  ('L2.ch_paid_vs_organic',2, 'L1.channel_compare','付费 vs 自然',    '付费渠道与自然流量对比',        '#10b981', 2),
  ('L2.ch_new_eval',       2, 'L1.channel_compare','新渠道评估',      '是否值得开启新渠道',            '#10b981', 3);

-- L1.campaign_optim children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.camp_kill',         2, 'L1.campaign_optim','关停推荐',         '建议关闭的 campaign',           '#f59e0b', 1),
  ('L2.camp_scale',        2, 'L1.campaign_optim','扩量推荐',         '建议加预算的 campaign',         '#f59e0b', 2),
  ('L2.camp_creative',     2, 'L1.campaign_optim','素材优化',         '素材疲劳 / 替换建议',           '#f59e0b', 3);

-- L1.revenue_change children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.rev_trend',         2, 'L1.revenue_change','收入趋势',         '环比 / 同比走势',               '#8b5cf6', 1),
  ('L2.rev_attribution',   2, 'L1.revenue_change','归因驱动变化',     '不同归因模型下的收入差异',      '#8b5cf6', 2),
  ('L2.rev_seasonality',   2, 'L1.revenue_change','季节性',           '节日 / 周末 / 季度模式',        '#8b5cf6', 3);

-- L1.attribution children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.attr_model',        2, 'L1.attribution',   '归因模型选择',     'first/last/linear/DDA 对比',    '#06b6d4', 1),
  ('L2.attr_touchpoint',   2, 'L1.attribution',   '触点分析',         'touchpoint-level 贡献',         '#06b6d4', 2),
  ('L2.attr_incrementality',2,'L1.attribution',   '增量测量',         'lift test / incrementality',    '#06b6d4', 3);

-- L1.ad_advice children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.advice_budget',     2, 'L1.ad_advice',     '预算建议',         '预算分配 / 调整',               '#ec4899', 1),
  ('L2.advice_targeting',  2, 'L1.ad_advice',     '定向建议',         'audience / lookalike / custom', '#ec4899', 2),
  ('L2.advice_creative',   2, 'L1.ad_advice',     '素材建议',         '素材方向 / 迭代建议',           '#ec4899', 3);

-- L1.user_journey children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.uj_funnel',         2, 'L1.user_journey',  '漏斗分析',         '转化漏斗环节诊断',              '#14b8a6', 1),
  ('L2.uj_retention',      2, 'L1.user_journey',  '留存/复购',        'retention / repeat / churn',    '#14b8a6', 2),
  ('L2.uj_segment',        2, 'L1.user_journey',  '用户分群',         'cohort / segment / audience',   '#14b8a6', 3);

-- L1.data_avail children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.avail_missing',     2, 'L1.data_avail',    '数据缺失',         '某维度看不到数据',              '#f97316', 1),
  ('L2.avail_tracking',    2, 'L1.data_avail',    '埋点问题',         'pixel / gtm / server-side',     '#f97316', 2),
  ('L2.avail_integration', 2, 'L1.data_avail',    '集成问题',         'shopify / meta / google 连接',  '#f97316', 3);

-- L1.platform_op children
INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, parent_id, name, description, color, sort_order) VALUES
  ('L2.op_export',         2, 'L1.platform_op',   '导出/下载',        'report export / csv / api',     '#84cc16', 1),
  ('L2.op_setting',        2, 'L1.platform_op',   '设置/配置',        '权限 / 账号 / 偏好',            '#84cc16', 2),
  ('L2.op_howto',          2, 'L1.platform_op',   '使用指南',         '在哪里 / 怎么操作',             '#84cc16', 3);
