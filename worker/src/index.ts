/**
 * AllyClaw Intelligence Worker — entry point.
 * API routes will be added progressively per PRD §15 phase plan.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import teamsRoutes from './routes/teams'
import sessionsEnrichedRoutes from './routes/sessions-enriched'
import analyticsRoutes from './routes/analytics'
import classificationsRoutes from './routes/classifications'
import reportsRoutes from './routes/reports'
import suggestionsRoutes from './routes/suggestions'
import teamsProfileRoutes from './routes/teams-profile'
import adminRoutes from './routes/admin'
import { enrichSessions } from './jobs/enrich-sessions'
import { classifySessions } from './jobs/classify-sessions'
import { computeDailyMetrics } from './jobs/compute-daily-metrics'
import { generateDailyReport } from './jobs/generate-daily-report'
import { discoverSuggestions } from './jobs/discover-suggestions'
import { computeTeamSnapshots } from './jobs/compute-team-snapshots'
import { trackSuggestionOutcomes } from './jobs/track-suggestion-outcomes'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return origin
    if (origin.startsWith('http://localhost:')) return origin
    if (origin.endsWith('.pages.dev')) return origin
    return null
  },
  credentials: true,
}))

app.get('/api/health', (c) => c.json({
  status: 'ok',
  service: 'allyclaw-intelligence',
  version: '0.1.0',
}))

app.route('/', teamsRoutes)
app.route('/', sessionsEnrichedRoutes)
app.route('/', analyticsRoutes)
app.route('/', classificationsRoutes)
app.route('/', reportsRoutes)
app.route('/', suggestionsRoutes)
app.route('/', teamsProfileRoutes)
app.route('/', adminRoutes)

/**
 * Scheduled job dispatcher.
 * Cron schedules are defined in wrangler.toml triggers.
 *
 *   "every 15 min"  → enrichment + classification (incremental)
 *   "hourly :07"    → daily metrics rollup
 *   "hourly :23"    → suggestion discovery
 *   "01:13 UTC"     → daily report + outcome tracking
 *   "Mon 03:47 UTC" → weekly team snapshots
 *
 * Each branch logs outcome to int_audit_log (success or error) so operators
 * can audit cron behavior without relying on Cloudflare dashboard logs.
 */
async function logAudit(
  env: Env,
  action: string,
  status: 'ok' | 'error',
  payload: unknown,
  duration_ms: number,
  error_message?: string,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO int_audit_log (actor, action, target_kind, payload_json, status, error_message, duration_ms)
       VALUES ('system', ?, 'cron', ?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(payload), status, error_message ?? null, duration_ms).run()
  } catch (e) {
    // Audit log failure must not break the cron; surface via console only.
    console.error('[audit] persist failed', e)
  }
}

async function runCron<T>(
  env: Env,
  action: string,
  job: () => Promise<T>,
): Promise<void> {
  const started = Date.now()
  try {
    const result = await job()
    const elapsed = Date.now() - started
    console.log(`[scheduled] ${action} ok`, result)
    await logAudit(env, action, 'ok', result, elapsed)
  } catch (e) {
    const elapsed = Date.now() - started
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[scheduled] ${action} error`, msg)
    await logAudit(env, action, 'error', { action }, elapsed, msg)
    throw e
  }
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron
    console.log(`[scheduled] cron="${cron}" started at ${new Date(event.scheduledTime).toISOString()}`)

    if (cron === '*/15 * * * *') {
      ctx.waitUntil(runCron(env, 'enrich+classify', async () => {
        const enrich = await enrichSessions(env, { limit: 500 })
        const classify = await classifySessions(env, { limit: 500 })
        return { enrich, classify }
      }))
    } else if (cron === '7 * * * *') {
      ctx.waitUntil(runCron(env, 'daily-metrics', () => computeDailyMetrics(env, { days: 30 })))
    } else if (cron === '23 * * * *') {
      ctx.waitUntil(runCron(env, 'discover-suggestions', () => discoverSuggestions(env)))
    } else if (cron === '13 1 * * *') {
      ctx.waitUntil(runCron(env, 'daily-batch', async () => {
        const report = await generateDailyReport(env)
        const outcomes = await trackSuggestionOutcomes(env)
        return { report, outcomes }
      }))
    } else if (cron === '47 3 * * 1') {
      ctx.waitUntil(runCron(env, 'team-snapshots', () => computeTeamSnapshots(env)))
    } else {
      console.warn(`[scheduled] unknown cron: ${cron}`)
      ctx.waitUntil(logAudit(env, 'unknown-cron', 'error', { cron }, 0, `unrecognized cron expression: ${cron}`))
    }
  },
}
