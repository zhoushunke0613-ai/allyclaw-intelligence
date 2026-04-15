/**
 * Suggestion outcome tracker.
 *
 * For each int_optimization_actions row that has been live ≥ 30 days
 * and not yet evaluated, computes pre/post success_rate over the action's
 * scope and writes the delta back to the action row.
 *
 * MVP scope: only handles actions where parent suggestion has a
 * scope_team_ids OR scope_category_ids (single team / single category).
 * More complex scopes (skill-level, cross-team A/B) deferred to Phase 3.
 */

import type { Env } from '../env'

const EVAL_WINDOW_DAYS = 30
const TRACKER_VERSION = 'v1.0'

interface ActionRow {
  action_id: number
  suggestion_id: string
  applied_at: string
  scope_team_ids: string | null
  scope_category_ids: string | null
}

export interface TrackerResult {
  actions_evaluated: number
  details: Array<{
    action_id: number
    suggestion_id: string
    pre_success_rate: number | null
    post_success_rate: number | null
    delta_pp: number | null
  }>
}

export async function trackSuggestionOutcomes(env: Env): Promise<TrackerResult> {
  const db = env.DB

  const candidates = await db.prepare(
    `SELECT a.action_id, a.suggestion_id, a.applied_at,
            s.scope_team_ids, s.scope_category_ids
     FROM int_optimization_actions a
     JOIN int_optimization_suggestions s ON s.suggestion_id = a.suggestion_id
     WHERE a.evaluated_at IS NULL
       AND a.rollout_status IN ('live', 'promoted')
       AND a.applied_at <= datetime('now', '-${EVAL_WINDOW_DAYS} days')`,
  ).all<ActionRow>()

  const details: TrackerResult['details'] = []

  for (const action of candidates.results) {
    const pre = await successRate(env, action, action.applied_at, -EVAL_WINDOW_DAYS, 0)
    const post = await successRate(env, action, action.applied_at, 0, EVAL_WINDOW_DAYS)
    const delta = pre !== null && post !== null ? round2((post - pre) * 100) : null

    await db.prepare(
      `UPDATE int_optimization_actions
       SET pre_success_rate = ?, post_success_rate = ?, success_delta_pp = ?,
           evaluated_at = datetime('now')
       WHERE action_id = ?`,
    ).bind(pre, post, delta, action.action_id).run()

    await db.prepare(
      `INSERT INTO int_suggestion_comments
        (suggestion_id, author_id, body, action, metadata_json)
       VALUES (?, 'system', ?, 'comment', ?)`,
    ).bind(
      action.suggestion_id,
      `Outcome evaluated by ${TRACKER_VERSION}: pre ${fmt(pre)} → post ${fmt(post)} (Δ ${delta ?? '—'} pp)`,
      JSON.stringify({ pre, post, delta_pp: delta, eval_window_days: EVAL_WINDOW_DAYS }),
    ).run()

    details.push({
      action_id: action.action_id,
      suggestion_id: action.suggestion_id,
      pre_success_rate: pre,
      post_success_rate: post,
      delta_pp: delta,
    })
  }

  return { actions_evaluated: candidates.results.length, details }
}

async function successRate(
  env: Env,
  action: ActionRow,
  appliedAt: string,
  startOffsetDays: number,
  endOffsetDays: number,
): Promise<number | null> {
  const conditions: string[] = [
    `enriched_at >= datetime(?, '${startOffsetDays} days')`,
    `enriched_at < datetime(?, '${endOffsetDays} days')`,
  ]
  const params: unknown[] = [appliedAt, appliedAt]

  if (action.scope_team_ids && action.scope_team_ids !== 'all') {
    conditions.push('team_id = ?')
    params.push(action.scope_team_ids)
  }

  if (action.scope_category_ids) {
    conditions.push(`session_id IN (
      SELECT session_id FROM int_question_classifications
      WHERE category_id = ? AND is_primary = 1
    )`)
    params.push(action.scope_category_ids)
  }

  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN success_label = 'success' THEN 1 ELSE 0 END) AS success
     FROM int_sessions_enriched
     WHERE ${conditions.join(' AND ')}`,
  ).bind(...params).first<{ total: number; success: number }>()

  if (!row || row.total === 0) return null
  return round2(row.success / row.total)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmt(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`
}
