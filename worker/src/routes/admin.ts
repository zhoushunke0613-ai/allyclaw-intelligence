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
