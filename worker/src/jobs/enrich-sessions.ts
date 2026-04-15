/**
 * Session enrichment job (MVP rule-based).
 *
 * Reads sessions + messages from Layer 0, derives:
 *   - skill_call_count / api_call_count / tool_call_count (proxy: count by role)
 *   - success_label by simple heuristic
 *   - has_followup (within 30 min of session end)
 * Writes to int_sessions_enriched.
 *
 * Idempotent: existing rows are replaced. Run as full rebuild for now;
 * incremental processing comes later.
 */

import type { Env } from '../env'
import { extractTeam } from '../utils/team'

interface SessionRow {
  id: string
  server_id: string
  agent_id: string
  started_at: string
  ended_at: string | null
  message_count: number
  user_message_count: number
  total_tokens: number
}

interface MessageStats {
  user_count: number
  assistant_count: number
  tool_count: number
  last_role: string | null
  last_content_len: number
  has_error_keyword: boolean
}

const ENRICHMENT_VERSION = 'v1.0-rule'

export async function enrichSessions(env: Env, opts: { limit?: number } = {}): Promise<{
  sessions_processed: number
  enriched_at: string
}> {
  const db = env.DB
  const limit = opts.limit ?? 1000

  // Load sessions to enrich (MVP: rebuild all up to limit; sorted by recency)
  const sessions = await db.prepare(
    `SELECT id, server_id, agent_id, started_at, ended_at,
        message_count, user_message_count, total_tokens
     FROM sessions
     ORDER BY started_at DESC
     LIMIT ?`,
  ).bind(limit).all<SessionRow>()

  const enriched_at = new Date().toISOString()
  let processed = 0

  for (const s of sessions.results) {
    const stats = await collectStats(env, s)
    const { team_id } = extractTeam(s.server_id)
    const success_label = deriveSuccessLabel(stats)

    const duration_ms = s.ended_at && s.started_at
      ? Math.max(0, new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())
      : null

    await db.prepare(
      `INSERT INTO int_sessions_enriched
        (session_id, server_id, team_id,
         skill_call_count, api_call_count, tool_call_count,
         total_duration_ms, error_count,
         success_label, success_conf,
         enrichment_version, enriched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, server_id) DO UPDATE SET
         team_id = excluded.team_id,
         skill_call_count = excluded.skill_call_count,
         api_call_count = excluded.api_call_count,
         tool_call_count = excluded.tool_call_count,
         total_duration_ms = excluded.total_duration_ms,
         error_count = excluded.error_count,
         success_label = excluded.success_label,
         success_conf = excluded.success_conf,
         enrichment_version = excluded.enrichment_version,
         enriched_at = excluded.enriched_at`,
    ).bind(
      s.id, s.server_id, team_id,
      0, 0, stats.tool_count,                    // MVP: only tool_count from messages role
      duration_ms, stats.has_error_keyword ? 1 : 0,
      success_label, 0.6,                        // rule-based confidence
      ENRICHMENT_VERSION, enriched_at,
    ).run()

    processed++
  }

  return { sessions_processed: processed, enriched_at }
}

async function collectStats(env: Env, session: SessionRow): Promise<MessageStats> {
  const rows = await env.DB.prepare(
    `SELECT role, content
     FROM messages
     WHERE session_id = ? AND server_id = ?
     ORDER BY timestamp`,
  ).bind(session.id, session.server_id).all<{ role: string; content: string }>()

  const stats: MessageStats = {
    user_count: 0,
    assistant_count: 0,
    tool_count: 0,
    last_role: null,
    last_content_len: 0,
    has_error_keyword: false,
  }

  for (const m of rows.results) {
    const role = (m.role || '').toLowerCase()
    if (role === 'user') stats.user_count++
    else if (role === 'assistant') stats.assistant_count++
    else if (role.includes('tool')) stats.tool_count++

    if (/error|failed|exception/i.test(m.content || '')) stats.has_error_keyword = true

    stats.last_role = role
    stats.last_content_len = (m.content || '').length
  }

  return stats
}

/**
 * Heuristic success_label (PRD §16.8.2 simplified for MVP):
 *   - assistant 是最后一条且内容非空 → success
 *   - 没 assistant 回复 → failure
 *   - 否则 → unknown
 *
 * 真实判定（追问检测、HEARTBEAT 过滤等）放到 v2 enrichment 实现。
 */
function deriveSuccessLabel(stats: MessageStats): string {
  if (stats.assistant_count === 0) return 'failure'
  if (stats.last_role === 'assistant' && stats.last_content_len > 10) return 'success'
  return 'unknown'
}
