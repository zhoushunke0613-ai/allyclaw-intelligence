/**
 * Rule-based session classifier (MVP).
 *
 * Reads first user message of each session, applies keyword rules from
 * int_taxonomy_rules, writes results to int_question_classifications.
 *
 * Idempotent: re-running on a session re-applies current rules (existing
 * rows for that session are removed first).
 *
 * LLM fallback for uncovered sessions is intentionally deferred — see
 * docs/PRD.md §16.8 (M1 baseline does rule + LLM, M3 onwards adds Sonnet).
 */

import type { Env } from '../env'

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

const METHOD = 'rule'
const VERSION = 'v1.0-keyword'

export async function classifySessions(env: Env, opts: { limit?: number } = {}): Promise<{
  sessions_processed: number
  sessions_classified: number
  sessions_uncovered: number
}> {
  const db = env.DB
  const limit = opts.limit ?? 1000

  const rules = await loadActiveRules(env)
  if (rules.length === 0) {
    return { sessions_processed: 0, sessions_classified: 0, sessions_uncovered: 0 }
  }

  const sessions = await db.prepare(
    `SELECT session_id, server_id, team_id
     FROM int_sessions_enriched
     ORDER BY enriched_at DESC LIMIT ?`,
  ).bind(limit).all<Session>()

  let classified = 0
  let uncovered = 0

  for (const s of sessions.results) {
    const text = await getFirstUserMessage(env, s.session_id, s.server_id)
    if (!text) { uncovered++; continue }

    const matches = matchRules(text, rules)
    if (matches.length === 0) { uncovered++; continue }

    // Remove previous classifications for this session before inserting fresh
    await db.prepare(
      `DELETE FROM int_question_classifications
       WHERE session_id = ? AND server_id = ? AND method = ?`,
    ).bind(s.session_id, s.server_id, METHOD).run()

    // Top match becomes primary; others are multi-label tags
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]
      await db.prepare(
        `INSERT INTO int_question_classifications
          (session_id, server_id, team_id, category_id,
           is_primary, confidence, method, rule_id, model_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        s.session_id, s.server_id, s.team_id, m.category_id,
        i === 0 ? 1 : 0, m.confidence, METHOD, m.rule_id, VERSION,
      ).run()
    }

    classified++
  }

  return {
    sessions_processed: sessions.results.length,
    sessions_classified: classified,
    sessions_uncovered: uncovered,
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
