import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

export default function OverviewPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
  })

  const { data: comparison } = useQuery({
    queryKey: ['team-comparison'],
    queryFn: api.teamComparison,
  })

  const { data: suggestions } = useQuery({
    queryKey: ['suggestions', 'open'],
    queryFn: () => api.suggestions({ status: 'open' }),
  })

  if (isLoading) return <div className="loading">Loading…</div>

  return (
    <>
      <h2 className="page-title">Overview</h2>
      <p className="page-subtitle">跨团队汇总指标 + 待审建议 + 最近团队健康度</p>

      <div className="metrics">
        <Metric label="Enriched Sessions" value={stats?.enriched_sessions ?? 0} />
        <Metric label="Active Teams" value={stats?.teams ?? 0} />
        <Metric label="Success Rate" value={stats?.success_rate_pct != null ? `${stats.success_rate_pct}%` : '—'} />
        <Metric label="Open Suggestions" value={suggestions?.length ?? 0} />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">Team Health Ranking</div>
          {!comparison?.length ? (
            <div className="empty">No snapshots yet</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Team</th><th>Sessions</th><th>Success</th><th>Health</th></tr>
              </thead>
              <tbody>
                {comparison.slice(0, 8).map(s => (
                  <tr key={s.team_id}>
                    <td>
                      <Link to={`/teams/${s.team_id}`} style={{ fontFamily: 'monospace' }}>
                        {s.team_id}
                      </Link>
                    </td>
                    <td>{s.session_count}</td>
                    <td>{((s.success_rate ?? 0) * 100).toFixed(0)}%</td>
                    <td><HealthBar score={s.health_score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-title">Open Optimization Suggestions</div>
          {!suggestions?.length ? (
            <div className="empty">All clear — no open suggestions</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>ID</th><th>Title</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {suggestions.slice(0, 10).map(s => (
                  <tr key={s.suggestion_id}>
                    <td><Link to={`/suggestions/${s.suggestion_id}`} style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.suggestion_id}</Link></td>
                    <td>{s.title}</td>
                    <td><span className={`badge badge-${s.priority.toLowerCase()}`}>{s.priority}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  )
}

function HealthBar({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>
  return (
    <span className="health">
      <span className="health-bar"><span className="health-bar-fill" style={{ width: `${score}%` }} /></span>
      <span className="health-score">{score}</span>
    </span>
  )
}
