/**
 * Teams API.
 *
 * GET  /api/teams           - list all teams with stats
 * POST /api/teams/sync      - discover teams from servers and upsert into int_teams
 */

import { Hono } from 'hono'
import type { Env } from '../env'
import { extractTeam } from '../utils/team'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/teams', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.*,
        (SELECT COUNT(*) FROM int_server_team_map m WHERE m.team_id = t.team_id AND m.unmapped_at IS NULL) AS server_count
     FROM int_teams t
     ORDER BY t.team_id`,
  ).all()
  return c.json(rows.results)
})

app.post('/api/teams/sync', async (c) => {
  const db = c.env.DB
  const now = new Date().toISOString()

  const servers = await db.prepare(
    'SELECT id, ip, first_seen FROM servers',
  ).all<{ id: string; ip: string; first_seen: string }>()

  let teamsUpserted = 0
  let mappingsUpserted = 0

  for (const server of servers.results) {
    const { team_id } = extractTeam(server.id)

    // Upsert team (use server.first_seen as onboarded_at if new)
    const teamResult = await db.prepare(
      `INSERT INTO int_teams (team_id, team_name, onboarded_at)
       VALUES (?, ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).bind(team_id, team_id, server.first_seen ?? now).run()
    if (teamResult.meta.changes > 0) teamsUpserted++

    // Upsert server-team mapping
    const mapResult = await db.prepare(
      `INSERT INTO int_server_team_map (server_id, team_id)
       VALUES (?, ?)
       ON CONFLICT(server_id) DO UPDATE SET team_id = excluded.team_id`,
    ).bind(server.id, team_id).run()
    if (mapResult.meta.changes > 0) mappingsUpserted++
  }

  return c.json({
    ok: true,
    servers_scanned: servers.results.length,
    teams_upserted: teamsUpserted,
    mappings_upserted: mappingsUpserted,
  })
})

export default app
