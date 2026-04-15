/**
 * Team profile / snapshot APIs (descriptive layer).
 *
 * GET  /api/teams/:id/profile          - latest weekly snapshot + trend
 * GET  /api/teams/:id/snapshots        - history of snapshots
 * GET  /api/teams/comparison           - cross-team ranking by health
 * POST /api/teams/snapshots/rebuild    - trigger snapshot computation (cur week)
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { computeTeamSnapshots } from '../jobs/compute-team-snapshots'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/teams/:id/profile', async (c) => {
  const id = c.req.param('id')

  const team = await c.env.DB.prepare(
    `SELECT * FROM int_teams WHERE team_id = ?`,
  ).bind(id).first()
  if (!team) return c.json({ error: 'team_not_found' }, 404)

  const latest = await c.env.DB.prepare(
    `SELECT * FROM int_team_snapshots
     WHERE team_id = ? AND period_type = 'week'
     ORDER BY period_start DESC LIMIT 1`,
  ).bind(id).first()

  const trend = await c.env.DB.prepare(
    `SELECT period_start, session_count, success_rate, health_score
     FROM int_team_snapshots
     WHERE team_id = ? AND period_type = 'week'
     ORDER BY period_start DESC LIMIT 8`,
  ).bind(id).all()

  const openSuggestions = await c.env.DB.prepare(
    `SELECT suggestion_id, title, priority, type
     FROM int_optimization_suggestions
     WHERE scope_team_ids = ? AND status = 'open'
     ORDER BY
       CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
     LIMIT 5`,
  ).bind(id).all()

  return c.json({
    team,
    latest_snapshot: latest,
    trend: trend.results,
    open_suggestions: openSuggestions.results,
  })
})

app.get('/api/teams/:id/snapshots', async (c) => {
  const id = c.req.param('id')
  const period = c.req.query('period') ?? 'week'
  const limit = Math.min(52, Number(c.req.query('limit') ?? 12))

  const rows = await c.env.DB.prepare(
    `SELECT * FROM int_team_snapshots
     WHERE team_id = ? AND period_type = ?
     ORDER BY period_start DESC LIMIT ?`,
  ).bind(id, period, limit).all()
  return c.json(rows.results)
})

app.get('/api/teams/comparison', async (c) => {
  const period = c.req.query('period') ?? 'week'

  // Latest snapshot per team (subquery)
  const rows = await c.env.DB.prepare(
    `SELECT s.* FROM int_team_snapshots s
     INNER JOIN (
       SELECT team_id, MAX(period_start) AS max_period
       FROM int_team_snapshots
       WHERE period_type = ?
       GROUP BY team_id
     ) latest ON latest.team_id = s.team_id AND latest.max_period = s.period_start
     WHERE s.period_type = ?
     ORDER BY s.health_score DESC NULLS LAST, s.session_count DESC`,
  ).bind(period, period).all()

  return c.json(rows.results)
})

app.post('/api/teams/snapshots/rebuild', async (c) => {
  const week = c.req.query('week') || undefined
  const result = await computeTeamSnapshots(c.env, { weekStart: week })
  return c.json({ ok: true, ...result })
})

export default app
