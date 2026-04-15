-- Migration 003: Fix daily_metrics duplicate rows
-- Created: 2026-04-15
-- Reason: ON CONFLICT(metric_date, team_id, category_id) does not fire when
--   category_id is NULL (SQLite treats NULL != NULL). Switch overall metrics
--   to use sentinel '_overall' so PRIMARY KEY conflicts trigger UPDATE.
-- Reference: docs/DATA-MODEL.md §8.1

-- 1. Migrate existing NULL rows into '_overall' rows, summing duplicates
INSERT INTO int_daily_metrics
  (metric_date, team_id, category_id,
   session_count, user_message_count,
   success_count, failure_count, refuse_count, followup_count, repeated_count,
   avg_duration_ms, p50_duration_ms, p95_duration_ms,
   total_skill_calls, total_api_calls,
   total_input_tokens, total_output_tokens, computed_at)
SELECT
  metric_date, team_id, '_overall' AS category_id,
  SUM(session_count), SUM(COALESCE(user_message_count, 0)),
  SUM(success_count), SUM(failure_count), SUM(refuse_count),
  SUM(COALESCE(followup_count, 0)), SUM(COALESCE(repeated_count, 0)),
  AVG(avg_duration_ms), AVG(p50_duration_ms), AVG(p95_duration_ms),
  SUM(total_skill_calls), SUM(total_api_calls),
  SUM(COALESCE(total_input_tokens, 0)), SUM(COALESCE(total_output_tokens, 0)),
  MAX(computed_at)
FROM int_daily_metrics
WHERE category_id IS NULL
GROUP BY metric_date, team_id
ON CONFLICT(metric_date, team_id, category_id) DO UPDATE SET
  session_count = excluded.session_count,
  success_count = excluded.success_count,
  failure_count = excluded.failure_count,
  refuse_count = excluded.refuse_count,
  total_skill_calls = excluded.total_skill_calls,
  total_api_calls = excluded.total_api_calls,
  computed_at = excluded.computed_at;

-- 2. Delete the old NULL rows
DELETE FROM int_daily_metrics WHERE category_id IS NULL;
