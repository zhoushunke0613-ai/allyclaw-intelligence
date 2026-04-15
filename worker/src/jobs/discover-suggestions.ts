/**
 * Detector orchestrator.
 *
 * Runs all registered detectors and aggregates results.
 * New detectors: import + add to DETECTORS array.
 */

import type { Env } from '../env'
import { detectHighFailureCategory } from './detectors/high-failure-category'

const DETECTORS = [
  { id: 'D-001-high-failure-category', run: detectHighFailureCategory },
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
