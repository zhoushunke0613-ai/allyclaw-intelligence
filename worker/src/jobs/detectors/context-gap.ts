/**
 * Detector: context-gap (D-003).
 *
 * For each (team, category) cluster with enough recent failures/refuses,
 * ask the analyzer LLM to hypothesize what prompt-engineering / context gap
 * most plausibly caused the failures. Store as `type='context_gap'` suggestion.
 *
 * Complementary to D-001 (which only flags that a cluster is hot);
 * D-003 proposes the concrete *why* so humans have a starting hypothesis.
 *
 * Degrades gracefully without LLM credentials (returns 0 problems, no error).
 */

import type { Env } from '../../env'
import { getLLM, hasLLMCredentials } from '../../llm/factory'
import { LLMError } from '../../llm/types'
import {
  CONTEXT_GAP_SYSTEM,
  CONTEXT_GAP_PROMPT_VERSION,
  CONTEXT_GAP_TYPES,
  contextGapUserPrompt,
  type ContextGapType,
  type ContextGapSample,
} from '../../prompts/context-gap'

const DETECTOR_ID = 'D-003-context-gap'
const DETECTOR_VERSION = `v1.0+prompt=${CONTEXT_GAP_PROMPT_VERSION}`
const MIN_SAMPLES = 3
const LOOKBACK_DAYS = 14
const MAX_CLUSTERS_PER_RUN = 10
const SAMPLES_PER_CLUSTER = 3
const CONFIDENCE_THRESHOLD = 0.55

interface ClusterRow {
  team_id: string
  category_id: string
  category_name: string
  failure_count: number
}

interface DetectorResult {
  detector_id: string
  problems_found: number
  suggestions_created: number
  suggestions_skipped: number
}

export async function detectContextGap(env: Env): Promise<DetectorResult> {
  if (!hasLLMCredentials(env)) {
    // Graceful degradation — this detector is LLM-only, no fallback exists.
    return { detector_id: DETECTOR_ID, problems_found: 0, suggestions_created: 0, suggestions_skipped: 0 }
  }

  const db = env.DB

  const clusters = await db.prepare(
    `SELECT
        se.team_id,
        qc.category_id,
        c.name AS category_name,
        SUM(CASE WHEN se.success_label IN ('failure', 'refuse') THEN 1 ELSE 0 END) AS failure_count
     FROM int_sessions_enriched se
     JOIN int_question_classifications qc
       ON qc.session_id = se.session_id
      AND qc.server_id = se.server_id
      AND qc.is_primary = 1
     JOIN int_taxonomy_categories c ON c.category_id = qc.category_id
     WHERE se.enriched_at >= datetime('now', ?)
     GROUP BY se.team_id, qc.category_id
     HAVING failure_count >= ?
     ORDER BY failure_count DESC
     LIMIT ?`,
  ).bind(`-${LOOKBACK_DAYS} days`, MIN_SAMPLES, MAX_CLUSTERS_PER_RUN).all<ClusterRow>()

  let created = 0
  let skipped = 0

  for (const cluster of clusters.results) {
    try {
      const outcome = await analyzeCluster(env, cluster)
      if (outcome === 'created') created++
      else skipped++
    } catch (err) {
      skipped++
      const msg = err instanceof LLMError ? err.message : err instanceof Error ? err.message : String(err)
      console.warn(`[D-003] cluster team=${cluster.team_id} cat=${cluster.category_id} failed: ${msg}`)
    }
  }

  return {
    detector_id: DETECTOR_ID,
    problems_found: clusters.results.length,
    suggestions_created: created,
    suggestions_skipped: skipped,
  }
}

async function analyzeCluster(env: Env, cluster: ClusterRow): Promise<'created' | 'skipped'> {
  const samples = await loadSamples(env, cluster.team_id, cluster.category_id)
  if (samples.length === 0) return 'skipped'

  const llm = getLLM(env)
  const res = await llm.complete({
    model: 'analyzer',
    system: CONTEXT_GAP_SYSTEM,
    messages: [{
      role: 'user',
      content: contextGapUserPrompt({ category_name: cluster.category_name, samples }),
    }],
    max_tokens: 400,
    temperature: 0,
  })

  const diagnosis = parseDiagnosis(res.text)
  if (!diagnosis) return 'skipped'
  if (diagnosis.confidence < CONFIDENCE_THRESHOLD) return 'skipped'

  return await persistSuggestion(env, cluster, samples, diagnosis, {
    model_id: res.model_id,
    input_tokens: res.input_tokens,
    output_tokens: res.output_tokens,
  })
}

async function loadSamples(env: Env, teamId: string, categoryId: string): Promise<ContextGapSample[]> {
  const sessions = await env.DB.prepare(
    `SELECT se.session_id, se.server_id, se.success_label
     FROM int_sessions_enriched se
     JOIN int_question_classifications qc
       ON qc.session_id = se.session_id AND qc.server_id = se.server_id
      AND qc.is_primary = 1
     WHERE se.team_id = ?
       AND qc.category_id = ?
       AND se.success_label IN ('failure', 'refuse')
     ORDER BY se.enriched_at DESC
     LIMIT ?`,
  ).bind(teamId, categoryId, SAMPLES_PER_CLUSTER).all<{
    session_id: string
    server_id: string
    success_label: string
  }>()

  const samples: ContextGapSample[] = []
  for (const s of sessions.results) {
    const msgs = await env.DB.prepare(
      `SELECT role, content, timestamp
       FROM messages
       WHERE session_id = ? AND server_id = ?
       ORDER BY timestamp
       LIMIT 10`,
    ).bind(s.session_id, s.server_id).all<{ role: string; content: string }>()

    const user = firstNonNoise(msgs.results, 'user')
    const assistant = firstNonNoise(msgs.results, 'assistant')
    if (!user) continue
    samples.push({
      session_id: s.session_id,
      success_label: s.success_label,
      user_message: user,
      assistant_response: assistant ?? '(no assistant response)',
    })
  }
  return samples
}

function firstNonNoise(rows: Array<{ role: string; content: string }>, role: string): string | null {
  for (const r of rows) {
    if (r.role !== role) continue
    const cleaned = (r.content || '').replace(/```json[\s\S]*?```/g, '').trim()
    if (!cleaned) continue
    if (/HEARTBEAT/i.test(cleaned)) continue
    return cleaned
  }
  return null
}

interface Diagnosis {
  gap_type: ContextGapType
  summary: string
  suggested_fix: string
  confidence: number
}

function parseDiagnosis(raw: string): Diagnosis | null {
  const trimmed = raw.trim().replace(/^```json\s*|\s*```$/g, '')
  let obj: unknown
  try { obj = JSON.parse(trimmed) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>

  const gap = typeof o.gap_type === 'string' ? o.gap_type : ''
  if (!(CONTEXT_GAP_TYPES as readonly string[]).includes(gap)) return null

  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
  const fix = typeof o.suggested_fix === 'string' ? o.suggested_fix.trim() : ''
  const confRaw = Number(o.confidence)
  if (!summary || !fix || !Number.isFinite(confRaw)) return null

  return {
    gap_type: gap as ContextGapType,
    summary: summary.slice(0, 400),
    suggested_fix: fix.slice(0, 800),
    confidence: Math.min(Math.max(confRaw, 0), 1),
  }
}

async function persistSuggestion(
  env: Env,
  cluster: ClusterRow,
  samples: ContextGapSample[],
  diagnosis: Diagnosis,
  llmMeta: { model_id: string; input_tokens: number; output_tokens: number },
): Promise<'created' | 'skipped'> {
  const db = env.DB
  const dedupKey = `${DETECTOR_ID}:team=${cluster.team_id}:cat=${cluster.category_id}:gap=${diagnosis.gap_type}`

  const existing = await db.prepare(
    `SELECT suggestion_id FROM int_optimization_suggestions
     WHERE dedup_key = ? AND status NOT IN ('rejected', 'obsolete', 'rolled_back')`,
  ).bind(dedupKey).first()
  if (existing) return 'skipped'

  const suggestionId = `S-${ymd()}-${randHex()}`
  const title = `「${cluster.category_name}」疑似缺失 ${gapLabel(diagnosis.gap_type)}（team ${cluster.team_id}）`
  const description = `过去 ${LOOKBACK_DAYS} 天 team ${cluster.team_id} 在「${cluster.category_name}」分类累计 ${cluster.failure_count} 条 failure/refuse。LLM 诊断：${diagnosis.summary}`
  const rootCause = `Context-gap 假设（${diagnosis.gap_type}，置信度 ${diagnosis.confidence.toFixed(2)}）：${diagnosis.summary}`
  const action = diagnosis.suggested_fix

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
    suggestionId, 'context_gap', title, description, rootCause, action,
    'P2', 'manual',
    cluster.team_id, cluster.category_id, cluster.failure_count,
    0.08,
    `llm_${DETECTOR_ID}`, DETECTOR_VERSION, 'context_gap_detected',
    dedupKey,
  ).run()

  // Evidence #1: LLM diagnosis snapshot
  await db.prepare(
    `INSERT INTO int_suggestion_evidence
      (suggestion_id, evidence_kind, reference_type, reference_id, snapshot_json, note)
     VALUES (?, 'metric', 'pattern', ?, ?, ?)`,
  ).bind(
    suggestionId,
    `context-gap/${diagnosis.gap_type}`,
    JSON.stringify({
      diagnosis,
      llm: llmMeta,
      prompt_version: CONTEXT_GAP_PROMPT_VERSION,
    }),
    `LLM diagnosis: ${diagnosis.gap_type} (conf=${diagnosis.confidence.toFixed(2)})`,
  ).run()

  // Evidence #2+: sample sessions used
  for (const s of samples) {
    await db.prepare(
      `INSERT INTO int_suggestion_evidence
        (suggestion_id, evidence_kind, reference_type, reference_id, snapshot_json, note)
       VALUES (?, 'session_sample', 'session', ?, ?, ?)`,
    ).bind(
      suggestionId,
      s.session_id,
      JSON.stringify({
        success_label: s.success_label,
        user_message: s.user_message.slice(0, 400),
        assistant_response: s.assistant_response.slice(0, 400),
      }),
      `Sample for ${diagnosis.gap_type} diagnosis (${s.success_label})`,
    ).run()
  }

  // System comment
  await db.prepare(
    `INSERT INTO int_suggestion_comments
       (suggestion_id, author_id, body, action, metadata_json)
     VALUES (?, 'system', ?, 'created', ?)`,
  ).bind(
    suggestionId,
    `Auto-generated by ${DETECTOR_ID} (${DETECTOR_VERSION}). Gap type: ${diagnosis.gap_type}, confidence ${diagnosis.confidence.toFixed(2)} over ${samples.length} samples.`,
    JSON.stringify({
      gap_type: diagnosis.gap_type,
      confidence: diagnosis.confidence,
      sample_count: samples.length,
      llm_model: llmMeta.model_id,
      tokens: { input: llmMeta.input_tokens, output: llmMeta.output_tokens },
    }),
  ).run()

  return 'created'
}

function gapLabel(t: ContextGapType): string {
  switch (t) {
    case 'missing_skill_doc':     return 'skill 文档 / API schema'
    case 'missing_few_shot':      return 'few-shot 示例'
    case 'prompt_boundary':       return 'prompt 边界 / scope'
    case 'tool_rule_unclear':     return '工具调用规则'
    case 'data_schema_mismatch':  return '数据 schema 匹配'
  }
}

function ymd(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function randHex(): string {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
}
