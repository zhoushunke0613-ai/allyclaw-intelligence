-- Migration 004: Optimization suggestions lifecycle tables
-- Created: 2026-04-15
-- Reason: Phase 2 W10 enables suggestion generation, evidence tracking,
--   discussion, and action audit — see DATA-MODEL.md §7
-- All four tables are append-only EXCEPT optimization_suggestions
--   (which has lifecycle status that can transition).

-- ═══════════════════════════════════════════════════════════════
-- 7.1 Suggestion pool (status mutable, but never deleted)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_optimization_suggestions (
    suggestion_id    TEXT PRIMARY KEY,        -- 'S-2026-0415-001'
    type             TEXT NOT NULL,           -- skill_redesign / api_optimize / prompt_fix / routing / cache / taxonomy / coverage_gap / failure_cluster
    title            TEXT NOT NULL,
    description      TEXT,
    root_cause       TEXT,
    suggested_action TEXT,

    priority         TEXT NOT NULL,           -- P0 / P1 / P2 / P3
    track            TEXT NOT NULL,           -- autonomous / manual

    -- 影响范围
    scope_team_ids   TEXT,                    -- CSV or 'all'
    scope_skill_ids  TEXT,
    scope_api_ids    TEXT,
    scope_category_ids TEXT,
    affected_sessions INTEGER,

    -- 预估收益
    estimated_success_delta REAL,
    estimated_token_delta REAL,
    estimated_latency_delta_ms INTEGER,
    ab_testable      INTEGER DEFAULT 0,

    -- 生成来源
    generated_by     TEXT NOT NULL,           -- system_<detector_id> / llm_claude_sonnet / human_<user>
    generator_version TEXT,
    source_signal    TEXT,                    -- 'failure_rate_high' / 'coverage_gap' / 'pattern_anti'

    status           TEXT DEFAULT 'open',     -- open / in_review / approved / in_progress / applied / rolled_back / rejected / obsolete
    assignee         TEXT,

    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now')),
    resolved_at      TEXT,

    -- Dedup key: same detector+scope shouldn't create duplicates while still open
    dedup_key        TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_os_status_priority ON int_optimization_suggestions(status, priority);
CREATE INDEX IF NOT EXISTS idx_os_track ON int_optimization_suggestions(track, status);
CREATE INDEX IF NOT EXISTS idx_os_type ON int_optimization_suggestions(type);
CREATE INDEX IF NOT EXISTS idx_os_open ON int_optimization_suggestions(priority, created_at DESC) WHERE status = 'open';

-- ═══════════════════════════════════════════════════════════════
-- 7.2 Evidence (append-only — snapshot at suggestion time)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_suggestion_evidence (
    evidence_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id TEXT NOT NULL REFERENCES int_optimization_suggestions(suggestion_id),
    evidence_kind TEXT NOT NULL,              -- session_sample / metric / chain / comparison
    reference_type TEXT,                      -- session / chain / pattern / cluster
    reference_id  TEXT,
    snapshot_json TEXT,                       -- Frozen snapshot — survives source deletion
    note          TEXT,
    added_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_se_suggestion ON int_suggestion_evidence(suggestion_id);

-- ═══════════════════════════════════════════════════════════════
-- 7.3 Comments / status history (append-only)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_suggestion_comments (
    comment_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id TEXT NOT NULL REFERENCES int_optimization_suggestions(suggestion_id),
    author_id     TEXT NOT NULL,              -- 'system' or user_id
    body          TEXT NOT NULL,
    action        TEXT,                       -- status_change / comment / attach / approve / reject
    metadata_json TEXT,                       -- e.g. {"old_status": "open", "new_status": "approved"}
    created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sc_suggestion ON int_suggestion_comments(suggestion_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 7.4 Actions audit log (append-only)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_optimization_actions (
    action_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id    TEXT NOT NULL REFERENCES int_optimization_suggestions(suggestion_id),

    action_type      TEXT NOT NULL,           -- route_update / cache_ttl_change / rule_add / rule_update / rollout / rollback
    target_kind      TEXT,                    -- routing_table / cache_config / taxonomy_rule / prompt_fragment
    target_id        TEXT,
    diff_json        TEXT NOT NULL,
    applied_by       TEXT NOT NULL,           -- 'system' or user_id
    applied_at       TEXT DEFAULT (datetime('now')),

    rollout_stage    TEXT,                    -- canary_single / full / rollback
    rollout_status   TEXT,                    -- pending / live / observing / promoted / failed / rolled_back
    observation_until TEXT,
    rollback_action_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oa_suggestion ON int_optimization_actions(suggestion_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_oa_status ON int_optimization_actions(rollout_status, observation_until);
