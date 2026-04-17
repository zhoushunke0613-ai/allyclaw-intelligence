/**
 * Admin routes — manual trigger endpoints for scheduled jobs.
 *
 * Gated by X-Admin-Token header matching env.ADMIN_TOKEN. If the secret
 * isn't configured the whole namespace returns 503 so we never expose
 * these routes unintentionally.
 *
 * Curl usage:
 *   curl -X POST \
 *        -H "X-Admin-Token: $TOKEN" \
 *        https://<worker>/api/admin/trigger/classify?limit=200
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { enrichSessions } from '../jobs/enrich-sessions'
import { classifySessions } from '../jobs/classify-sessions'
import { computeDailyMetrics } from '../jobs/compute-daily-metrics'
import { discoverSuggestions } from '../jobs/discover-suggestions'
import { computeTeamSnapshots } from '../jobs/compute-team-snapshots'
import { generateDailyReport } from '../jobs/generate-daily-report'
import { trackSuggestionOutcomes } from '../jobs/track-suggestion-outcomes'
import { getLLM } from '../llm/factory'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/admin/*', async (c, next) => {
  if (!c.env.ADMIN_TOKEN) {
    return c.json({ error: { code: 'admin_disabled', message: 'ADMIN_TOKEN not configured' } }, 503)
  }
  const token = c.req.header('X-Admin-Token')
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: { code: 'unauthorized', message: 'invalid admin token' } }, 401)
  }
  await next()
})

/**
 * GET /api/admin/usage?days=7
 *
 * Aggregates LLM token usage from what the Worker has captured so far.
 * Sources: int_audit_log (llm-probe payloads) + int_suggestion_evidence
 * (D-003 context-gap diagnoses embed { llm: { model_id, input/output_tokens } }
 * inside snapshot_json).
 *
 * Known gap: classifier LLM fallback is not individually logged yet.
 * Non-Worker ChatGPT usage (Web / App / Codex CLI direct) is invisible to
 * us — those bypass the proxy entirely.
 */
app.get('/api/admin/usage', async (c) => {
  const days = Math.max(1, Math.min(90, Number(c.req.query('days') ?? 7)))
  const since = `-${days} days`

  const probes = await c.env.DB.prepare(
    `SELECT created_at, payload_json
     FROM int_audit_log
     WHERE action = 'trigger.llm-probe' AND status = 'ok'
       AND created_at >= datetime('now', ?)`,
  ).bind(since).all<{ created_at: string; payload_json: string }>()

  const evidences = await c.env.DB.prepare(
    `SELECT added_at AS created_at, snapshot_json
     FROM int_suggestion_evidence
     WHERE evidence_kind = 'metric'
       AND reference_type = 'pattern'
       AND reference_id LIKE 'context-gap/%'
       AND added_at >= datetime('now', ?)`,
  ).bind(since).all<{ created_at: string; snapshot_json: string }>()

  interface Bucket { calls: number; input_tokens: number; output_tokens: number }
  const mkBucket = (): Bucket => ({ calls: 0, input_tokens: 0, output_tokens: 0 })
  const total = mkBucket()
  const bySource: Record<string, Bucket> = {}
  const byModel: Record<string, Bucket> = {}
  const byDay: Record<string, Bucket> = {}

  function add(b: Bucket, input: number, output: number): void {
    b.calls += 1
    b.input_tokens += input
    b.output_tokens += output
  }

  function consume(createdAt: string, source: string, model: string, input: number, output: number): void {
    const day = createdAt.slice(0, 10)
    add(total, input, output)
    add((bySource[source] ??= mkBucket()), input, output)
    add((byModel[model] ??= mkBucket()), input, output)
    add((byDay[day] ??= mkBucket()), input, output)
  }

  for (const p of probes.results) {
    try {
      const rec = JSON.parse(p.payload_json) as { input_tokens?: number; output_tokens?: number; model_id?: string }
      consume(p.created_at, 'llm_probe', rec.model_id ?? 'unknown', Number(rec.input_tokens ?? 0), Number(rec.output_tokens ?? 0))
    } catch { /* skip malformed */ }
  }
  for (const e of evidences.results) {
    try {
      const snap = JSON.parse(e.snapshot_json) as { llm?: { model_id?: string; input_tokens?: number; output_tokens?: number } }
      if (snap.llm) {
        consume(e.created_at, 'd003_context_gap', snap.llm.model_id ?? 'unknown', Number(snap.llm.input_tokens ?? 0), Number(snap.llm.output_tokens ?? 0))
      }
    } catch { /* skip malformed */ }
  }

  const fmt = (b: Bucket): Bucket & { total_tokens: number } => ({ ...b, total_tokens: b.input_tokens + b.output_tokens })
  const mapEntries = (r: Record<string, Bucket>): Record<string, ReturnType<typeof fmt>> =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fmt(v)]))

  return c.json({
    range: { days, since_expr: since },
    total: fmt(total),
    by_source: mapEntries(bySource),
    by_model: mapEntries(byModel),
    by_day: Object.entries(byDay)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, v]) => ({ date, ...fmt(v) })),
    caveats: [
      'Tracks only LLM calls captured by Worker-side bookkeeping.',
      'Classifier LLM fallback is not yet individually logged — numbers may be under-reported.',
      'Non-Worker ChatGPT usage (Web / mobile / Codex CLI directly) is NOT visible here.',
    ],
  })
})

app.post('/api/admin/trigger/:job', async (c) => {
  const job = c.req.param('job')
  const limit = Number(c.req.query('limit')) || 500
  const started = Date.now()

  try {
    let result: unknown
    switch (job) {
      case 'enrich':
        result = await enrichSessions(c.env, { limit })
        break
      case 'classify':
        result = await classifySessions(c.env, { limit })
        break
      case 'daily-metrics':
        result = await computeDailyMetrics(c.env, { days: 30 })
        break
      case 'discover':
        result = await discoverSuggestions(c.env)
        break
      case 'snapshots':
        result = await computeTeamSnapshots(c.env)
        break
      case 'report':
        result = await generateDailyReport(c.env)
        break
      case 'outcomes':
        result = await trackSuggestionOutcomes(c.env)
        break
      case 'llm-probe': {
        const llm = getLLM(c.env)
        const probe = await llm.complete({
          model: 'classifier',
          system: 'You are a test probe. Respond with the exact JSON requested.',
          messages: [{ role: 'user', content: 'Respond with exactly: {"status":"ok","greeting":"hello"}' }],
          max_tokens: 40,
          temperature: 0,
        })
        result = probe
        break
      }
      default:
        return c.json({ error: { code: 'unknown_job', message: `unknown job: ${job}` } }, 400)
    }

    const duration_ms = Date.now() - started

    // Mirror cron behavior: persist to audit_log
    try {
      await c.env.DB.prepare(
        `INSERT INTO int_audit_log (actor, action, target_kind, payload_json, status, duration_ms)
         VALUES ('admin', ?, 'manual-trigger', ?, 'ok', ?)`,
      ).bind(`trigger.${job}`, JSON.stringify(result), duration_ms).run()
    } catch (logErr) {
      console.error('[admin] audit persist failed', logErr)
    }

    return c.json({ job, result, duration_ms })
  } catch (err) {
    const duration_ms = Date.now() - started
    const msg = err instanceof Error ? err.message : String(err)

    try {
      await c.env.DB.prepare(
        `INSERT INTO int_audit_log (actor, action, target_kind, payload_json, status, error_message, duration_ms)
         VALUES ('admin', ?, 'manual-trigger', ?, 'error', ?, ?)`,
      ).bind(`trigger.${job}`, JSON.stringify({ job }), msg, duration_ms).run()
    } catch (logErr) {
      console.error('[admin] audit persist failed', logErr)
    }

    return c.json({ error: { code: 'job_failed', message: msg }, duration_ms }, 500)
  }
})

export default app
