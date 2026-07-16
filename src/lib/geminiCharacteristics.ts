/**
 * Shared Gemini keyword picking (Node / Vite middleware).
 * Prompt + API call + raw JSON parse — no browser deps.
 */

import type { SoftCategory } from './pickKeywords'
import { AI_CATEGORY_LIMITS } from './pickKeywords'

export const GEMINI_MODEL = 'gemini-3.1-flash-lite'
/** Fallback order if primary returns 404/429/503 */
export const GEMINI_MODEL_FALLBACKS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
] as const
export const PLOT_TRUNCATE = 6000

export interface LlmCandidate {
  id: string
  name: string
  path: string[]
}

export interface LlmPick {
  id: string
  name: string
  rank: number
  reason: string
}

export interface PickKeywordsRequest {
  title: string
  year?: string
  genres: string[]
  plot: string
  category: SoftCategory
  candidates: LlmCandidate[]
}

/** @deprecated use PickKeywordsRequest */
export type PickCharacteristicsRequest = PickKeywordsRequest

export interface PickKeywordsResponse {
  picks: LlmPick[]
}

/** @deprecated use PickKeywordsResponse */
export type PickCharacteristicsResponse = PickKeywordsResponse

const CATEGORY_RULES: Record<SoftCategory, string> = {
  Characteristics: `You pick Simply.TV Characteristics keywords for a movie.
- ONLY choose from the provided candidates list. Never invent names or ids.
- Prefer central themes over incidental mentions (a one-line prop is not a theme).
- Prefer diversity across topic branches (path prefixes), not many near-duplicates.
- Do not pick sensitive historical leaves (WWII, WWI, Hiroshima, Pearl Harbor, D-Day, etc.) unless the plot explicitly is about that event.
- Avoid generic parent-like labels; prefer concrete leaf themes.`,
  Mood: `You pick Simply.TV Mood keywords for a movie.
- ONLY choose from the provided candidates list. Never invent names or ids.
- Match the dominant emotional tone of the story (tragedy → heartrending/suspenseful; comedy → cheerful; horror → scary).
- Do not pick upbeat feel-good moods for tragedies or horror unless the plot is clearly light.
- Prefer a coherent mood pack, not contradictory extremes.`,
  Setting: `You pick Simply.TV Setting keywords for a movie.
- ONLY choose from the provided candidates list. Never invent names or ids.
- Pick where the story mainly takes place: geographic region/country/city AND place type (e.g. seaside, school, city).
- Prefer story locations from the plot over production country alone.
- Usually include one geographic and one place-type when both are clearly supported.`,
  Period: `You pick Simply.TV Period keywords for a movie.
- ONLY choose from the provided candidates list. Never invent names or ids.
- Prefer when the story is set (historical year/decade/century) over release year.
- Include flashbacks only when the plot uses them meaningfully.
- Avoid contemporary/release-decade tags when the story is clearly historical.`,
}

function systemRulesFor(category: SoftCategory): string {
  const limits = AI_CATEGORY_LIMITS[category]
  return `${CATEGORY_RULES[category]}
- Return ${limits.min} to ${limits.max} picks, ranked best-first.
- Respond with JSON only matching: {"picks":[{"id":"...","name":"...","rank":1,"reason":"..."}]}`
}

export function buildGeminiUserPrompt(req: PickKeywordsRequest): string {
  const plot = req.plot.slice(0, PLOT_TRUNCATE)
  const candidates = req.candidates.map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path.join(' > '),
  }))
  return [
    `Category: ${req.category}`,
    `Title: ${req.title}`,
    req.year ? `Year: ${req.year}` : null,
    `Genres: ${req.genres.join(', ') || 'unknown'}`,
    '',
    'Plot:',
    plot,
    '',
    'Candidates (choose only from these):',
    JSON.stringify(candidates),
  ]
    .filter((line) => line != null)
    .join('\n')
}

export function parseGeminiPicksJson(text: string): LlmPick[] {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let raw = fence ? fence[1].trim() : trimmed

  // Prefer the outermost JSON object if there is prose around it
  const objMatch = raw.match(/\{[\s\S]*\}/)
  if (objMatch) raw = objMatch[0]

  // Common model glitches: trailing commas before } or ]
  raw = raw.replace(/,\s*([}\]])/g, '$1')

  let parsed: { picks?: LlmPick[] }
  try {
    parsed = JSON.parse(raw) as { picks?: LlmPick[] }
  } catch (first) {
    // Truncated arrays: close open brackets/braces roughly
    let repaired = raw
    const opens = (repaired.match(/\[/g) || []).length
    const closes = (repaired.match(/\]/g) || []).length
    const openB = (repaired.match(/\{/g) || []).length
    const closeB = (repaired.match(/\}/g) || []).length
    if (opens > closes) repaired += ']'.repeat(opens - closes)
    if (openB > closeB) repaired += '}'.repeat(openB - closeB)
    repaired = repaired.replace(/,\s*([}\]])/g, '$1')
    try {
      parsed = JSON.parse(repaired) as { picks?: LlmPick[] }
    } catch {
      throw first instanceof Error ? first : new Error(String(first))
    }
  }

  if (!Array.isArray(parsed.picks)) {
    throw new Error('Gemini response missing picks array')
  }
  return parsed.picks
}

export async function callGeminiPickKeywords(
  apiKey: string,
  req: PickKeywordsRequest,
): Promise<PickKeywordsResponse> {
  const models = [
    GEMINI_MODEL,
    ...GEMINI_MODEL_FALLBACKS.filter((m) => m !== GEMINI_MODEL),
  ]
  const systemRules = systemRulesFor(req.category)
  let lastError: Error | null = null

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`

      const body = {
        systemInstruction: {
          parts: [{ text: systemRules }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildGeminiUserPrompt(req) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          lastError = new Error(
            `Gemini HTTP ${res.status} (${model}): ${errText.slice(0, 200)}`,
          )
          if (res.status === 429 || res.status === 503) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
            continue
          }
          if (res.status === 404) break // next model
          throw lastError
        }

        const json = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> }
          }>
        }
        const text =
          json.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? '')
            .join('') ?? ''
        if (!text) {
          lastError = new Error(`Gemini returned empty content (${model})`)
          break
        }

        const picks = parseGeminiPicksJson(text)
        return { picks }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (
          lastError.message.includes('HTTP 429') ||
          lastError.message.includes('HTTP 503')
        ) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
          continue
        }
        if (lastError.message.includes('HTTP 404')) break
        throw lastError
      }
    }
  }

  throw lastError ?? new Error('Gemini request failed for all models')
}

/** @deprecated use callGeminiPickKeywords */
export async function callGeminiCharacteristics(
  apiKey: string,
  req: PickKeywordsRequest,
): Promise<PickKeywordsResponse> {
  return callGeminiPickKeywords(apiKey, {
    ...req,
    category: req.category ?? 'Characteristics',
  })
}

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
