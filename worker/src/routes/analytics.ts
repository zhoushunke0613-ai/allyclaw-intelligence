/**
 * Analytics API.
 *
 * GET  /api/analytics/daily-metrics      - read materialized daily metrics
 * POST /api/analytics/daily-metrics/rebuild - recompute (MVP: blocking)
 * GET  /api/analytics/overview            - cross-team summary card
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { computeDailyMetrics } from '../jobs/compute-daily-metrics'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/analytics/daily-metrics', async (c) => {
  const team_id = c.req.query('team_id')
  const category = c.req.query('category') ?? '_overall'
  const days = Math.min(90, Number(c.req.query('days') ?? 30))

  const conditions: string[] = [
    `metric_date >= date('now', '-${days} days')`,
    'category_id = ?',
  ]
  const params: unknown[] = [category]
  if (team_id) {
    conditions.push('team_id = ?')
    params.push(team_id)
  }

  const rows = await c.env.DB.prepare(
    `SELECT * FROM int_daily_metrics
     WHERE ${conditions.join(' AND ')}
     ORDER BY metric_date DESC, team_id`,
  ).bind(...params).all()

  return c.json(rows.results)
})

app.post('/api/analytics/daily-metrics/rebuild', async (c) => {
  const days = Number(c.req.query('days') ?? 30)
  const result = await computeDailyMetrics(c.env, { days })
  return c.json({ ok: true, ...result })
})

app.get('/api/analytics/overview', async (c) => {
  const db = c.env.DB
  const sessions = await db.prepare('SELECT COUNT(*) AS c FROM int_sessions_enriched').first<{ c: number }>()
  const teams = await db.prepare('SELECT COUNT(*) AS c FROM int_teams').first<{ c: number }>()
  const successRate = await db.prepare(
    `SELECT
        ROUND(SUM(CASE WHEN success_label = 'success' THEN 1.0 ELSE 0.0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS rate
     FROM int_sessions_enriched`,
  ).first<{ rate: number | null }>()

  const breakdownRows = await db.prepare(
    `SELECT success_label AS label, COUNT(*) AS n
     FROM int_sessions_enriched
     GROUP BY success_label`,
  ).all<{ label: string | null; n: number }>()

  const breakdown = { success: 0, failure: 0, partial: 0, refuse: 0, unknown: 0 }
  for (const r of breakdownRows.results) {
    const key = r.label && r.label in breakdown ? (r.label as keyof typeof breakdown) : 'unknown'
    breakdown[key] += r.n
  }

  return c.json({
    enriched_sessions: sessions?.c ?? 0,
    teams: teams?.c ?? 0,
    success_rate_pct: successRate?.rate ?? null,
    success_label_breakdown: breakdown,
  })
})

export default app
