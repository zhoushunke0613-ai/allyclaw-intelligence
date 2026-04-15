-- Migration 005: team_snapshots + suggestion outcome tracking
-- Created: 2026-04-15
-- Reason: Phase 2 W11 — descriptive (team profiling) + actionable (outcome tracking)
-- References: docs/DATA-MODEL.md §8.2 + new outcome-tracking field

-- ═══════════════════════════════════════════════════════════════
-- 8.2 Team snapshots (week-level rollup, used for trend comparison)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS int_team_snapshots (
    snapshot_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id          TEXT NOT NULL,
    period_type      TEXT NOT NULL,           -- day / week / month
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,

    session_count    INTEGER,
    success_rate     REAL,
    avg_token_cost   INTEGER,
    active_user_count INTEGER,
    usage_depth      REAL,                    -- avg messages per session as proxy
    top_categories_json TEXT,                 -- top 5 with counts
    top_questions_json TEXT,                  -- top 5 question texts (truncated)

    health_score     REAL,                    -- 0-100, computed below
    health_breakdown_json TEXT,               -- per-component scores

    tier_change      TEXT,                    -- upgrade / downgrade / stable / new
    computed_at      TEXT DEFAULT (datetime('now')),
    UNIQUE (team_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_ts_team_period ON int_team_snapshots(team_id, period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ts_health ON int_team_snapshots(period_type, period_start, health_score);

-- ═══════════════════════════════════════════════════════════════
-- Outcome tracking — extend optimization_actions with snapshot fields
-- (used by suggestion outcome tracker)
-- ═══════════════════════════════════════════════════════════════

-- Note: int_optimization_actions already has rollout_status & observation_until.
-- Add measured outcome fields without altering existing column order.

ALTER TABLE int_optimization_actions ADD COLUMN pre_success_rate REAL;
ALTER TABLE int_optimization_actions ADD COLUMN post_success_rate REAL;
ALTER TABLE int_optimization_actions ADD COLUMN success_delta_pp REAL;
ALTER TABLE int_optimization_actions ADD COLUMN evaluated_at TEXT;
