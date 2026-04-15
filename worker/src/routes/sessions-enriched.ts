/**
 * Sessions enriched API.
 *
 * GET  /api/sessions-enriched          - list enriched sessions
 * POST /api/sessions-enriched/rebuild  - trigger enrichment (MVP: blocking)
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { enrichSessions } from '../jobs/enrich-sessions'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/sessions-enriched', async (c) => {
  const team_id = c.req.query('team_id')
  const limit = Math.min(100, Number(c.req.query('limit') ?? 20))

  let rows
  if (team_id) {
    rows = await c.env.DB.prepare(
      `SELECT * FROM int_sessions_enriched
       WHERE team_id = ?
       ORDER BY enriched_at DESC LIMIT ?`,
    ).bind(team_id, limit).all()
  } else {
    rows = await c.env.DB.prepare(
      `SELECT * FROM int_sessions_enriched ORDER BY enriched_at DESC LIMIT ?`,
    ).bind(limit).all()
  }
  return c.json(rows.results)
})

app.post('/api/sessions-enriched/rebuild', async (c) => {
  const limit = Number(c.req.query('limit') ?? 1000)
  const result = await enrichSessions(c.env, { limit })
  return c.json({ ok: true, ...result })
})

export default app
