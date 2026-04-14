/**
 * LLM Adapter interface.
 * Business code must use this interface, never import provider SDKs directly.
 * See: .claude/rules/llm-adapter.md
 */

export type AbstractModel =
  | 'classifier'   // fast + cheap, for classification
  | 'summarizer'   // fast + cheap, for summaries
  | 'suggester'   // deep reasoning, for optimization suggestions
  | 'analyzer'    // deep reasoning, for failure analysis
  | 'evaluator'   // medium, for A/B experiment evaluation

export interface CompleteOptions {
  model: AbstractModel
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens?: number
  temperature?: number
  cache_key?: string
}

export interface CompleteResponse {
  text: string
  input_tokens: number
  output_tokens: number
  model_id: string
  provider: string
  cached: boolean
}

export interface ClassifyOptions {
  text: string
  categories: Array<{ id: string; name: string; description?: string }>
  multi_label?: boolean
}

export interface ClassifyResponse {
  results: Array<{
    category_id: string
    confidence: number
  }>
  model_id: string
  provider: string
}

export interface LLMProvider {
  readonly name: 'claude' | 'openai' | 'deepseek'
  complete(opts: CompleteOptions): Promise<CompleteResponse>
  classify(opts: ClassifyOptions): Promise<ClassifyResponse>
}

export class LLMError extends Error {
  constructor(
    message: string,
    public kind: 'rate_limit' | 'auth' | 'timeout' | 'invalid_response' | 'unknown',
    public provider: string,
    public retryable: boolean,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}
