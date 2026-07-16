import {
  callGeminiPickKeywords,
  type PickKeywordsRequest,
  type PickKeywordsResponse,
} from './geminiCharacteristics'
import type { SoftCategory } from './pickKeywords'

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
