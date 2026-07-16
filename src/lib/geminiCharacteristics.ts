/**
 * Client-safe Gemini types + pick validation.
 * Server-side Gemini calls live in api/lib/geminiCall.ts.
 */

import type { LlmPick } from '../../api/lib/geminiCall'

export type {
  LlmCandidate,
  LlmPick,
  PickKeywordsRequest,
  PickKeywordsResponse,
} from '../../api/lib/geminiCall'

/** @deprecated use PickKeywordsRequest */
export type { PickKeywordsRequest as PickCharacteristicsRequest } from '../../api/lib/geminiCall'

/** @deprecated use PickKeywordsResponse */
export type { PickKeywordsResponse as PickCharacteristicsResponse } from '../../api/lib/geminiCall'

/**
 * Validate LLM picks against the candidate shortlist.
 * Returns scored-ready pick records; throws if fewer than minValid.
 */
export function validateLlmPicks(
  picks: LlmPick[],
  shortlistById: Map<string, { id: string; name: string; path: string[]; pathLabel: string; category: string; searchable: string }>,
  options?: { min?: number; max?: number },
): Array<{
  id: string
  name: string
  path: string[]
  pathLabel: string
  category: string
  searchable: string
  score: number
  reasons: string[]
  rank: number
}> {
  const min = options?.min ?? 6
  const max = options?.max ?? 10
  const seen = new Set<string>()
  const out: Array<{
    id: string
    name: string
    path: string[]
    pathLabel: string
    category: string
    searchable: string
    score: number
    reasons: string[]
    rank: number
  }> = []

  const sorted = [...picks].sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99),
  )

  for (const pick of sorted) {
    if (!pick?.id || seen.has(pick.id)) continue
    const entry = shortlistById.get(pick.id)
    if (!entry) continue
    seen.add(pick.id)
    const reason = (pick.reason || '').trim().slice(0, 120)
    out.push({
      ...entry,
      score: 100 - out.length,
      reasons: reason ? [`ai:${reason}`] : ['ai'],
      rank: out.length + 1,
    })
    if (out.length >= max) break
  }

  if (out.length < min) {
    throw new Error(
      `LLM returned only ${out.length} valid picks (need ≥${min})`,
    )
  }
  return out
}
