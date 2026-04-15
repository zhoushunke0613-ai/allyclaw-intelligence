/**
 * API client for AllyClaw Intelligence Worker.
 *
 * In dev: uses Vite proxy (/api → workers.dev).
 * In prod: same-origin if served from same domain; otherwise change BASE.
 */

import type {
  Team, OverviewStats, TeamSnapshot, TeamProfile,
  Suggestion, SuggestionDetail, Report, ReportDetail,
  TaxonomyCategory,
} from '../types'

// Dev: empty (vite proxy handles /api). Prod: full Worker URL.
const BASE = import.meta.env.DEV ? '' : 'https://allyclaw-intelligence.zhoushunke0613.workers.dev'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${path}`)
  return r.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(`${r.status}: ${msg}`)
  }
  return r.json() as Promise<T>
}

export const api = {
  health: () => get<{ status: string; service: string; version: string }>('/api/health'),

  // Overview
  overview: () => get<OverviewStats>('/api/analytics/overview'),
  dailyMetrics: (days = 30) => get<unknown[]>(`/api/analytics/daily-metrics?days=${days}`),

  // Teams
  teams: () => get<Team[]>('/api/teams'),
  teamProfile: (id: string) => get<TeamProfile>(`/api/teams/${id}/profile`),
  teamComparison: () => get<TeamSnapshot[]>('/api/teams/comparison'),

  // Suggestions
  suggestions: (filters: { status?: string; priority?: string } = {}) => {
    const qs = new URLSearchParams()
    if (filters.status) qs.set('status', filters.status)
    if (filters.priority) qs.set('priority', filters.priority)
    const tail = qs.toString() ? `?${qs}` : ''
    return get<Suggestion[]>(`/api/suggestions${tail}`)
  },
  suggestionDetail: (id: string) => get<SuggestionDetail>(`/api/suggestions/${id}`),
  changeStatus: (id: string, to: string, author: string, reason?: string) =>
    post<{ ok: boolean; old_status: string; new_status: string }>(
      `/api/suggestions/${id}/status`,
      { to, author, reason },
    ),
  addComment: (id: string, author: string, body: string) =>
    post<{ ok: boolean }>(`/api/suggestions/${id}/comments`, { author, body }),

  // Reports
  reports: () => get<Report[]>('/api/reports?type=daily'),
  reportDetail: (id: string) => get<ReportDetail>(`/api/reports/${id}`),

  // Taxonomy
  categories: () => get<TaxonomyCategory[]>('/api/taxonomy/categories'),
}
