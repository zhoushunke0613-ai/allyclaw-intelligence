/**
 * Classification prompt — used by LLM fallback when keyword rules miss.
 * Provider-agnostic: returns plain text the adapter knows how to feed.
 */

export const CLASSIFY_PROMPT_VERSION = 'v1.0'

export const CLASSIFY_SYSTEM = `You are a precise classifier for marketing analytics chatbot questions. Respond ONLY with valid JSON in the exact schema requested.`

export function classifyUserPrompt(text: string, categories: Array<{ id: string; name: string; description?: string }>): string {
  const lines = categories.map(c => `- ${c.id}: ${c.name}${c.description ? ` — ${c.description}` : ''}`).join('\n')
  return `Classify the following question into the SINGLE BEST category from the list.

Categories:
${lines}

Question:
"""
${text}
"""

Respond with JSON only:
{"category_id": "<one id from list>", "confidence": <0.0 to 1.0>}`
}
