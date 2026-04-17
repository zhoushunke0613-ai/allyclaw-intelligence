/**
 * OpenAI provider implementation of LLMProvider.
 * This is the only file allowed to import the OpenAI SDK directly.
 */

import OpenAI from 'openai'
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
  classifier: 'gpt-4o-mini',
  summarizer: 'gpt-4o-mini',
  suggester:  'gpt-4o',
  analyzer:   'gpt-4o',
  evaluator:  'gpt-4o-mini',
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const
  private client: OpenAI

  constructor(apiKey: string, baseURL?: string) {
    // 15s per-call timeout: Worker scheduled handlers hard-cap at 30s,
    // so a single hung LLM call cannot eat the whole budget and starve
    // the post-job audit INSERT. maxRetries cut to 1 so a 15s hang
    // can't compound into 45s via default 2-retry behavior.
    this.client = new OpenAI({ apiKey, baseURL, timeout: 15_000, maxRetries: 1 })
  }

  async complete(opts: CompleteOptions): Promise<CompleteResponse> {
    const modelId = MODEL_MAP[opts.model]
    try {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (opts.system) messages.push({ role: 'system', content: opts.system })
      for (const m of opts.messages) messages.push(m)

      const res = await this.client.chat.completions.create({
        model: modelId,
        max_tokens: opts.max_tokens ?? 1024,
        temperature: opts.temperature,
        messages,
      })
      const text = res.choices[0]?.message?.content ?? ''
      return {
        text,
        input_tokens: res.usage?.prompt_tokens ?? 0,
        output_tokens: res.usage?.completion_tokens ?? 0,
        model_id: modelId,
        provider: 'openai',
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
        'openai',
        false,
      )
    }
    return {
      results: parsed.results,
      model_id: res.model_id,
      provider: 'openai',
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
    if (err instanceof OpenAI.APIConnectionTimeoutError) {
      return new LLMError(err.message, 'timeout', 'openai', true)
    }
    if (err instanceof OpenAI.APIError) {
      const status = err.status
      let kind: LLMError['kind'] = 'unknown'
      let retryable = false
      if (status === 429) { kind = 'rate_limit'; retryable = true }
      else if (status === 401 || status === 403) { kind = 'auth'; retryable = false }
      else if (status !== undefined && status >= 500) { kind = 'timeout'; retryable = true }
      return new LLMError(err.message, kind, 'openai', retryable)
    }
    return new LLMError(String(err), 'unknown', 'openai', false)
  }
}
