/**
 * Context-gap diagnosis prompt — D-003.
 *
 * Fed with 2-3 failed/refused assistant conversations from the same
 * (team, category) cluster, asks the analyzer LLM to hypothesize what
 * prompt-engineering / context gap most plausibly caused the failures.
 *
 * Provider-agnostic text; adapter decides how to feed it.
 */

export const CONTEXT_GAP_PROMPT_VERSION = 'v1.0'

export const CONTEXT_GAP_SYSTEM =
  'You analyze failed assistant conversations to hypothesize what prompt-engineering / ' +
  'context gap most plausibly caused the failures. ' +
  'Respond ONLY with a single JSON object matching the exact schema given. ' +
  'No prose, no markdown, no code fences.'

export interface ContextGapSample {
  session_id: string
  success_label: string
  user_message: string
  assistant_response: string
}

export function contextGapUserPrompt(params: {
  category_name: string
  samples: ContextGapSample[]
}): string {
  const samples = params.samples.map((s, i) => `
--- Sample ${i + 1} (session=${s.session_id}, label=${s.success_label}) ---
USER:
${truncate(s.user_message, 1200)}

ASSISTANT:
${truncate(s.assistant_response, 1200)}
`).join('\n')

  return `Category: "${params.category_name}"

Below are ${params.samples.length} failed/refused conversations from this category.
Diagnose the MOST LIKELY single context-engineering gap responsible.

${samples}

Valid gap_type values (choose exactly one):
- missing_skill_doc       — the skill's reference doc / API schema does not cover the concept the user asked about
- missing_few_shot        — no example in the prompt shows the assistant how to handle this shape of question
- prompt_boundary         — the system prompt's scope/boundary caused the assistant to refuse or misroute
- tool_rule_unclear       — tool-use rules (when to call which tool) are ambiguous for this category
- data_schema_mismatch    — upstream data schema doesn't match what the assistant/user expects

Return JSON (nothing else):
{
  "gap_type": "<one of the five>",
  "summary": "<1 sentence, <=160 chars, describing the gap concretely>",
  "suggested_fix": "<1-2 sentences, actionable step to close the gap>",
  "confidence": <0.0 to 1.0>
}`
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max) + '… [truncated]'
}

export const CONTEXT_GAP_TYPES = [
  'missing_skill_doc',
  'missing_few_shot',
  'prompt_boundary',
  'tool_rule_unclear',
  'data_schema_mismatch',
] as const

export type ContextGapType = typeof CONTEXT_GAP_TYPES[number]
