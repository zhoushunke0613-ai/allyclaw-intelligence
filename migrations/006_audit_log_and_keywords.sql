-- Migration 006: audit_log table + keyword rule expansion
-- Created: 2026-04-15
-- Reason: Phase 1/2 wrap-up:
--   1. Create int_audit_log (append-only) so scheduled jobs persist outcomes
--   2. Expand keyword rules for 9 L1 categories that currently get 0 hits
-- References: CLAUDE.md §5 (audit), docs/DATA-MODEL.md §5 (taxonomy)

-- ═══════════════════════════════════════════════════════════════
-- int_audit_log (append-only)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_audit_log (
    log_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    actor         TEXT NOT NULL,              -- 'system' or user_id
    action        TEXT NOT NULL,              -- 'scheduled.enrich', 'suggestion.approve', ...
    target_kind   TEXT,                       -- 'cron' / 'suggestion' / 'team' / null
    target_id     TEXT,
    payload_json  TEXT,                       -- result snapshot
    status        TEXT NOT NULL DEFAULT 'ok', -- ok / error
    error_message TEXT,
    duration_ms   INTEGER,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_al_actor_time ON int_audit_log(actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_al_action_time ON int_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_al_errors ON int_audit_log(status, created_at DESC) WHERE status = 'error';

-- ═══════════════════════════════════════════════════════════════
-- Keyword rule expansion: add R-011..R-020 as high-priority
-- companions to existing R-001..R-010. English-heavy since the
-- attribuly platform serves international ecommerce merchants.
-- Priority >= existing so matches override on overlap where
-- the new rule is a tighter fit.
-- ═══════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO int_taxonomy_rules (rule_id, category_id, rule_type, rule_content, priority, created_by) VALUES
  ('R-011-data_overview',  'L1.data_overview',
   'keyword',
   'today,yesterday,this week,last week,this month,dashboard,kpi,performance,表现,今日,最近,指标,整体,overall,状况,current status',
   25, 'seed-006'),

  ('R-012-diagnosis',      'L1.diagnosis',
   'keyword',
   'spike,drop off,plunge,decline,anomaly,unusual,strange,root cause,why did,下降,上升,飙升,骤降,波动,异常值,疑问,impact,影响,broken,stopped working',
   30, 'seed-006'),

  ('R-013-channel_compare','L1.channel_compare',
   'keyword',
   'snapchat,pinterest,youtube,bing,twitter,linkedin,reddit,influencer,affiliate,organic,paid search,paid social,比较,哪个好,which performs,top channel,best channel',
   25, 'seed-006'),

  ('R-014-campaign_optim', 'L1.campaign_optim',
   'keyword',
   'ad set,adset,creative,素材,关停,pause,启动,launch,launching,underperform,poor performer,表现差,kill it,shut down,turn off,a/b test,split test',
   25, 'seed-006'),

  ('R-015-revenue_change', 'L1.revenue_change',
   'keyword',
   'roas,roi,cpa,cpc,cpm,aov,客单价,利润,profit,margin,arr,mrr,流水,营收,sales volume,订单量,transactions,paying customers',
   22, 'seed-006'),

  ('R-016-attribution',    'L1.attribution',
   'keyword',
   'mta,mmm,incrementality,增量,lift test,split test,multi-touch,last touch,first touch,linear,time decay,data-driven,归因模型,attribution model,conversion window',
   28, 'seed-006'),

  ('R-017-ad_advice',      'L1.ad_advice',
   'keyword',
   'how to improve,improve performance,优化,advice,tip,提高,提升,增长,growth,should I,recommendation,proposal,next step,action item,what would you do',
   20, 'seed-006'),

  ('R-018-user_journey',   'L1.user_journey',
   'keyword',
   '用户画像,漏斗,funnel,cac,ltv,churn,churn rate,repeat purchase,复购,new vs returning,activation,onboarding,cohort analysis,retention curve,stickiness',
   22, 'seed-006'),

  ('R-019-data_avail',     'L1.data_avail',
   'keyword',
   '看不到,看不见,消失,missing data,unavailable,404,error,报错,failed to load,no data showing,stopped tracking,pixel not firing,gtm,tag manager,shopify connection,server-side',
   24, 'seed-006'),

  ('R-020-platform_op',    'L1.platform_op',
   'keyword',
   'tutorial,guide,指南,文档,documentation,帮助,help,show me,how do i,how can i,where is,点击,按钮,button,菜单,menu,dashboard navigation,view,filter',
   18, 'seed-006');
