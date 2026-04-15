import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

export default function TeamsPage() {
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: api.teams })
  const { data: comparison } = useQuery({ queryKey: ['team-comparison'], queryFn: api.teamComparison })

  // Index health scores by team_id
  const healthMap = new Map<string, number | null>()
  for (const c of comparison ?? []) healthMap.set(c.team_id, c.health_score)
  const sessionsMap = new Map<string, number>()
  for (const c of comparison ?? []) sessionsMap.set(c.team_id, c.session_count)

  return (
    <>
      <h2 className="page-title">Teams</h2>
      <p className="page-subtitle">{teams?.length ?? 0} 个团队 · 按健康度排行</p>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Team ID</th>
              <th>Servers</th>
              <th>Sessions (this week)</th>
              <th>Health</th>
              <th>Tier</th>
              <th>Onboarded</th>
            </tr>
          </thead>
          <tbody>
            {(teams ?? [])
              .slice()
              .sort((a, b) => (healthMap.get(b.team_id) ?? 0) - (healthMap.get(a.team_id) ?? 0))
              .map(t => (
                <tr key={t.team_id}>
                  <td>
                    <Link to={`/teams/${t.team_id}`} style={{ fontFamily: 'monospace' }}>
                      {t.team_id}
                    </Link>
                  </td>
                  <td>{t.server_count ?? '—'}</td>
                  <td>{sessionsMap.get(t.team_id) ?? 0}</td>
                  <td>
                    {healthMap.get(t.team_id) != null ? (
                      <span className="health">
                        <span className="health-bar">
                          <span className="health-bar-fill" style={{ width: `${healthMap.get(t.team_id)}%` }} />
                        </span>
                        <span className="health-score">{healthMap.get(t.team_id)}</span>
                      </span>
                    ) : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </td>
                  <td>{t.tier}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {new Date(t.onboarded_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
