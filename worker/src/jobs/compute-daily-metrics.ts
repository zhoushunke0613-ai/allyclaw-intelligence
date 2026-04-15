/**
 * Materialize int_daily_metrics from int_sessions_enriched.
 *
 * MVP: aggregate by (date, team_id), category_id = NULL (no classification yet).
 * Idempotent: PRIMARY KEY conflict triggers REPLACE.
 */

import type { Env } from '../env'

interface Aggregate {
  metric_date: string
  team_id: string
  session_count: number
  success_count: number
  failure_count: number
  refuse_count: number
  total_skill_calls: number
  total_api_calls: number
}

export async function computeDailyMetrics(env: Env, opts: { days?: number } = {}): Promise<{
  rows_written: number
  date_range: { from: string; to: string }
}> {
  const db = env.DB
  const days = opts.days ?? 30

  // Aggregate from sessions_enriched
  const aggregates = await db.prepare(
    `SELECT
        date(enriched_at) AS metric_date,
        team_id,
        COUNT(*) AS session_count,
        SUM(CASE WHEN success_label = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN success_label = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        SUM(CASE WHEN success_label = 'refuse' THEN 1 ELSE 0 END) AS refuse_count,
        COALESCE(SUM(skill_call_count), 0) AS total_skill_calls,
        COALESCE(SUM(api_call_count), 0) AS total_api_calls
     FROM int_sessions_enriched
     WHERE enriched_at >= datetime('now', ?)
     GROUP BY date(enriched_at), team_id`,
  ).bind(`-${days} days`).all<Aggregate>()

  let rowsWritten = 0
  for (const a of aggregates.results) {
    await db.prepare(
      `INSERT INTO int_daily_metrics
        (metric_date, team_id, category_id,
         session_count, success_count, failure_count, refuse_count,
         total_skill_calls, total_api_calls)
       VALUES (?, ?, '_overall', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric_date, team_id, category_id) DO UPDATE SET
         session_count = excluded.session_count,
         success_count = excluded.success_count,
         failure_count = excluded.failure_count,
         refuse_count = excluded.refuse_count,
         total_skill_calls = excluded.total_skill_calls,
         total_api_calls = excluded.total_api_calls,
         computed_at = datetime('now')`,
    ).bind(
      a.metric_date, a.team_id,
      a.session_count, a.success_count, a.failure_count, a.refuse_count,
      a.total_skill_calls, a.total_api_calls,
    ).run()
    rowsWritten++
  }

  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  return { rows_written: rowsWritten, date_range: { from, to: today } }
}
