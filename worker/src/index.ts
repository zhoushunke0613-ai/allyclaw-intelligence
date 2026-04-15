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

export default app
