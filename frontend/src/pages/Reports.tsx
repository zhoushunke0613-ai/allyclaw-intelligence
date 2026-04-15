import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

export default function ReportsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['reports'], queryFn: api.reports })

  if (isLoading) return <div className="loading">Loading…</div>

  return (
    <>
      <h2 className="page-title">Reports</h2>
      <p className="page-subtitle">每日自动生成的运营报告</p>

      <div className="card" style={{ padding: 0 }}>
        {!data?.length ? (
          <div className="empty">No reports yet</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 16 }}>Report ID</th>
                <th>Type</th>
                <th>Period</th>
                <th>Generated</th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <tr key={r.report_id}>
                  <td style={{ paddingLeft: 16, fontFamily: 'monospace', fontSize: 11 }}>
                    <Link to={`/reports/${r.report_id}`}>{r.report_id}</Link>
                  </td>
                  <td>{r.report_type}</td>
                  <td>{r.period_start.slice(0, 10)} → {r.period_end.slice(0, 10)}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {new Date(r.generated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
