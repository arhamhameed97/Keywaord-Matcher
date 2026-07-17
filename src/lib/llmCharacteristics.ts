import {
  AI_CATEGORY_LIMITS,
  diversifyAiCharacteristics,
  type SoftCategory,
} from './pickKeywords'
import {
  validateLlmPicks,
  type PickKeywordsResponse,
} from './geminiCharacteristics'
import { recordUsageEvent } from './geminiUsage'
import { applyAiWeights } from './weights'
import type { MovieLookupResult } from './lookupMovie'
import type { KeywordEntry, ScoredKeyword } from './types'

/** Full Characteristics taxonomy needs more time than the old 80-candidate shortlist. */
const CLIENT_TIMEOUT_MS = 25_000

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
 * For Characteristics, pass the full pickable taxonomy via {@link buildAiCharacteristicsCandidates}.
 * Records free-tier usage in localStorage on each attempt.
 */
export async function pickCategoryWithLlm(options: {
  movie: MovieLookupResult
  category: SoftCategory
  shortlist: ScoredKeyword[]
  genres?: string[]
  /** Required for Characteristics post-AI branch diversity. */
  keywords?: KeywordEntry[]
}): Promise<ScoredKeyword[]> {
  const { movie, category, shortlist } = options
  if (shortlist.length === 0) {
    throw new LlmKeywordsError(`Empty ${category} shortlist`)
  }

  const limits = AI_CATEGORY_LIMITS[category]
  const byId = new Map(shortlist.map((s) => [s.id, s]))
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
  let recorded = false

  const track = (ok: boolean, usage?: PickKeywordsResponse['usage'], error?: string) => {
    if (recorded) return
    recorded = true
    recordUsageEvent({
      title: movie.title,
      category,
      ok,
      usage,
      error,
    })
  }

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
        plotShort: movie.plotShort ?? undefined,
        category,
        candidates: shortlist.map((s) => ({
          id: s.id,
          name: s.name,
          path: s.path,
        })),
      }),
    })

    if (res.status === 503) {
      const msg = 'Gemini not configured (503)'
      track(false, undefined, msg)
      throw new LlmKeywordsError(msg)
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null
      const msg = err?.error || `${category} AI failed (${res.status})`
      track(false, undefined, msg)
      throw new LlmKeywordsError(msg)
    }

    const data = (await res.json()) as PickKeywordsResponse

    let picks: ScoredKeyword[]
    try {
      const validated = validateLlmPicks(data.picks ?? [], byId, {
        min: limits.min,
        max: limits.max,
      })
      picks = validated.map(({ rank: _rank, ...rest }) => rest)

      if (category === 'Characteristics' && options.keywords?.length) {
        picks = diversifyAiCharacteristics(picks, options.keywords, {
          min: limits.min,
          max: limits.max,
        })
        if (picks.length < limits.min) {
          throw new Error(
            `LLM returned only ${picks.length} valid picks after diversity (need ≥${limits.min})`,
          )
        }
      }

      const weightById = new Map<string, number>()
      for (const p of data.picks ?? []) {
        const w = Number(p.weight)
        if (p.id && Number.isFinite(w) && w > 0) weightById.set(p.id, w)
      }
      // Prefer Gemini weights; fall back to rank/score strengths → sum 100
      picks = applyAiWeights(picks, weightById)
    } catch (validateErr) {
      const msg =
        validateErr instanceof Error
          ? validateErr.message
          : `${category} AI validation failed`
      // API call still consumed quota even if picks were invalid
      track(false, data.usage, msg)
      throw new LlmKeywordsError(msg)
    }

    track(true, data.usage)
    return picks
  } catch (err) {
    if (err instanceof LlmKeywordsError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      const msg = `${category} AI timed out`
      track(false, undefined, msg)
      throw new LlmKeywordsError(msg)
    }
    const msg = err instanceof Error ? err.message : `${category} AI failed`
    track(false, undefined, msg)
    throw new LlmKeywordsError(msg)
  } finally {
    window.clearTimeout(timer)
  }
}

/** @deprecated use pickCategoryWithLlm */
export async function pickCharacteristicsWithLlm(options: {
  movie: MovieLookupResult
  shortlist: ScoredKeyword[]
  genres?: string[]
  keywords?: KeywordEntry[]
}): Promise<ScoredKeyword[]> {
  return pickCategoryWithLlm({
    ...options,
    category: 'Characteristics',
  })
}
