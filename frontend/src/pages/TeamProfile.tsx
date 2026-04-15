import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'

export default function TeamProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, error } = useQuery({
    queryKey: ['team', id],
    queryFn: () => api.teamProfile(id!),
    enabled: !!id,
  })

  if (isLoading) return <div className="loading">Loading…</div>
  if (error) return <div className="error">Failed to load: {String(error)}</div>
  if (!data) return null

  const snap = data.latest_snapshot
  const breakdown = snap?.health_breakdown_json ? JSON.parse(snap.health_breakdown_json) : null
  const topCats = snap?.top_categories_json ? JSON.parse(snap.top_categories_json) : []
  const topQs = snap?.top_questions_json ? JSON.parse(snap.top_questions_json) : []

  return (
    <>
      <Link to="/teams" style={{ fontSize: 11 }}>← All teams</Link>
      <h2 className="page-title" style={{ fontFamily: 'monospace', marginTop: 6 }}>
        team {data.team.team_id}
      </h2>
      <p className="page-subtitle">Tier {data.team.tier} · onboarded {new Date(data.team.onboarded_at).toLocaleDateString()}</p>

      {!snap ? (
        <div className="card"><div className="empty">No snapshots yet — wait for next weekly compute</div></div>
      ) : (
        <>
          <div className="metrics">
            <Metric label="Sessions (week)" value={snap.session_count} />
            <Metric label="Success Rate" value={`${(snap.success_rate * 100).toFixed(0)}%`} />
            <Metric label="Active Servers" value={snap.active_user_count} />
            <Metric label="Avg Messages/Session" value={snap.usage_depth.toFixed(0)} />
            <Metric label="Health Score" value={snap.health_score ?? '—'} />
          </div>

          {breakdown && (
            <div className="card">
              <div className="card-title">Health Breakdown</div>
              <BreakdownBar label="Success" v={breakdown.success} weight={0.4} />
              <BreakdownBar label="Activity" v={breakdown.activity} weight={0.3} />
              <BreakdownBar label="Classification Coverage" v={breakdown.classification_coverage} weight={0.2} />
              <BreakdownBar label="Responsiveness (placeholder)" v={breakdown.responsiveness} weight={0.1} />
            </div>
          )}

          <div className="two-col">
            <div className="card">
              <div className="card-title">Top Categories</div>
              {topCats.length === 0 ? (
                <div className="empty">No classified questions yet</div>
              ) : (
                <table className="table">
                  <tbody>
                    {topCats.map((c: { category_id: string; name: string; count: number }) => (
                      <tr key={c.category_id}>
                        <td>{c.name}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)' }}>{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="card-title">Sample Questions</div>
              {topQs.length === 0 ? (
                <div className="empty">No questions captured</div>
              ) : (
                <ul style={{ paddingLeft: 16, fontSize: 12, lineHeight: 1.7 }}>
                  {topQs.slice(0, 5).map((q: string, i: number) => (
                    <li key={i} style={{ marginBottom: 6 }}>{q.length > 120 ? q.slice(0, 120) + '…' : q}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {data.open_suggestions.length > 0 && (
            <div className="card">
              <div className="card-title">Open Suggestions for This Team</div>
              <table className="table">
                <thead>
                  <tr><th>ID</th><th>Title</th><th>Priority</th></tr>
                </thead>
                <tbody>
                  {data.open_suggestions.map(s => (
                    <tr key={s.suggestion_id}>
                      <td><Link to={`/suggestions/${s.suggestion_id}`} style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.suggestion_id}</Link></td>
                      <td>{s.title}</td>
                      <td><span className={`badge badge-${s.priority.toLowerCase()}`}>{s.priority}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
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

function BreakdownBar({ label, v, weight }: { label: string; v: number; weight: number }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
        <span>{label} <span style={{ color: 'var(--text-tertiary)' }}>· weight {weight}</span></span>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{(v * 100).toFixed(0)}</span>
      </div>
      <div style={{ height: 6, background: 'var(--surface-raised)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${v * 100}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  )
}
