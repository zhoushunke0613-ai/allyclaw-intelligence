import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'

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

export default function SuggestionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [author, setAuthor] = useState('reviewer')
  const [comment, setComment] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['suggestion', id],
    queryFn: () => api.suggestionDetail(id!),
    enabled: !!id,
  })

  const statusMut = useMutation({
    mutationFn: (to: string) => api.changeStatus(id!, to, author || 'reviewer'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suggestion', id] }),
  })

  const commentMut = useMutation({
    mutationFn: () => api.addComment(id!, author || 'reviewer', comment),
    onSuccess: () => {
      setComment('')
      qc.invalidateQueries({ queryKey: ['suggestion', id] })
    },
  })

  if (isLoading) return <div className="loading">Loading…</div>
  if (!data) return null

  const allowed = TRANSITIONS[data.status] ?? []

  return (
    <>
      <Link to="/suggestions" style={{ fontSize: 11 }}>← All suggestions</Link>
      <h2 className="page-title" style={{ marginTop: 6 }}>{data.title}</h2>
      <p className="page-subtitle">
        <span style={{ fontFamily: 'monospace' }}>{data.suggestion_id}</span> ·
        <span className={`badge badge-${data.priority.toLowerCase()}`} style={{ marginLeft: 6 }}>{data.priority}</span>
        <span className={`badge badge-${data.status}`} style={{ marginLeft: 4 }}>{data.status}</span>
        <span style={{ marginLeft: 8 }}>{data.type} · {data.track}</span>
      </p>

      <div className="card">
        <div className="card-title">Description</div>
        <p style={{ marginBottom: 12 }}>{data.description ?? '_no description_'}</p>
        {data.root_cause && (
          <>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12, marginTop: 12 }}>Root cause</div>
            <p>{data.root_cause}</p>
          </>
        )}
        {data.suggested_action && (
          <>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12, marginTop: 12 }}>Suggested action</div>
            <p>{data.suggested_action}</p>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">State Transition</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Your name"
            style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }}
          />
          {allowed.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Terminal state — no transitions</span>}
          <div className="btn-row">
            {allowed.map(s => (
              <button
                key={s}
                className="btn"
                disabled={statusMut.isPending}
                onClick={() => statusMut.mutate(s)}
              >
                → {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data.evidence.length > 0 && (
        <div className="card">
          <div className="card-title">Evidence ({data.evidence.length})</div>
          {data.evidence.map(e => (
            <details key={e.evidence_id} style={{ marginBottom: 8 }}>
              <summary style={{ fontSize: 12, cursor: 'pointer' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{e.evidence_kind}</span>
                {e.note && <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>{e.note}</span>}
              </summary>
              <pre style={{ fontSize: 11, background: 'var(--surface-raised)', padding: 10, borderRadius: 6, marginTop: 6, overflow: 'auto' }}>
                {pretty(e.snapshot_json)}
              </pre>
            </details>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">Comments ({data.comments.length})</div>
        {data.comments.map(c => (
          <div key={c.comment_id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>
                {c.author_id}
                {c.action && <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.04 }}>{c.action}</span>}
              </span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                {new Date(c.created_at).toLocaleString()}
              </span>
            </div>
            <p style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{c.body}</p>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="text"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment…"
            style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }}
          />
          <button className="btn btn-primary" disabled={!comment || commentMut.isPending} onClick={() => commentMut.mutate()}>
            Post
          </button>
        </div>
      </div>
    </>
  )
}

function pretty(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}
