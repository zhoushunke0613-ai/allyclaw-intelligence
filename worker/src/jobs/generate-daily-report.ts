/**
 * Daily report generator — MVP rule-based, no LLM.
 *
 * Aggregates from int_daily_metrics + int_question_classifications
 * for a given date (default: yesterday UTC), produces Markdown,
 * stores into int_reports.
 *
 * Phase 2 will enrich with LLM-generated summary + insights.
 */

import type { Env } from '../env'

const GENERATOR_VERSION = 'v1.0-template'

interface DailyAgg {
  total_sessions: number
  success: number
  failure: number
  refuse: number
  partial: number
  unknown: number
  active_teams: number
}

interface CategoryRow {
  category_id: string
  name: string
  count: number
}

interface TeamRow {
  team_id: string
  session_count: number
  success_count: number
}

interface SuggestionRow {
  suggestion_id: string
  title: string
  priority: string
  type: string
  affected_sessions: number | null
}

export async function generateDailyReport(env: Env, opts: { date?: string } = {}): Promise<{
  report_id: string
  markdown_chars: number
  date: string
}> {
  const date = opts.date ?? yesterdayUTC()
  const reportId = `R-${date}-daily-global`

  const [agg, topCategories, teamRanking, openSuggestions] = await Promise.all([
    aggregateDay(env, date),
    topCategoriesForDate(env, date),
    teamRankingForDate(env, date),
    openSuggestionsTop(env),
  ])

  const markdown = renderMarkdown(date, agg, topCategories, teamRanking, openSuggestions)
  const metadata = JSON.stringify({
    agg,
    top_categories: topCategories.length,
    teams: teamRanking.length,
    open_suggestions: openSuggestions.length,
  })

  await env.DB.prepare(
    `INSERT INTO int_reports
      (report_id, report_type, scope, period_start, period_end,
       markdown, metadata_json, generator_version)
     VALUES (?, 'daily', 'global', ?, ?, ?, ?, ?)
     ON CONFLICT(report_id) DO UPDATE SET
       markdown = excluded.markdown,
       metadata_json = excluded.metadata_json,
       generated_at = datetime('now')`,
  ).bind(reportId, date, date, markdown, metadata, GENERATOR_VERSION).run()

  return { report_id: reportId, markdown_chars: markdown.length, date }
}

function yesterdayUTC(): string {
  const d = new Date(Date.now() - 86400000)
  return d.toISOString().slice(0, 10)
}

async function aggregateDay(env: Env, date: string): Promise<DailyAgg> {
  const row = await env.DB.prepare(
    `SELECT
        COALESCE(SUM(session_count), 0) AS total_sessions,
        COALESCE(SUM(success_count), 0) AS success,
        COALESCE(SUM(failure_count), 0) AS failure,
        COALESCE(SUM(refuse_count), 0) AS refuse,
        COUNT(DISTINCT team_id) AS active_teams
     FROM int_daily_metrics
     WHERE metric_date = ? AND category_id = '_overall'`,
  ).bind(date).first<{
    total_sessions: number
    success: number
    failure: number
    refuse: number
    active_teams: number
  }>()

  // partial / unknown are not tracked in daily_metrics yet — derive from sessions_enriched
  const labelRow = await env.DB.prepare(
    `SELECT
        SUM(CASE WHEN success_label = 'partial' THEN 1 ELSE 0 END) AS partial,
        SUM(CASE WHEN success_label = 'unknown' THEN 1 ELSE 0 END) AS unknown
     FROM int_sessions_enriched
     WHERE date(enriched_at) = ?`,
  ).bind(date).first<{ partial: number; unknown: number }>()

  return {
    total_sessions: row?.total_sessions ?? 0,
    success: row?.success ?? 0,
    failure: row?.failure ?? 0,
    refuse: row?.refuse ?? 0,
    partial: labelRow?.partial ?? 0,
    unknown: labelRow?.unknown ?? 0,
    active_teams: row?.active_teams ?? 0,
  }
}

async function topCategoriesForDate(env: Env, date: string): Promise<CategoryRow[]> {
  const rows = await env.DB.prepare(
    `SELECT qc.category_id, c.name, COUNT(*) AS count
     FROM int_question_classifications qc
     JOIN int_taxonomy_categories c ON c.category_id = qc.category_id
     WHERE qc.is_primary = 1 AND date(qc.classified_at) = ?
     GROUP BY qc.category_id ORDER BY count DESC LIMIT 10`,
  ).bind(date).all<CategoryRow>()
  return rows.results
}

async function teamRankingForDate(env: Env, date: string): Promise<TeamRow[]> {
  const rows = await env.DB.prepare(
    `SELECT team_id, session_count, success_count
     FROM int_daily_metrics
     WHERE metric_date = ? AND category_id = '_overall'
     ORDER BY session_count DESC LIMIT 5`,
  ).bind(date).all<TeamRow>()
  return rows.results
}

async function openSuggestionsTop(env: Env): Promise<SuggestionRow[]> {
  const rows = await env.DB.prepare(
    `SELECT suggestion_id, title, priority, type, affected_sessions
     FROM int_optimization_suggestions
     WHERE status = 'open'
     ORDER BY
       CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT 10`,
  ).all<SuggestionRow>()
  return rows.results
}

function renderMarkdown(
  date: string,
  agg: DailyAgg,
  cats: CategoryRow[],
  teams: TeamRow[],
  suggestions: SuggestionRow[],
): string {
  const total = agg.total_sessions
  const successRate = total ? ((agg.success / total) * 100).toFixed(1) : '—'
  const failRate = total ? ((agg.failure / total) * 100).toFixed(1) : '—'

  const catLines = cats.length
    ? cats.map((c, i) => `${i + 1}. ${c.name} — ${c.count}`).join('\n')
    : '_no classification data yet_'

  const teamLines = teams.length
    ? teams.map((t, i) => {
        const tr = t.session_count ? ((t.success_count / t.session_count) * 100).toFixed(1) : '—'
        return `${i + 1}. \`${t.team_id}\` — ${t.session_count} sessions (${tr}% success)`
      }).join('\n')
    : '_no team activity_'

  const suggestionLines = suggestions.length
    ? suggestions.map((s, i) => {
        const scope = s.affected_sessions ? ` · ${s.affected_sessions} sessions affected` : ''
        return `${i + 1}. **[${s.priority}]** ${s.title}\n   \`${s.suggestion_id}\` · ${s.type}${scope}`
      }).join('\n')
    : '_no open suggestions_'

  return `# AllyClaw Daily Report — ${date}

> Generated by ${GENERATOR_VERSION} (rule-based, no LLM enrichment).

## At a Glance

| Metric | Value |
|--------|-------|
| Total sessions | ${total} |
| Active teams | ${agg.active_teams} |
| Success rate | ${successRate}% |
| Failure rate | ${failRate}% |
| Partial / Unknown | ${agg.partial} / ${agg.unknown} |
| Refused | ${agg.refuse} |

## Top Question Categories

${catLines}

## Most Active Teams

${teamLines}

## Open Optimization Suggestions

${suggestionLines}

## Notes

- Success_label is derived by rule (PRD §16.8.2 v1.1).
- Categories are matched by keyword rules (no LLM fallback yet).
- Suggestions are auto-generated by detectors (PRD §11). Open ones await human review.
`
}
