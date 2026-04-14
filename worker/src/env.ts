/**
 * Environment bindings.
 * All secrets configured via `wrangler secret put <name>`.
 */

export interface Env {
  DB: D1Database

  // LLM configuration
  LLM_PROVIDER?: 'claude' | 'openai'
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string

  // Feature flags
  ENABLE_AUTONOMOUS_OPTIMIZATION?: string
}
