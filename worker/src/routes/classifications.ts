/**
 * Classification API.
 *
 * GET  /api/taxonomy/categories       - list active L1/L2 categories
 * GET  /api/classifications           - list classified sessions (filterable)
 * POST /api/classifications/rebuild   - run rule classifier
 * GET  /api/classifications/coverage  - coverage stats per category
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { classifySessions } from '../jobs/classify-sessions'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/taxonomy/categories', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM int_taxonomy_categories WHERE active = 1 ORDER BY level, sort_order`,
  ).all()
  return c.json(rows.results)
})

app.get('/api/classifications', async (c) => {
  const team_id = c.req.query('team_id')
  const category_id = c.req.query('category_id')
  const limit = Math.min(200, Number(c.req.query('limit') ?? 50))

  const conditions: string[] = ['is_primary = 1']
  const params: unknown[] = []
  if (team_id) { conditions.push('team_id = ?'); params.push(team_id) }
  if (category_id) { conditions.push('category_id = ?'); params.push(category_id) }

  const rows = await c.env.DB.prepare(
    `SELECT qc.*, c.name AS category_name
     FROM int_question_classifications qc
     JOIN int_taxonomy_categories c ON c.category_id = qc.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY classified_at DESC LIMIT ?`,
  ).bind(...params, limit).all()
  return c.json(rows.results)
})

app.post('/api/classifications/rebuild', async (c) => {
  const limit = Number(c.req.query('limit') ?? 1000)
  const result = await classifySessions(c.env, { limit })
  return c.json({ ok: true, ...result })
})

app.get('/api/classifications/coverage', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT
        c.category_id, c.name,
        COUNT(qc.classification_id) AS classified_count
     FROM int_taxonomy_categories c
     LEFT JOIN int_question_classifications qc
       ON qc.category_id = c.category_id AND qc.is_primary = 1
     WHERE c.active = 1 AND c.level = 1
     GROUP BY c.category_id
     ORDER BY classified_count DESC`,
  ).all()
  return c.json(rows.results)
})

export default app
