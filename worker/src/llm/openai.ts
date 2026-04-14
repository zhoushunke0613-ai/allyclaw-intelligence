/**
 * OpenAI provider placeholder.
 * Not implemented in MVP — enable only when DECISIONS §10 conditions met.
 */

import type {
  LLMProvider,
  CompleteOptions,
  CompleteResponse,
  ClassifyOptions,
  ClassifyResponse,
} from './types'

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const

  constructor(_apiKey: string) {
    // Intentional: not implemented yet
  }

  complete(_opts: CompleteOptions): Promise<CompleteResponse> {
    throw new Error('OpenAI provider not implemented. See DECISIONS §10.')
  }

  classify(_opts: ClassifyOptions): Promise<ClassifyResponse> {
    throw new Error('OpenAI provider not implemented. See DECISIONS §10.')
  }
}
