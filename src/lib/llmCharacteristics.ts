import {
  AI_CATEGORY_LIMITS,
  type SoftCategory,
} from './pickKeywords'
import {
  validateLlmPicks,
  type PickKeywordsResponse,
} from './geminiCharacteristics'
import type { MovieLookupResult } from './lookupMovie'
import type { ScoredKeyword } from './types'

const CLIENT_TIMEOUT_MS = 12_000

export class LlmKeywordsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmKeywordsError'
  }
}

/** @deprecated use LlmKeywordsError */
export const LlmCharacteristicsError = LlmKeywordsError

/**
 * Ask the Vite proxy (Gemini) to pick keywords for a category from the shortlist.
 */
export async function pickCategoryWithLlm(options: {
  movie: MovieLookupResult
  category: SoftCategory
  shortlist: ScoredKeyword[]
  genres?: string[]
}): Promise<ScoredKeyword[]> {
  const { movie, category, shortlist } = options
  if (shortlist.length === 0) {
    throw new LlmKeywordsError(`Empty ${category} shortlist`)
  }

  const limits = AI_CATEGORY_LIMITS[category]
  const byId = new Map(shortlist.map((s) => [s.id, s]))
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

  try {
    const res = await fetch('/api/pick-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        title: movie.title,
        year: movie.year,
        genres: options.genres ?? movie.genres ?? [],
        plot: movie.plot ?? '',
        category,
        candidates: shortlist.map((s) => ({
          id: s.id,
          name: s.name,
          path: s.path,
        })),
      }),
    })

    if (res.status === 503) {
      throw new LlmKeywordsError('Gemini not configured (503)')
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null
      throw new LlmKeywordsError(
        err?.error || `${category} AI failed (${res.status})`,
      )
    }

    const data = (await res.json()) as PickKeywordsResponse
    const validated = validateLlmPicks(data.picks ?? [], byId, {
      min: limits.min,
      max: limits.max,
    })

    return validated.map(({ rank: _rank, ...rest }) => rest)
  } catch (err) {
    if (err instanceof LlmKeywordsError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmKeywordsError(`${category} AI timed out`)
    }
    throw new LlmKeywordsError(
      err instanceof Error ? err.message : `${category} AI failed`,
    )
  } finally {
    window.clearTimeout(timer)
  }
}

/** @deprecated use pickCategoryWithLlm */
export async function pickCharacteristicsWithLlm(options: {
  movie: MovieLookupResult
  shortlist: ScoredKeyword[]
  genres?: string[]
}): Promise<ScoredKeyword[]> {
  return pickCategoryWithLlm({
    ...options,
    category: 'Characteristics',
  })
}
