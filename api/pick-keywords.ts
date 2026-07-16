/**
 * Vercel serverless route + shared Gemini server logic (single file — no sub-imports).
 * Vite dev proxy imports `handlePickKeywordsRequest` from here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

// --- limits & types ---

const AI_CATEGORY_LIMITS = {
  Characteristics: { min: 6, max: 10, shortlist: 80 },
  Mood: { min: 4, max: 6, shortlist: 50 },
  Setting: { min: 2, max: 4, shortlist: 40 },
  Period: { min: 2, max: 4, shortlist: 40 },
} as const

type SoftCategory = keyof typeof AI_CATEGORY_LIMITS

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

export interface PickKeywordsResponse {
  picks: LlmPick[]
}

const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const GEMINI_MODEL_FALLBACKS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
] as const
const PLOT_TRUNCATE = 6000

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

function buildGeminiUserPrompt(req: PickKeywordsRequest): string {
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

function parseGeminiPicksJson(text: string): LlmPick[] {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let raw = fence ? fence[1].trim() : trimmed

  const objMatch = raw.match(/\{[\s\S]*\}/)
  if (objMatch) raw = objMatch[0]

  raw = raw.replace(/,\s*([}\]])/g, '$1')

  let parsed: { picks?: LlmPick[] }
  try {
    parsed = JSON.parse(raw) as { picks?: LlmPick[] }
  } catch (first) {
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
          if (res.status === 404) break
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

function parseCategory(raw: unknown): SoftCategory {
  if (
    raw === 'Mood' ||
    raw === 'Setting' ||
    raw === 'Period' ||
    raw === 'Characteristics'
  ) {
    return raw
  }
  return 'Characteristics'
}

export async function handlePickKeywordsRequest(
  body: unknown,
  apiKey: string | undefined,
): Promise<{ status: number; body: Record<string, unknown> | PickKeywordsResponse }> {
  if (!apiKey?.trim()) {
    return {
      status: 503,
      body: {
        error:
          'GEMINI_API_KEY not set. Add it to environment variables and redeploy.',
      },
    }
  }

  const req = body as Partial<PickKeywordsRequest> & { category?: string }
  if (!req?.title || !Array.isArray(req.candidates)) {
    return { status: 400, body: { error: 'Invalid request body' } }
  }

  try {
    const result = await callGeminiPickKeywords(apiKey.trim(), {
      title: req.title,
      year: req.year,
      genres: req.genres ?? [],
      plot: req.plot ?? '',
      category: parseCategory(req.category),
      candidates: req.candidates,
    })
    return { status: 200, body: result }
  } catch (err) {
    console.error('[pick-keywords]', err)
    return {
      status: 502,
      body: {
        error: err instanceof Error ? err.message : 'Gemini request failed',
      },
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { status, body } = await handlePickKeywordsRequest(
    req.body,
    process.env.GEMINI_API_KEY,
  )
  return res.status(status).json(body)
}
