/**
 * Detector orchestrator.
 *
 * Runs all registered detectors and aggregates results.
 * New detectors: import + add to DETECTORS array.
 */

import type { Env } from '../env'
import { detectHighFailureCategory } from './detectors/high-failure-category'
import { detectCategoryCoverageGap } from './detectors/category-coverage-gap'
import { detectContextGap } from './detectors/context-gap'
import { detectCrossSessionRepeat } from './detectors/cross-session-repeat'

const DETECTORS = [
  { id: 'D-001-high-failure-category', run: detectHighFailureCategory },
  { id: 'D-002-category-coverage-gap', run: detectCategoryCoverageGap },
  { id: 'D-003-context-gap', run: detectContextGap },
  { id: 'D-004-cross-session-repeat', run: detectCrossSessionRepeat },
]

export interface DetectorRunSummary {
  detector_id: string
  problems_found: number
  suggestions_created: number
  suggestions_skipped: number
  error?: string
}

export async function discoverSuggestions(env: Env): Promise<{
  detectors_run: number
  results: DetectorRunSummary[]
}> {
  const results: DetectorRunSummary[] = []
  for (const d of DETECTORS) {
    try {
      const r = await d.run(env)
      results.push(r)
    } catch (err) {
      results.push({
        detector_id: d.id,
        problems_found: 0,
        suggestions_created: 0,
        suggestions_skipped: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { detectors_run: DETECTORS.length, results }
}
