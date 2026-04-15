/**
 * Reports API.
 *
 * GET  /api/reports                - list reports (filterable)
 * GET  /api/reports/:id            - fetch single report (markdown body)
 * POST /api/reports/daily/generate - generate or refresh a daily report
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { generateDailyReport } from '../jobs/generate-daily-report'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/reports', async (c) => {
  const type = c.req.query('type')
  const limit = Math.min(50, Number(c.req.query('limit') ?? 20))

  const conditions: string[] = []
  const params: unknown[] = []
  if (type) { conditions.push('report_type = ?'); params.push(type) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const rows = await c.env.DB.prepare(
    `SELECT report_id, report_type, scope, period_start, period_end,
            metadata_json, generated_at, generator_version
     FROM int_reports ${where}
     ORDER BY generated_at DESC LIMIT ?`,
  ).bind(...params, limit).all()
  return c.json(rows.results)
})

app.get('/api/reports/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(
    `SELECT * FROM int_reports WHERE report_id = ?`,
  ).bind(id).first()
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})

app.post('/api/reports/daily/generate', async (c) => {
  const date = c.req.query('date') || undefined
  const result = await generateDailyReport(c.env, { date })
  return c.json({ ok: true, ...result })
})

export default app
