/**
 * Detector: cross-session repeat (D-004).
 *
 * Behavioral proxy for "用户跨 session 追问" detection. True cross-session
 * follow-up attribution would require either a user identifier in sessions
 * (unavailable — `sessions.agent_id` is always 'main') or the planned
 * `int_execution_events` table (not yet migrated; requires context-dashboard
 * agent upgrade per DATA-MODEL §12.3).
 *
 * Until then, we approximate the signal: if a single (server_id, category) hits
 * ≥ MIN_SESSIONS sessions in LOOKBACK_DAYS and at least MIN_NON_SUCCESS of them
 * are failure/refuse/partial, the users behind that server are very likely
 * retrying the same topic without getting a working answer — which is exactly
 * what real "追问" behavior looks like on our end.
 *
 * Differentiation from sibling detectors:
 *   - D-001 (high-failure-category) groups by TEAM + category with a rate
 *     threshold (≥30%). A team may span multiple servers; D-001 will miss a
 *     server-local chronic issue masked by healthy peers.
 *   - D-002 (category-coverage-gap) aggregates across ALL teams.
 *   - D-003 (context-gap) asks the LLM to diagnose WHY.
 *   - D-004 (this one) catches COUNT-based repetition at server granularity
 *     — a fundamentally different signal from rate-based detectors.
 *
 * Rule-based and deterministic — no LLM cost.
 */

import type { Env } from '../../env'

const DETECTOR_ID = 'D-004-cross-session-repeat'
const DETECTOR_VERSION = 'v1.0'
const LOOKBACK_DAYS = 7
const MIN_SESSIONS = 3
const MIN_NON_SUCCESS = 2
const MAX_SAMPLES = 5

interface RepeatRow {
  team_id: string
  server_id: string
  category_id: string
  category_name: string
  session_count: number
  non_success_count: number
  first_seen: string
  last_seen: string
}

interface DetectorResult {
  detector_id: string
  problems_found: number
  suggestions_created: number
  suggestions_skipped: number
}

export async function detectCrossSessionRepeat(env: Env): Promise<DetectorResult> {
  const db = env.DB

  const rows = await db.prepare(
    `SELECT
        se.team_id,
        se.server_id,
        qc.category_id,
        c.name AS category_name,
        COUNT(*) AS session_count,
        SUM(CASE WHEN se.success_label IN ('failure', 'refuse', 'partial') THEN 1 ELSE 0 END) AS non_success_count,
        MIN(se.enriched_at) AS first_seen,
        MAX(se.enriched_at) AS last_seen
     FROM int_sessions_enriched se
     JOIN int_question_classifications qc
       ON qc.session_id = se.session_id
      AND qc.server_id = se.server_id
      AND qc.is_primary = 1
     JOIN int_taxonomy_categories c ON c.category_id = qc.category_id
     WHERE se.enriched_at >= datetime('now', ?)
     GROUP BY se.team_id, se.server_id, qc.category_id
     HAVING session_count >= ?
        AND non_success_count >= ?
     ORDER BY non_success_count DESC, session_count DESC`,
  ).bind(`-${LOOKBACK_DAYS} days`, MIN_SESSIONS, MIN_NON_SUCCESS).all<RepeatRow>()

  let created = 0
  let skipped = 0

  for (const r of rows.results) {
    const outcome = await createSuggestion(env, r)
    if (outcome === 'created') created++
    else skipped++
  }

  return {
    detector_id: DETECTOR_ID,
    problems_found: rows.results.length,
    suggestions_created: created,
    suggestions_skipped: skipped,
  }
}

async function createSuggestion(env: Env, r: RepeatRow): Promise<'created' | 'skipped'> {
  const db = env.DB
  const dedupKey = `${DETECTOR_ID}:team=${r.team_id}:server=${r.server_id}:cat=${r.category_id}:open`

  const existing = await db.prepare(
    `SELECT 1 FROM int_optimization_suggestions
     WHERE dedup_key = ? AND status NOT IN ('rejected', 'obsolete', 'rolled_back')`,
  ).bind(dedupKey).first()
  if (existing) return 'skipped'

  const suggestionId = `S-${ymd()}-${randHex()}`
  const title = `Server ${r.server_id} 在「${r.category_name}」分类 ${LOOKBACK_DAYS} 天内反复失败 ${r.non_success_count}/${r.session_count}`
  const description = `过去 ${LOOKBACK_DAYS} 天，server ${r.server_id}（team ${r.team_id}）在「${r.category_name}」分类累计 ${r.session_count} 条会话，其中 ${r.non_success_count} 条 failure/refuse/partial。这种"同一 server × 同一类目反复撞墙"是"用户跨 session 追问未果"的行为代理信号。`
  const rootCause = `该 server 背后的用户很可能在同一话题上反复提问而未得到可用答案。可能原因：(1) 该团队 / server 有特殊业务语义，通用 skill 覆盖不住；(2) 上游 Attribuly 数据缺失（如该 server 对应站点未接入某些维度）；(3) 前一轮回答质量不佳导致用户反复追问。`
  const action = `1. 按时间顺序抽取该 (server=${r.server_id}, category=${r.category_name}) 在 ${r.first_seen} ~ ${r.last_seen} 的全部会话，人工通读；2. 判断是同一个具体问题反复问（加 team-specific personalization / few-shot），还是该分类多种问题都不行（D-001 / D-002 / D-003 配合处理）；3. 若涉及 Attribuly 数据缺口，反馈上游；4. 上线后观察 30 天 ${r.category_name} 在该 server 的 non_success_rate 变化。`

  await db.prepare(
    `INSERT INTO int_optimization_suggestions
      (suggestion_id, type, title, description, root_cause, suggested_action,
       priority, track,
       scope_team_ids, scope_category_ids, affected_sessions,
       estimated_success_delta,
       generated_by, generator_version, source_signal,
       status, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).bind(
    suggestionId, 'failure_cluster', title, description, rootCause, action,
    'P1', 'manual',
    r.team_id, r.category_id, r.non_success_count,
    0.10,
    `system_${DETECTOR_ID}`, DETECTOR_VERSION, 'cross_session_repeat',
    dedupKey,
  ).run()

  // Evidence #1: aggregate metric snapshot
  await db.prepare(
    `INSERT INTO int_suggestion_evidence
      (suggestion_id, evidence_kind, reference_type, reference_id, snapshot_json, note)
     VALUES (?, 'metric', 'pattern', ?, ?, ?)`,
  ).bind(
    suggestionId,
    `cross-session-repeat/${r.server_id}/${r.category_id}`,
    JSON.stringify({
      server_id: r.server_id,
      team_id: r.team_id,
      category_id: r.category_id,
      session_count: r.session_count,
      non_success_count: r.non_success_count,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      lookback_days: LOOKBACK_DAYS,
    }),
    `Repetition cluster over ${LOOKBACK_DAYS}d`,
  ).run()

  // Evidence #2+: up to MAX_SAMPLES sample sessions in chronological order
  const samples = await env.DB.prepare(
    `SELECT se.session_id, se.server_id, se.success_label, se.success_conf,
            se.total_duration_ms, se.enriched_at
     FROM int_sessions_enriched se
     JOIN int_question_classifications qc
       ON qc.session_id = se.session_id AND qc.server_id = se.server_id
      AND qc.is_primary = 1
     WHERE se.server_id = ?
       AND qc.category_id = ?
       AND se.enriched_at >= datetime('now', ?)
     ORDER BY se.enriched_at ASC
     LIMIT ?`,
  ).bind(r.server_id, r.category_id, `-${LOOKBACK_DAYS} days`, MAX_SAMPLES).all<{
    session_id: string
    server_id: string
    success_label: string
    success_conf: number | null
    total_duration_ms: number | null
    enriched_at: string
  }>()

  for (const s of samples.results) {
    await env.DB.prepare(
      `INSERT INTO int_suggestion_evidence
        (suggestion_id, evidence_kind, reference_type, reference_id, snapshot_json, note)
       VALUES (?, 'session_sample', 'session', ?, ?, ?)`,
    ).bind(
      suggestionId,
      `${s.server_id}/${s.session_id}`,
      JSON.stringify(s),
      `Chronological sample (${s.success_label})`,
    ).run()
  }

  await db.prepare(
    `INSERT INTO int_suggestion_comments
      (suggestion_id, author_id, body, action, metadata_json)
     VALUES (?, 'system', ?, 'created', ?)`,
  ).bind(
    suggestionId,
    `Auto-generated by ${DETECTOR_ID} (${DETECTOR_VERSION}). ${r.non_success_count}/${r.session_count} non-success over ${LOOKBACK_DAYS}d on (server=${r.server_id}, category=${r.category_id}).`,
    JSON.stringify({
      session_count: r.session_count,
      non_success_count: r.non_success_count,
      lookback_days: LOOKBACK_DAYS,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    }),
  ).run()

  return 'created'
}

function ymd(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function randHex(): string {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
}
