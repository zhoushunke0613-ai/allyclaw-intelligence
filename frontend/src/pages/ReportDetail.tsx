import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading } = useQuery({
    queryKey: ['report', id],
    queryFn: () => api.reportDetail(id!),
    enabled: !!id,
  })

  if (isLoading) return <div className="loading">Loading…</div>
  if (!data) return null

  return (
    <>
      <Link to="/reports" style={{ fontSize: 11 }}>← All reports</Link>
      <div className="card" style={{ marginTop: 8 }}>
        <div className="md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.markdown) }} />
      </div>
    </>
  )
}

/**
 * Tiny Markdown renderer — covers what our daily report uses
 * (h1, h2, table, code, blockquote, lists, paragraphs).
 */
function renderMarkdown(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = md.split('\n')
  const out: string[] = []
  let inTable = false
  let tableRows: string[][] = []
  let inBlockquote = false
  let listType: 'ol' | 'ul' | null = null
  let paragraph: string[] = []

  function flushParagraph() {
    if (paragraph.length) {
      const text = paragraph.join(' ')
      out.push(`<p>${formatInline(text)}</p>`)
      paragraph = []
    }
  }
  function flushTable() {
    if (!tableRows.length) return
    const [header, _sep, ...body] = tableRows
    out.push('<table>')
    if (header) {
      out.push('<thead><tr>')
      header.forEach(c => out.push(`<th>${formatInline(c)}</th>`))
      out.push('</tr></thead>')
    }
    out.push('<tbody>')
    body.forEach(row => {
      out.push('<tr>')
      row.forEach(c => out.push(`<td>${formatInline(c)}</td>`))
      out.push('</tr>')
    })
    out.push('</tbody></table>')
    tableRows = []
    inTable = false
  }
  function flushList() {
    if (listType) { out.push(`</${listType}>`); listType = null }
  }

  function formatInline(s: string): string {
    return escape(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  }

  for (const raw of lines) {
    const line = raw

    if (line.startsWith('|') && line.includes('|', 1)) {
      flushParagraph(); flushList()
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      tableRows.push(cells)
      inTable = true
      continue
    } else if (inTable) {
      flushTable()
    }

    if (line.startsWith('# ')) {
      flushParagraph(); flushList()
      out.push(`<h1>${formatInline(line.slice(2))}</h1>`)
    } else if (line.startsWith('## ')) {
      flushParagraph(); flushList()
      out.push(`<h2>${formatInline(line.slice(3))}</h2>`)
    } else if (line.startsWith('> ')) {
      flushParagraph(); flushList()
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true }
      out.push(`<p>${formatInline(line.slice(2))}</p>`)
    } else if (line === '') {
      flushParagraph()
      if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false }
    } else if (/^\d+\.\s/.test(line)) {
      flushParagraph()
      if (listType !== 'ol') { flushList(); out.push('<ol>'); listType = 'ol' }
      out.push(`<li>${formatInline(line.replace(/^\d+\.\s/, ''))}</li>`)
    } else if (/^[-*]\s/.test(line)) {
      flushParagraph()
      if (listType !== 'ul') { flushList(); out.push('<ul>'); listType = 'ul' }
      out.push(`<li>${formatInline(line.replace(/^[-*]\s/, ''))}</li>`)
    } else {
      if (listType) { flushList() }
      paragraph.push(line)
    }
  }
  flushTable(); flushParagraph(); flushList()
  if (inBlockquote) out.push('</blockquote>')

  return out.join('\n')
}
