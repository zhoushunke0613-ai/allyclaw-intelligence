-- Migration 002: Classification taxonomy and reports infrastructure
-- Created: 2026-04-15
-- Reason: Phase 1 W5-W6 enables question classification + daily report storage
-- References: docs/DATA-MODEL.md §5 (taxonomy) and §8.3-8.4 (reports)

-- ═══════════════════════════════════════════════════════════════
-- Layer 3: Classification taxonomy
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_taxonomy_categories (
    category_id   TEXT PRIMARY KEY,
    level         INTEGER NOT NULL,
    parent_id     TEXT REFERENCES int_taxonomy_categories(category_id),
    name          TEXT NOT NULL,
    description   TEXT,
    color         TEXT,
    active        INTEGER DEFAULT 1,
    sort_order    INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS int_taxonomy_rules (
    rule_id       TEXT PRIMARY KEY,
    category_id   TEXT NOT NULL REFERENCES int_taxonomy_categories(category_id),
    rule_type     TEXT NOT NULL,
    rule_content  TEXT NOT NULL,
    priority      INTEGER DEFAULT 0,
    version       INTEGER DEFAULT 1,
    active        INTEGER DEFAULT 1,
    created_by    TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    deprecated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tr_active ON int_taxonomy_rules(active, priority DESC) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_tr_category ON int_taxonomy_rules(category_id);

CREATE TABLE IF NOT EXISTS int_taxonomy_rules_history (
    history_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id       TEXT NOT NULL,
    version       INTEGER NOT NULL,
    operation     TEXT NOT NULL,
    diff_json     TEXT,
    changed_by    TEXT,
    changed_at    TEXT DEFAULT (datetime('now')),
    change_reason TEXT
);

CREATE TABLE IF NOT EXISTS int_question_classifications (
    classification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL,
    server_id     TEXT NOT NULL,
    team_id       TEXT NOT NULL,
    category_id   TEXT NOT NULL REFERENCES int_taxonomy_categories(category_id),
    is_primary    INTEGER DEFAULT 0,
    confidence    REAL,
    method        TEXT NOT NULL,
    rule_id       TEXT,
    model_version TEXT,
    classified_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qc_session ON int_question_classifications(session_id, server_id);
CREATE INDEX IF NOT EXISTS idx_qc_team_category ON int_question_classifications(team_id, category_id);
CREATE INDEX IF NOT EXISTS idx_qc_primary ON int_question_classifications(category_id) WHERE is_primary = 1;

-- ═══════════════════════════════════════════════════════════════
-- Layer 6: Reports
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_reports (
    report_id        TEXT PRIMARY KEY,
    report_type      TEXT NOT NULL,
    scope            TEXT NOT NULL,
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,
    markdown         TEXT,
    html             TEXT,
    metadata_json    TEXT,
    generated_at     TEXT DEFAULT (datetime('now')),
    generator_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_r_type_scope ON int_reports(report_type, scope, period_start DESC);

-- ═══════════════════════════════════════════════════════════════
-- Seed: 10 L1 categories from PRD §7.2
-- ═══════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO int_taxonomy_categories (category_id, level, name, description, color, sort_order) VALUES
  ('L1.data_overview',  1, '数据概览',       '整体表现摘要',                    '#6366f1', 1),
  ('L1.diagnosis',      1, '异常诊断',       '为什么下降/异常',                  '#ef4444', 2),
  ('L1.channel_compare',1, '渠道对比',       '多渠道性能比较',                   '#10b981', 3),
  ('L1.campaign_optim', 1, 'Campaign 优化', '单 campaign 层面分析',            '#f59e0b', 4),
  ('L1.revenue_change', 1, 'Revenue 变化',  '收入维度趋势分析',                 '#8b5cf6', 5),
  ('L1.attribution',    1, 'Attribution 解释','归因模型和路径分析',             '#06b6d4', 6),
  ('L1.ad_advice',      1, '广告投放建议',   '如何优化投放',                     '#ec4899', 7),
  ('L1.user_journey',   1, '用户旅程',       'CRM / audience / journey',       '#14b8a6', 8),
  ('L1.data_avail',     1, '数据可用性',     'tracking、API、数据缺失',          '#f97316', 9),
  ('L1.platform_op',    1, '平台操作',       '如何使用、报告生成',               '#84cc16', 10);

-- ═══════════════════════════════════════════════════════════════
-- Seed: keyword rules for L1 categories
-- ═══════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO int_taxonomy_rules (rule_id, category_id, rule_type, rule_content, priority, created_by) VALUES
  ('R-001-data_overview',  'L1.data_overview',   'keyword', '今天,昨天,这周,本月,概览,overview,summary,总览,情况,how is,how are', 10, 'seed'),
  ('R-002-diagnosis',      'L1.diagnosis',       'keyword', '为什么,怎么会,怎么跌,异常,why,drop,decline,问题,fix,出错,bug,失败', 20, 'seed'),
  ('R-003-channel_compare','L1.channel_compare', 'keyword', '渠道,对比,vs,meta,google,tiktok,facebook,instagram,channel,compare,better', 15, 'seed'),
  ('R-004-campaign_optim', 'L1.campaign_optim',  'keyword', 'campaign,广告系列,推广,优化,浪费,预算,budget,waste,kill,scale', 15, 'seed'),
  ('R-005-revenue_change', 'L1.revenue_change',  'keyword', 'revenue,收入,营业额,sales,订单,order,gmv,转化,conversion', 12, 'seed'),
  ('R-006-attribution',    'L1.attribution',     'keyword', 'attribution,归因,first click,last click,assist,链路,touchpoint,path', 18, 'seed'),
  ('R-007-ad_advice',      'L1.ad_advice',       'keyword', '建议,推荐,加预算,scale up,scale down,proposal,suggest,recommend', 10, 'seed'),
  ('R-008-user_journey',   'L1.user_journey',    'keyword', 'audience,用户旅程,journey,crm,cohort,ltv,retention,churn,segment', 12, 'seed'),
  ('R-009-data_avail',     'L1.data_avail',      'keyword', 'tracking,数据缺失,no data,empty,无数据,api,集成,integration,configure', 14, 'seed'),
  ('R-010-platform_op',    'L1.platform_op',     'keyword', '怎么用,how to use,导出,export,download,report,设置,setting,where,在哪', 8, 'seed');
