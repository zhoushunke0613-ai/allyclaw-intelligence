/**
 * Two-stage session classifier.
 *
 * Stage 1: keyword rules (cheap, deterministic) — covers most cases.
 * Stage 2: LLM (Haiku) for sessions uncovered by rules — only runs when
 *   ANTHROPIC_API_KEY is configured. Without the key, uncovered sessions
 *   stay uncovered (system degrades gracefully, doesn't fail).
 */

import type { Env } from '../env'
import { getLLM, hasLLMCredentials } from '../llm/factory'
import { LLMError } from '../llm/types'
import { CLASSIFY_SYSTEM, classifyUserPrompt, CLASSIFY_PROMPT_VERSION } from '../prompts/classify'

interface Rule {
  rule_id: string
  category_id: string
  rule_content: string
  priority: number
}

interface Session {
  session_id: string
  server_id: string
  team_id: string
}

interface Category {
  category_id: string
  name: string
  description: string | null
}

const METHOD_RULE = 'rule'
const METHOD_LLM = 'llm'
const VERSION = 'v1.0-keyword'

export async function classifySessions(env: Env, opts: { limit?: number; useLLMFallback?: boolean } = {}): Promise<{
  sessions_processed: number
  classified_by_rule: number
  classified_by_llm: number
  sessions_uncovered: number
  llm_attempted: boolean
  llm_errors: number
}> {
  const db = env.DB
  const limit = opts.limit ?? 1000
  const useLLMFallback = opts.useLLMFallback ?? hasLLMCredentials(env)

  const [rules, categories] = await Promise.all([
    loadActiveRules(env),
    loadCategories(env),
  ])
  if (rules.length === 0) {
    return {
      sessions_processed: 0, classified_by_rule: 0, classified_by_llm: 0,
      sessions_uncovered: 0, llm_attempted: false, llm_errors: 0,
    }
  }

  const sessions = await db.prepare(
    `SELECT session_id, server_id, team_id
     FROM int_sessions_enriched
     ORDER BY enriched_at DESC LIMIT ?`,
  ).bind(limit).all<Session>()

  let byRule = 0
  let byLLM = 0
  let uncovered = 0
  let llmErrors = 0

  for (const s of sessions.results) {
    const text = await getFirstUserMessage(env, s.session_id, s.server_id)
    if (!text) { uncovered++; continue }

    const matches = matchRules(text, rules)

    if (matches.length > 0) {
      await replaceClassifications(env, s, matches.map(m => ({
        category_id: m.category_id,
        confidence: m.confidence,
        rule_id: m.rule_id,
        method: METHOD_RULE,
        model_version: VERSION,
      })))
      byRule++
      continue
    }

    if (!useLLMFallback) { uncovered++; continue }

    try {
      const llmResult = await classifyWithLLM(env, text, categories)
      if (!llmResult) { uncovered++; continue }
      await replaceClassifications(env, s, [{
        category_id: llmResult.category_id,
        confidence: llmResult.confidence,
        rule_id: null,
        method: METHOD_LLM,
        model_version: CLASSIFY_PROMPT_VERSION,
      }])
      byLLM++
    } catch (err) {
      llmErrors++
      uncovered++
      const msg = err instanceof LLMError ? err.message : String(err)
      console.warn(`[classify] LLM fallback failed for ${s.session_id}: ${msg}`)
    }
  }

  return {
    sessions_processed: sessions.results.length,
    classified_by_rule: byRule,
    classified_by_llm: byLLM,
    sessions_uncovered: uncovered,
    llm_attempted: useLLMFallback,
    llm_errors: llmErrors,
  }
}

async function loadCategories(env: Env): Promise<Category[]> {
  const rows = await env.DB.prepare(
    `SELECT category_id, name, description
     FROM int_taxonomy_categories
     WHERE active = 1 AND level = 1
     ORDER BY sort_order`,
  ).all<Category>()
  return rows.results
}

async function classifyWithLLM(env: Env, text: string, categories: Category[]): Promise<{ category_id: string; confidence: number } | null> {
  const llm = getLLM(env)
  const valid = new Set(categories.map(c => c.category_id))

  const res = await llm.complete({
    model: 'classifier',
    system: CLASSIFY_SYSTEM,
    messages: [{
      role: 'user',
      content: classifyUserPrompt(text, categories.map(c => ({
        id: c.category_id,
        name: c.name,
        description: c.description ?? undefined,
      }))),
    }],
    max_tokens: 100,
    temperature: 0,
  })

  let parsed: { category_id: string; confidence: number }
  try {
    parsed = JSON.parse(res.text.trim())
  } catch {
    return null
  }

  if (!valid.has(parsed.category_id)) return null
  const conf = Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1)
  return { category_id: parsed.category_id, confidence: conf }
}

interface ClassificationInsert {
  category_id: string
  confidence: number
  rule_id: string | null
  method: string
  model_version: string
}

async function replaceClassifications(env: Env, s: Session, items: ClassificationInsert[]): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM int_question_classifications
     WHERE session_id = ? AND server_id = ?`,
  ).bind(s.session_id, s.server_id).run()

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    await env.DB.prepare(
      `INSERT INTO int_question_classifications
        (session_id, server_id, team_id, category_id,
         is_primary, confidence, method, rule_id, model_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      s.session_id, s.server_id, s.team_id, it.category_id,
      i === 0 ? 1 : 0, it.confidence, it.method, it.rule_id, it.model_version,
    ).run()
  }
}

async function loadActiveRules(env: Env): Promise<Rule[]> {
  const rows = await env.DB.prepare(
    `SELECT rule_id, category_id, rule_content, priority
     FROM int_taxonomy_rules
     WHERE active = 1 AND rule_type = 'keyword'
     ORDER BY priority DESC`,
  ).all<Rule>()
  return rows.results
}

async function getFirstUserMessage(env: Env, session_id: string, server_id: string): Promise<string | null> {
  // Pull a few user messages and prefer the longest non-noise one as classification anchor
  const rows = await env.DB.prepare(
    `SELECT content FROM messages
     WHERE session_id = ? AND server_id = ? AND role = 'user'
     ORDER BY timestamp LIMIT 5`,
  ).bind(session_id, server_id).all<{ content: string }>()

  let best = ''
  for (const r of rows.results) {
    const cleaned = (r.content || '').replace(/```json[\s\S]*?```/g, '').trim()
    if (/HEARTBEAT/i.test(cleaned)) continue
    if (cleaned.length > best.length) best = cleaned
    if (best.length > 30) break
  }
  return best || null
}

interface Match {
  category_id: string
  rule_id: string
  confidence: number
  hit_count: number
}

function matchRules(text: string, rules: Rule[]): Match[] {
  const lower = text.toLowerCase()
  const matches: Match[] = []

  for (const rule of rules) {
    const keywords = rule.rule_content.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    let hits = 0
    for (const k of keywords) {
      if (lower.includes(k)) hits++
    }
    if (hits > 0) {
      matches.push({
        category_id: rule.category_id,
        rule_id: rule.rule_id,
        confidence: Math.min(0.5 + hits * 0.15, 0.95),
        hit_count: hits,
      })
    }
  }

  matches.sort((a, b) => b.hit_count - a.hit_count || b.confidence - a.confidence)
  return matches
}
