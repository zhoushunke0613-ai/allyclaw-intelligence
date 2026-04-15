/**
 * Team snapshots — weekly rollup with health score.
 *
 * For each team x ISO-week, computes:
 *   - session_count, success_rate, avg_token_cost
 *   - usage_depth = avg messages per session (proxy from message_count)
 *   - top_categories (JSON array of {id, name, count})
 *   - top_questions (JSON array of strings)
 *   - health_score: weighted composite, see scoreComponents()
 *
 * Idempotent: UNIQUE (team_id, period_type, period_start) → upsert.
 */

import type { Env } from '../env'

const SNAPSHOT_VERSION = 'v1.0'

interface TeamRow {
  team_id: string
}

interface BasicStats {
  session_count: number
  success_count: number
  failure_count: number
  refuse_count: number
  partial_count: number
  total_messages: number
  active_servers: number
  classified_count: number
}

interface CategoryEntry {
  category_id: string
  name: string
  count: number
}

interface ScoreComponents {
  success: number
  activity: number
  classification_coverage: number
  responsiveness: number
}

const TIER_CHANGE_THRESHOLD = 5  // health_score points

export interface SnapshotResult {
  teams_processed: number
  snapshots_written: number
  period_start: string
  period_end: string
}

export async function computeTeamSnapshots(env: Env, opts: { weekStart?: string } = {}): Promise<SnapshotResult> {
  const { start, end } = isoWeekRange(opts.weekStart)

  const teams = await env.DB.prepare(`SELECT team_id FROM int_teams`).all<TeamRow>()
  let written = 0

  for (const t of teams.results) {
    const stats = await loadBasicStats(env, t.team_id, start, end)
    if (stats.session_count === 0) continue

    const topCats = await loadTopCategories(env, t.team_id, start, end)
    const topQs = await loadTopQuestions(env, t.team_id, start, end)
    const p50Duration = await loadP50Duration(env, t.team_id, start, end)
    const prevHealth = await loadPreviousHealthScore(env, t.team_id, start)
    const successRate = stats.session_count ? stats.success_count / stats.session_count : 0
    const usageDepth = stats.session_count ? stats.total_messages / stats.session_count : 0
    const components = scoreComponents(stats, successRate, p50Duration)
    const health = compositeHealth(components)
    const tierChange = computeTierChange(health, prevHealth)

    await env.DB.prepare(
      `INSERT INTO int_team_snapshots
        (team_id, period_type, period_start, period_end,
         session_count, success_rate, avg_token_cost,
         active_user_count, usage_depth,
         top_categories_json, top_questions_json,
         health_score, health_breakdown_json,
         tier_change, computed_at)
       VALUES (?, 'week', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, period_type, period_start) DO UPDATE SET
         period_end = excluded.period_end,
         session_count = excluded.session_count,
         success_rate = excluded.success_rate,
         avg_token_cost = excluded.avg_token_cost,
         active_user_count = excluded.active_user_count,
         usage_depth = excluded.usage_depth,
         top_categories_json = excluded.top_categories_json,
         top_questions_json = excluded.top_questions_json,
         health_score = excluded.health_score,
         health_breakdown_json = excluded.health_breakdown_json,
         tier_change = excluded.tier_change,
         computed_at = datetime('now')`,
    ).bind(
      t.team_id, start, end,
      stats.session_count, successRate, null,
      stats.active_servers, usageDepth,
      JSON.stringify(topCats), JSON.stringify(topQs),
      health, JSON.stringify(components),
      tierChange, new Date().toISOString(),
    ).run()

    written++
  }

  return {
    teams_processed: teams.results.length,
    snapshots_written: written,
    period_start: start,
    period_end: end,
  }
}

async function loadBasicStats(env: Env, team_id: string, start: string, end: string): Promise<BasicStats> {
  const row = await env.DB.prepare(
    `SELECT
        COUNT(*) AS session_count,
        SUM(CASE WHEN success_label = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN success_label = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        SUM(CASE WHEN success_label = 'refuse' THEN 1 ELSE 0 END) AS refuse_count,
        SUM(CASE WHEN success_label = 'partial' THEN 1 ELSE 0 END) AS partial_count,
        COUNT(DISTINCT server_id) AS active_servers
     FROM int_sessions_enriched
     WHERE team_id = ? AND enriched_at >= ? AND enriched_at < ?`,
  ).bind(team_id, start, end).first<{
    session_count: number; success_count: number; failure_count: number;
    refuse_count: number; partial_count: number; active_servers: number;
  }>()

  // total messages from Layer 0 sessions table joined back via ids
  const msgRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(s.message_count), 0) AS total_messages
     FROM sessions s
     JOIN int_sessions_enriched se ON se.session_id = s.id AND se.server_id = s.server_id
     WHERE se.team_id = ? AND se.enriched_at >= ? AND se.enriched_at < ?`,
  ).bind(team_id, start, end).first<{ total_messages: number }>()

  const classifiedRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT qc.session_id) AS classified_count
     FROM int_question_classifications qc
     JOIN int_sessions_enriched se ON se.session_id = qc.session_id AND se.server_id = qc.server_id
     WHERE qc.team_id = ? AND se.enriched_at >= ? AND se.enriched_at < ? AND qc.is_primary = 1`,
  ).bind(team_id, start, end).first<{ classified_count: number }>()

  return {
    session_count: row?.session_count ?? 0,
    success_count: row?.success_count ?? 0,
    failure_count: row?.failure_count ?? 0,
    refuse_count: row?.refuse_count ?? 0,
    partial_count: row?.partial_count ?? 0,
    total_messages: msgRow?.total_messages ?? 0,
    active_servers: row?.active_servers ?? 0,
    classified_count: classifiedRow?.classified_count ?? 0,
  }
}

async function loadTopCategories(env: Env, team_id: string, start: string, end: string): Promise<CategoryEntry[]> {
  const rows = await env.DB.prepare(
    `SELECT qc.category_id, c.name, COUNT(*) AS count
     FROM int_question_classifications qc
     JOIN int_sessions_enriched se ON se.session_id = qc.session_id AND se.server_id = qc.server_id
     JOIN int_taxonomy_categories c ON c.category_id = qc.category_id
     WHERE qc.team_id = ? AND qc.is_primary = 1
       AND se.enriched_at >= ? AND se.enriched_at < ?
     GROUP BY qc.category_id ORDER BY count DESC LIMIT 5`,
  ).bind(team_id, start, end).all<CategoryEntry>()
  return rows.results
}

async function loadTopQuestions(env: Env, team_id: string, start: string, end: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT s.summary
     FROM sessions s
     JOIN int_sessions_enriched se ON se.session_id = s.id AND se.server_id = s.server_id
     WHERE se.team_id = ? AND se.enriched_at >= ? AND se.enriched_at < ?
       AND s.summary IS NOT NULL AND length(s.summary) > 5
     LIMIT 5`,
  ).bind(team_id, start, end).all<{ summary: string }>()
  return rows.results.map(r => r.summary).slice(0, 5)
}

/**
 * Median of total_duration_ms across the team's enriched sessions in this window.
 * D1 has no native PERCENTILE, so we load sorted values and pick the middle.
 * Typical weekly volume per team is well under a few hundred rows.
 */
async function loadP50Duration(env: Env, team_id: string, start: string, end: string): Promise<number | null> {
  const rows = await env.DB.prepare(
    `SELECT total_duration_ms
     FROM int_sessions_enriched
     WHERE team_id = ? AND enriched_at >= ? AND enriched_at < ?
       AND total_duration_ms IS NOT NULL AND total_duration_ms > 0
     ORDER BY total_duration_ms`,
  ).bind(team_id, start, end).all<{ total_duration_ms: number }>()

  const durations = rows.results.map(r => r.total_duration_ms)
  if (durations.length === 0) return null
  const mid = Math.floor(durations.length / 2)
  return durations.length % 2 === 0
    ? (durations[mid - 1] + durations[mid]) / 2
    : durations[mid]
}

async function loadPreviousHealthScore(env: Env, team_id: string, currentStart: string): Promise<number | null> {
  const prev = await env.DB.prepare(
    `SELECT health_score
     FROM int_team_snapshots
     WHERE team_id = ? AND period_type = 'week' AND period_start < ?
     ORDER BY period_start DESC LIMIT 1`,
  ).bind(team_id, currentStart).first<{ health_score: number | null }>()
  return prev?.health_score ?? null
}

/**
 * tier_change semantics match the schema enum: upgrade / downgrade / stable / new.
 * 5-point threshold on a 0-100 health_score — tight enough to surface real
 * movement, loose enough to ignore weekly noise from tiny session counts.
 */
function computeTierChange(current: number, previous: number | null): string {
  if (previous === null) return 'new'
  const delta = current - previous
  if (delta >= TIER_CHANGE_THRESHOLD) return 'upgrade'
  if (delta <= -TIER_CHANGE_THRESHOLD) return 'downgrade'
  return 'stable'
}

/**
 * Health score components, each 0-1.
 *
 * - success: success_rate, capped at 0.95 = 1.0 (perfect rate is unrealistic)
 * - activity: log-scaled session count (sessions ≥ 50 = 1.0)
 * - classification_coverage: classified_count / session_count (proxy for "we understand what they ask")
 * - responsiveness: from P50 session duration — linear decay 0s→1.0 through 300s→0.2,
 *     clamped at 0.2 floor. Null P50 (no duration data) keeps 0.7 neutral fallback.
 */
function scoreComponents(stats: BasicStats, successRate: number, p50DurationMs: number | null): ScoreComponents {
  const success = Math.min(successRate / 0.95, 1.0)
  const activity = stats.session_count >= 50 ? 1.0 : Math.log10(stats.session_count + 1) / Math.log10(51)
  const classCov = stats.session_count > 0 ? stats.classified_count / stats.session_count : 0
  const responsiveness = p50DurationMs === null
    ? 0.7
    : Math.max(0.2, 1 - p50DurationMs / 300000)
  return {
    success: round2(success),
    activity: round2(activity),
    classification_coverage: round2(classCov),
    responsiveness: round2(responsiveness),
  }
}

function compositeHealth(c: ScoreComponents): number {
  const score = c.success * 0.4 + c.activity * 0.3 + c.classification_coverage * 0.2 + c.responsiveness * 0.1
  return Math.round(score * 100)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * ISO week range starting Monday. Returns ISO timestamps for [start, end).
 */
function isoWeekRange(weekStart?: string): { start: string; end: string } {
  const ref = weekStart ? new Date(weekStart) : new Date()
  const day = ref.getUTCDay() || 7
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - day + 1))
  const nextMonday = new Date(monday.getTime() + 7 * 86400000)
  return {
    start: monday.toISOString(),
    end: nextMonday.toISOString(),
  }
}

export const SNAPSHOT_VERSION_ID = SNAPSHOT_VERSION
