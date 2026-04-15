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
  // 指向本地 codex-proxy 的 cloudflared tunnel URL，形如 https://xxx.trycloudflare.com/v1
  // 未配置时走官方 OpenAI。配置后所有 OpenAI 调用走这个代理（ChatGPT Plus OAuth）。
  OPENAI_BASE_URL?: string

  // Feature flags
  ENABLE_AUTONOMOUS_OPTIMIZATION?: string

  // Admin endpoints gate (manual cron triggers, ops debugging)
  ADMIN_TOKEN?: string
}
