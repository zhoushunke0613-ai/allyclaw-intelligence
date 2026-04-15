import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

const STATUSES = ['', 'open', 'in_review', 'approved', 'in_progress', 'applied', 'rejected', 'obsolete'] as const
const PRIORITIES = ['', 'P0', 'P1', 'P2', 'P3'] as const

export default function SuggestionsPage() {
  const [status, setStatus] = useState<string>('open')
  const [priority, setPriority] = useState<string>('')
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['suggestions', status, priority],
    queryFn: () => api.suggestions({ status: status || undefined, priority: priority || undefined }),
  })

  const discoverMut = useMutation({
    mutationFn: () => fetch('/api/suggestions/discover', { method: 'POST' }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suggestions'] }),
  })

  return (
    <>
      <h2 className="page-title">Suggestions Workbench</h2>
      <p className="page-subtitle">系统自动发现 + 人工审核优化建议</p>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.04, fontWeight: 600 }}>Status</span>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
            {STATUSES.map(s => <option key={s} value={s}>{s || '(all)'}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.04, fontWeight: 600 }}>Priority</span>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={selectStyle}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p || '(all)'}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={() => discoverMut.mutate()} disabled={discoverMut.isPending}>
            {discoverMut.isPending ? 'Running…' : 'Run detectors'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="loading">Loading…</div>
      ) : !data?.length ? (
        <div className="card"><div className="empty">No suggestions match this filter</div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 16 }}>ID</th>
                <th>Title</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Track</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map(s => (
                <tr key={s.suggestion_id}>
                  <td style={{ paddingLeft: 16, fontFamily: 'monospace', fontSize: 11 }}>
                    <Link to={`/suggestions/${s.suggestion_id}`}>{s.suggestion_id}</Link>
                  </td>
                  <td>{s.title}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{s.type}</td>
                  <td><span className={`badge badge-${s.priority.toLowerCase()}`}>{s.priority}</span></td>
                  <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                  <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{s.track}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontSize: 12,
  fontFamily: 'inherit',
  color: 'var(--text)',
}
