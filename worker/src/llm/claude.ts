/**
 * Claude provider implementation of LLMProvider.
 * This is the only file allowed to import @anthropic-ai/sdk directly.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  LLMProvider,
  CompleteOptions,
  CompleteResponse,
  ClassifyOptions,
  ClassifyResponse,
  AbstractModel,
} from './types'
import { LLMError } from './types'

const MODEL_MAP: Record<AbstractModel, string> = {
  classifier: 'claude-haiku-4-5-20251001',
  summarizer: 'claude-haiku-4-5-20251001',
  suggester: 'claude-sonnet-4-6',
  analyzer: 'claude-sonnet-4-6',
  evaluator: 'claude-sonnet-4-6',
}

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude' as const
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(opts: CompleteOptions): Promise<CompleteResponse> {
    const modelId = MODEL_MAP[opts.model]
    try {
      const res = await this.client.messages.create({
        model: modelId,
        max_tokens: opts.max_tokens ?? 1024,
        temperature: opts.temperature,
        system: opts.system,
        messages: opts.messages,
      })
      const text = res.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('\n')
      return {
        text,
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        model_id: modelId,
        provider: 'claude',
        cached: false,
      }
    } catch (err) {
      throw this.wrapError(err)
    }
  }

  async classify(opts: ClassifyOptions): Promise<ClassifyResponse> {
    const prompt = this.buildClassifyPrompt(opts)
    const res = await this.complete({
      model: 'classifier',
      system: 'You are a precise classifier. Respond ONLY with valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
      temperature: 0,
    })

    let parsed: { results: Array<{ category_id: string; confidence: number }> }
    try {
      parsed = JSON.parse(res.text)
    } catch {
      throw new LLMError(
        `Invalid JSON from classifier: ${res.text.slice(0, 200)}`,
        'invalid_response',
        'claude',
        false,
      )
    }
    return {
      results: parsed.results,
      model_id: res.model_id,
      provider: 'claude',
    }
  }

  private buildClassifyPrompt(opts: ClassifyOptions): string {
    const categoryList = opts.categories
      .map(c => `- ${c.id}: ${c.name}${c.description ? ` (${c.description})` : ''}`)
      .join('\n')
    const mode = opts.multi_label ? 'all applicable' : 'single best'
    return `Classify the following text into ${mode} category/ies.

Categories:
${categoryList}

Text:
"""
${opts.text}
"""

Respond with JSON:
{"results": [{"category_id": "...", "confidence": 0.0-1.0}]}`
  }

  private wrapError(err: unknown): LLMError {
    if (err instanceof Anthropic.APIError) {
      const status = err.status
      let kind: LLMError['kind'] = 'unknown'
      let retryable = false
      if (status === 429) { kind = 'rate_limit'; retryable = true }
      else if (status === 401 || status === 403) { kind = 'auth'; retryable = false }
      else if (status >= 500) { kind = 'timeout'; retryable = true }
      return new LLMError(err.message, kind, 'claude', retryable)
    }
    return new LLMError(String(err), 'unknown', 'claude', false)
  }
}
