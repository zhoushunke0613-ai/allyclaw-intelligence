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

interface MessageRow {
  role: string
  content: string
  timestamp: string
}

interface MessageStats {
  user_count: number
  assistant_count: number
  tool_count: number
  last_role: string | null
  last_content_len: number
  has_error_keyword: boolean
  messages: MessageRow[]
  user_msgs_after_last_assistant: number
  refuse_in_last_assistant: boolean
}

const ENRICHMENT_VERSION = 'v1.1-prd-16.8.2'

const REFUSE_PATTERNS = [
  /无法/, /抱歉.{0,5}不能/, /sorry.{0,15}cannot/i, /can'?t (help|do|provide)/i,
  /not able to/i, /unable to/i, /我没有(权限|能力)/, /超出.{0,5}范围/,
]

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
    const verdict = deriveSuccessLabel(stats)

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
      verdict.label, verdict.confidence,
      ENRICHMENT_VERSION, enriched_at,
    ).run()

    processed++
  }

  return { sessions_processed: processed, enriched_at }
}

async function collectStats(env: Env, session: SessionRow): Promise<MessageStats> {
  const rows = await env.DB.prepare(
    `SELECT role, content, timestamp
     FROM messages
     WHERE session_id = ? AND server_id = ?
     ORDER BY timestamp`,
  ).bind(session.id, session.server_id).all<MessageRow>()

  const stats: MessageStats = {
    user_count: 0,
    assistant_count: 0,
    tool_count: 0,
    last_role: null,
    last_content_len: 0,
    has_error_keyword: false,
    messages: rows.results,
    user_msgs_after_last_assistant: 0,
    refuse_in_last_assistant: false,
  }

  let lastAssistantContent = ''
  let userTrailing = 0

  for (const m of rows.results) {
    const role = (m.role || '').toLowerCase()
    const content = m.content || ''
    if (role === 'user') {
      stats.user_count++
      userTrailing++
    } else if (role === 'assistant') {
      stats.assistant_count++
      lastAssistantContent = content
      userTrailing = 0
    } else if (role.includes('tool')) {
      stats.tool_count++
    }

    if (/error|failed|exception/i.test(content)) stats.has_error_keyword = true
    stats.last_role = role
    stats.last_content_len = content.length
  }

  stats.user_msgs_after_last_assistant = userTrailing
  stats.refuse_in_last_assistant = lastAssistantContent
    ? REFUSE_PATTERNS.some(p => p.test(lastAssistantContent))
    : false

  return stats
}

/**
 * success_label per PRD §16.8.2 (rule version, no LLM yet).
 *
 * Priority order (top match wins):
 *   1. refuse keywords in last assistant   → refuse
 *   2. error event + no recovery            → failure
 *   3. user-only trailing > 0               → partial (refines "follow-up")
 *   4. > 10 turns + last 3 are user         → partial
 *   5. assistant last with substantial body → success
 *   6. otherwise                            → unknown
 *
 * Confidence assigned per branch; LLM upgrade in Phase 2 will improve calibration.
 */
function deriveSuccessLabel(stats: MessageStats): { label: string; confidence: number } {
  if (stats.assistant_count === 0) return { label: 'failure', confidence: 0.85 }
  if (stats.refuse_in_last_assistant) return { label: 'refuse', confidence: 0.8 }
  if (stats.has_error_keyword && stats.last_role !== 'assistant') return { label: 'failure', confidence: 0.7 }
  if (stats.user_msgs_after_last_assistant > 0) return { label: 'partial', confidence: 0.75 }

  const total = stats.messages.length
  if (total > 10) {
    const tail = stats.messages.slice(-3)
    if (tail.every(m => (m.role || '').toLowerCase() === 'user')) {
      return { label: 'partial', confidence: 0.7 }
    }
  }
  if (stats.last_role === 'assistant' && stats.last_content_len > 10) {
    return { label: 'success', confidence: 0.7 }
  }
  return { label: 'unknown', confidence: 0.5 }
}
