/**
 * LLM factory — the ONLY way business code should get an LLMProvider instance.
 * See: .claude/rules/llm-adapter.md
 */

import type { LLMProvider } from './types'
import { ClaudeProvider } from './claude'
import { OpenAIProvider } from './openai'
import type { Env } from '../env'

export function getLLM(env: Env): LLMProvider {
  const provider = env.LLM_PROVIDER ?? 'claude'

  switch (provider) {
    case 'claude':
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is required for Claude provider')
      }
      return new ClaudeProvider(env.ANTHROPIC_API_KEY)

    case 'openai':
      if (!env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required for OpenAI provider')
      }
      return new OpenAIProvider(env.OPENAI_API_KEY)

    default:
      throw new Error(`Unknown LLM provider: ${provider}`)
  }
}
