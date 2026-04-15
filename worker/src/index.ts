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
import { enrichSessions } from './jobs/enrich-sessions'
import { classifySessions } from './jobs/classify-sessions'
import { computeDailyMetrics } from './jobs/compute-daily-metrics'
import { generateDailyReport } from './jobs/generate-daily-report'
import { discoverSuggestions } from './jobs/discover-suggestions'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors({
  origin: ['http://localhost:5173', 'https://allyclaw-intelligence-dashboard.pages.dev'],
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

/**
 * Scheduled job dispatcher.
 * Cron schedules are defined in wrangler.toml triggers.
 *
 *   "every 15 min"  → enrichment + classification (incremental)
 *   "hourly :07"    → daily metrics rollup
 *   "01:13 UTC"     → daily report
 *
 * Cloudflare passes the matching cron expression in event.cron, so we route
 * by exact match rather than time math.
 */
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = event.cron
    console.log(`[scheduled] cron="${cron}" started at ${new Date(event.scheduledTime).toISOString()}`)

    if (cron === '*/15 * * * *') {
      ctx.waitUntil((async () => {
        const enrich = await enrichSessions(env, { limit: 500 })
        const classify = await classifySessions(env, { limit: 500 })
        console.log('[scheduled] enrich+classify', { enrich, classify })
      })())
    } else if (cron === '7 * * * *') {
      ctx.waitUntil((async () => {
        const result = await computeDailyMetrics(env, { days: 30 })
        console.log('[scheduled] daily-metrics', result)
      })())
    } else if (cron === '23 * * * *') {
      ctx.waitUntil((async () => {
        const result = await discoverSuggestions(env)
        console.log('[scheduled] discover-suggestions', result)
      })())
    } else if (cron === '13 1 * * *') {
      ctx.waitUntil((async () => {
        const result = await generateDailyReport(env)
        console.log('[scheduled] daily-report', result)
      })())
    } else {
      console.warn(`[scheduled] unknown cron: ${cron}`)
    }
  },
}
