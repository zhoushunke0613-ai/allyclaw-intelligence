-- Migration 001: Phase 1 Base Tables
-- Created: 2026-04-14
-- Reason: Phase 1 W1-W2 foundation tables (teams, mapping, enrichment, daily metrics)
-- Reference: docs/DATA-MODEL.md §14.1

-- ═══════════════════════════════════════════════════════════════
-- Layer 1: Base entities
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_teams (
    team_id       TEXT PRIMARY KEY,
    team_name     TEXT NOT NULL,
    tier          TEXT DEFAULT 'basic',
    status        TEXT DEFAULT 'active',
    onboarded_at  TEXT NOT NULL,
    primary_contact TEXT,
    attribuly_key_fingerprint TEXT,
    metadata_json TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS int_server_team_map (
    server_id     TEXT PRIMARY KEY,
    team_id       TEXT NOT NULL REFERENCES int_teams(team_id),
    role          TEXT DEFAULT 'production',
    mapped_at     TEXT DEFAULT (datetime('now')),
    unmapped_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_stm_team ON int_server_team_map(team_id) WHERE unmapped_at IS NULL;

CREATE TABLE IF NOT EXISTS int_sessions_enriched (
    session_id       TEXT NOT NULL,
    server_id        TEXT NOT NULL,
    team_id          TEXT NOT NULL,
    primary_l1       TEXT,
    primary_l2       TEXT,
    primary_intent   TEXT,
    entities_json    TEXT,
    complexity       REAL,
    is_followup      INTEGER DEFAULT 0,
    success_label    TEXT,
    success_conf     REAL,
    user_sentiment   TEXT,
    has_followup     INTEGER DEFAULT 0,
    repeated_question INTEGER DEFAULT 0,
    skill_call_count INTEGER DEFAULT 0,
    api_call_count   INTEGER DEFAULT 0,
    tool_call_count  INTEGER DEFAULT 0,
    total_duration_ms INTEGER,
    error_count      INTEGER DEFAULT 0,
    enrichment_version TEXT,
    enriched_at      TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_se_team_time ON int_sessions_enriched(team_id, enriched_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_l1_success ON int_sessions_enriched(primary_l1, success_label);
CREATE INDEX IF NOT EXISTS idx_se_failure ON int_sessions_enriched(success_label) WHERE success_label IN ('failure', 'refuse');

-- ═══════════════════════════════════════════════════════════════
-- Layer 6: Daily metrics (materialized)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_daily_metrics (
    metric_date      TEXT NOT NULL,
    team_id          TEXT NOT NULL,
    category_id      TEXT,
    session_count    INTEGER DEFAULT 0,
    user_message_count INTEGER DEFAULT 0,
    success_count    INTEGER DEFAULT 0,
    failure_count    INTEGER DEFAULT 0,
    refuse_count     INTEGER DEFAULT 0,
    followup_count   INTEGER DEFAULT 0,
    repeated_count   INTEGER DEFAULT 0,
    avg_duration_ms  INTEGER,
    p50_duration_ms  INTEGER,
    p95_duration_ms  INTEGER,
    total_skill_calls INTEGER,
    total_api_calls  INTEGER,
    total_input_tokens INTEGER,
    total_output_tokens INTEGER,
    computed_at      TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (metric_date, team_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_team_date ON int_daily_metrics(team_id, metric_date DESC);

-- ═══════════════════════════════════════════════════════════════
-- KPI baselines (locked once M1 ends)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_kpi_baselines (
    baseline_version TEXT PRIMARY KEY,
    measured_at      TEXT NOT NULL,
    sample_size      INTEGER NOT NULL,
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,
    metrics_json     TEXT NOT NULL,
    notes            TEXT,
    locked           INTEGER DEFAULT 1
);
