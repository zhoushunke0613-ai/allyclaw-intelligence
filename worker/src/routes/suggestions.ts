/**
 * Suggestions API.
 *
 * GET    /api/suggestions                  - list (filterable)
 * GET    /api/suggestions/:id              - detail with evidence + comments
 * POST   /api/suggestions/discover         - run all detectors
 * POST   /api/suggestions/:id/status       - transition status with audit comment
 * POST   /api/suggestions/:id/comments     - add a comment
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { discoverSuggestions } from '../jobs/discover-suggestions'

const app = new Hono<{ Bindings: Env }>()

// Allowed status transitions (lightweight state machine)
const TRANSITIONS: Record<string, string[]> = {
  open:        ['in_review', 'rejected', 'obsolete'],
  in_review:   ['approved', 'rejected', 'open'],
  approved:    ['in_progress', 'rejected'],
  in_progress: ['applied', 'rolled_back', 'rejected'],
  applied:     ['rolled_back', 'obsolete'],
  rolled_back: ['open', 'obsolete'],
  rejected:    [],
  obsolete:    [],
}

app.get('/api/suggestions', async (c) => {
  const status = c.req.query('status')
  const priority = c.req.query('priority')
  const team_id = c.req.query('team_id')
  const limit = Math.min(100, Number(c.req.query('limit') ?? 50))

  const conditions: string[] = []
  const params: unknown[] = []
  if (status) { conditions.push('status = ?'); params.push(status) }
  if (priority) { conditions.push('priority = ?'); params.push(priority) }
  if (team_id) { conditions.push('scope_team_ids = ?'); params.push(team_id) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const rows = await c.env.DB.prepare(
    `SELECT * FROM int_optimization_suggestions ${where}
     ORDER BY
       CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT ?`,
  ).bind(...params, limit).all()

  return c.json(rows.results)
})

app.get('/api/suggestions/:id', async (c) => {
  const id = c.req.param('id')

  const suggestion = await c.env.DB.prepare(
    `SELECT * FROM int_optimization_suggestions WHERE suggestion_id = ?`,
  ).bind(id).first()
  if (!suggestion) return c.json({ error: 'not_found' }, 404)

  const evidence = await c.env.DB.prepare(
    `SELECT * FROM int_suggestion_evidence WHERE suggestion_id = ? ORDER BY added_at`,
  ).bind(id).all()

  const comments = await c.env.DB.prepare(
    `SELECT * FROM int_suggestion_comments WHERE suggestion_id = ? ORDER BY created_at`,
  ).bind(id).all()

  const actions = await c.env.DB.prepare(
    `SELECT * FROM int_optimization_actions WHERE suggestion_id = ? ORDER BY applied_at`,
  ).bind(id).all()

  return c.json({
    ...suggestion,
    evidence: evidence.results,
    comments: comments.results,
    actions: actions.results,
  })
})

app.post('/api/suggestions/discover', async (c) => {
  const result = await discoverSuggestions(c.env)
  return c.json({ ok: true, ...result })
})

app.post('/api/suggestions/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ to: string; author?: string; reason?: string }>()
  const newStatus = body.to
  const author = body.author ?? 'unknown'

  const current = await c.env.DB.prepare(
    `SELECT status FROM int_optimization_suggestions WHERE suggestion_id = ?`,
  ).bind(id).first<{ status: string }>()
  if (!current) return c.json({ error: 'not_found' }, 404)

  const allowed = TRANSITIONS[current.status] ?? []
  if (!allowed.includes(newStatus)) {
    return c.json({
      error: 'invalid_transition',
      message: `Cannot transition from ${current.status} to ${newStatus}`,
      allowed,
    }, 400)
  }

  const now = new Date().toISOString()
  const isResolved = newStatus === 'rejected' || newStatus === 'obsolete' || newStatus === 'applied'

  await c.env.DB.prepare(
    `UPDATE int_optimization_suggestions
     SET status = ?, updated_at = ?, resolved_at = CASE WHEN ? THEN ? ELSE resolved_at END
     WHERE suggestion_id = ?`,
  ).bind(newStatus, now, isResolved ? 1 : 0, now, id).run()

  await c.env.DB.prepare(
    `INSERT INTO int_suggestion_comments
       (suggestion_id, author_id, body, action, metadata_json)
     VALUES (?, ?, ?, 'status_change', ?)`,
  ).bind(
    id, author,
    body.reason ?? `Status changed: ${current.status} → ${newStatus}`,
    JSON.stringify({ old_status: current.status, new_status: newStatus }),
  ).run()

  return c.json({ ok: true, suggestion_id: id, old_status: current.status, new_status: newStatus })
})

app.post('/api/suggestions/:id/comments', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ author: string; body: string }>()

  const suggestion = await c.env.DB.prepare(
    `SELECT 1 FROM int_optimization_suggestions WHERE suggestion_id = ?`,
  ).bind(id).first()
  if (!suggestion) return c.json({ error: 'not_found' }, 404)

  await c.env.DB.prepare(
    `INSERT INTO int_suggestion_comments (suggestion_id, author_id, body, action)
     VALUES (?, ?, ?, 'comment')`,
  ).bind(id, body.author, body.body).run()

  return c.json({ ok: true })
})

export default app
