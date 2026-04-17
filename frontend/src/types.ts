// Mirror of worker D1 row shapes — kept simple and partial (only what frontend reads).

export interface Team {
  team_id: string
  team_name: string
  tier: string
  status: string
  onboarded_at: string
  server_count?: number
}

export interface SessionEnriched {
  session_id: string
  server_id: string
  team_id: string
  primary_l1?: string | null
  success_label: string
  success_conf: number
  total_duration_ms: number | null
  enriched_at: string
}

export interface DailyMetric {
  metric_date: string
  team_id: string
  category_id: string | null
  session_count: number
  success_count: number
  failure_count: number
  refuse_count: number
}

export interface OverviewStats {
  enriched_sessions: number
  teams: number
  success_rate_pct: number | null
  success_label_breakdown?: {
    success: number
    failure: number
    partial: number
    refuse: number
    unknown: number
  }
}

export interface TeamSnapshot {
  snapshot_id: number
  team_id: string
  period_type: string
  period_start: string
  period_end: string
  session_count: number
  success_rate: number
  active_user_count: number
  usage_depth: number
  top_categories_json: string
  top_questions_json: string
  health_score: number | null
  health_breakdown_json: string
  tier_change: string
}

export interface TaxonomyCategory {
  category_id: string
  level: number
  parent_id: string | null
  name: string
  description: string | null
  color: string | null
  active: number
  sort_order: number
}

export interface Suggestion {
  suggestion_id: string
  type: string
  title: string
  description: string | null
  root_cause: string | null
  suggested_action: string | null
  priority: string
  track: string
  scope_team_ids: string | null
  scope_skill_ids: string | null
  scope_category_ids: string | null
  affected_sessions: number | null
  estimated_success_delta: number | null
  generated_by: string
  generator_version: string | null
  source_signal: string | null
  status: string
  assignee: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface SuggestionEvidence {
  evidence_id: number
  suggestion_id: string
  evidence_kind: string
  reference_type: string | null
  reference_id: string | null
  snapshot_json: string
  note: string | null
  added_at: string
}

export interface SuggestionComment {
  comment_id: number
  suggestion_id: string
  author_id: string
  body: string
  action: string | null
  metadata_json: string | null
  created_at: string
}

export interface SuggestionDetail extends Suggestion {
  evidence: SuggestionEvidence[]
  comments: SuggestionComment[]
  actions: unknown[]
}

export interface Report {
  report_id: string
  report_type: string
  scope: string
  period_start: string
  period_end: string
  metadata_json: string | null
  generated_at: string
  generator_version: string | null
}

export interface ReportDetail extends Report {
  markdown: string
  html: string | null
}

export interface TeamProfile {
  team: Team
  latest_snapshot: TeamSnapshot | null
  trend: Array<{
    period_start: string
    session_count: number
    success_rate: number
    health_score: number | null
  }>
  open_suggestions: Array<{
    suggestion_id: string
    title: string
    priority: string
    type: string
  }>
}
