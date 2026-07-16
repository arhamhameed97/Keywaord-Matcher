/**
 * Fetch a film’s Plot/Synopsis section from Wikipedia (MediaWiki Action API).
 * Free, no API key. Browser-friendly with origin=*.
 */

export const PLOT_MAX_CHARS = 8000

export interface WikipediaPlotResult {
  plot: string
  wikipediaTitle: string
  wikipediaUrl: string
}

const API = 'https://en.wikipedia.org/w/api.php'
const USER_AGENT = 'SimplyTV-Keyword-Helper/1.0 (local editorial helper)'

const SECTION_PREFER = ['plot', 'synopsis', 'story', 'premise', 'summary'] as const

const cache = new Map<string, WikipediaPlotResult | null>()

function cacheKey(title: string, year?: string, imdbID?: string): string {
  if (imdbID) return `imdb:${imdbID}`
  return `title:${title.toLowerCase().trim()}|${year ?? ''}`
}

function wikiHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'Api-User-Agent': USER_AGENT,
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
}

function cleanPlotPlain(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim()
  // Drop MediaWiki cite-error / footnote machinery that sometimes leaks into section HTML
  t = t.replace(/\s*Cite error:[\s\S]*$/i, '').trim()
  t = t.replace(/\s*\^\s*James Cameron[\s\S]*$/i, '').trim()
  // Strip leading section heading echo ("Plot In 1996…" → "In 1996…")
  t = t.replace(/^(Plot|Synopsis|Story|Premise|Summary)\s+/i, '')
  return t.trim()
}

function stripHtml(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc
      .querySelectorAll(
        'sup.reference, .mw-editsection, .mw-references-wrap, .reflist, style, script, .hatnote, .navigation-not-searchable',
      )
      .forEach((el) => {
        el.remove()
      })
    const text = doc.body.textContent ?? ''
    return cleanPlotPlain(text)
  }
  const raw = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<div[^>]*class="[^"]*reflist[^"]*"[\s\S]*?<\/div>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return cleanPlotPlain(decodeEntities(raw))
}

function truncate(text: string, max = PLOT_MAX_CHARS): string {
  if (text.length <= max) return text
  return text.slice(0, max).replace(/\s+\S*$/, '').trim()
}

function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

async function apiGet(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ format: 'json', origin: '*', ...params })
  const res = await fetch(`${API}?${qs}`, { headers: wikiHeaders() })
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`)
  return res.json()
}

interface ParseSectionsResponse {
  parse?: {
    title?: string
    sections?: Array<{ index: string; line: string; toclevel?: string }>
  }
  error?: { info?: string }
}

interface ParseTextResponse {
  parse?: {
    title?: string
    text?: { '*': string } | string
  }
  error?: { info?: string }
}

interface SearchResponse {
  query?: {
    search?: Array<{ title: string }>
  }
}

async function pageExists(title: string): Promise<string | null> {
  try {
    const json = (await apiGet({
      action: 'parse',
      page: title,
      prop: 'sections',
      redirects: '1',
    })) as ParseSectionsResponse
    if (json.error || !json.parse?.title) return null
    return json.parse.title
  } catch {
    return null
  }
}

async function resolveFilmPage(title: string, year?: string): Promise<string | null> {
  const y = year?.match(/\d{4}/)?.[0]
  const attempts = [
    y ? `${title} (${y} film)` : null,
    `${title} (film)`,
    title,
  ].filter(Boolean) as string[]

  for (const attempt of attempts) {
    const resolved = await pageExists(attempt)
    if (resolved) return resolved
  }

  // Film-oriented search fallback
  const srsearch = y
    ? `"${title}" ${y} film`
    : `"${title}" film`
  try {
    const json = (await apiGet({
      action: 'query',
      list: 'search',
      srsearch,
      srlimit: '5',
      srnamespace: '0',
    })) as SearchResponse
    const hits = json.query?.search ?? []
    for (const hit of hits) {
      const t = hit.title.toLowerCase()
      if (t.includes('(disambiguation)')) continue
      if (
        t.includes('film') ||
        t.includes('movie') ||
        (y && t.includes(y)) ||
        hits.length === 1
      ) {
        const resolved = await pageExists(hit.title)
        if (resolved) return resolved
      }
    }
  } catch {
    // ignore search failures
  }

  return null
}

function pickSectionIndex(
  sections: Array<{ index: string; line: string; toclevel?: string }>,
): string | null {
  const normalized = sections.map((s) => ({
    ...s,
    key: s.line.trim().toLowerCase().replace(/[\[\]]/g, ''),
  }))

  for (const prefer of SECTION_PREFER) {
    // Prefer top-level (toclevel 1) exact match
    const top = normalized.find(
      (s) => s.key === prefer && (s.toclevel === '1' || s.toclevel === undefined),
    )
    if (top) return top.index
    const any = normalized.find((s) => s.key === prefer)
    if (any) return any.index
  }
  return null
}

async function fetchSectionPlainText(
  pageTitle: string,
  sectionIndex: string,
): Promise<string | null> {
  const json = (await apiGet({
    action: 'parse',
    page: pageTitle,
    prop: 'text',
    section: sectionIndex,
    redirects: '1',
    disableeditsection: '1',
  })) as ParseTextResponse

  if (json.error || !json.parse) return null
  const raw = json.parse.text
  const html = typeof raw === 'string' ? raw : raw?.['*']
  if (!html) return null
  const plain = stripHtml(html)
  return plain.length > 0 ? plain : null
}

/**
 * Resolve a film page and return its Plot (or Synposis/Story/…) section as plain text.
 */
export async function fetchWikipediaPlot(
  title: string,
  year?: string,
  imdbID?: string,
): Promise<WikipediaPlotResult | null> {
  const key = cacheKey(title, year, imdbID)
  if (cache.has(key)) return cache.get(key) ?? null

  let result: WikipediaPlotResult | null = null
  try {
    const pageTitle = await resolveFilmPage(title, year)
    if (!pageTitle) {
      cache.set(key, null)
      return null
    }

    const sectionsJson = (await apiGet({
      action: 'parse',
      page: pageTitle,
      prop: 'sections',
      redirects: '1',
    })) as ParseSectionsResponse

    const sections = sectionsJson.parse?.sections ?? []
    const sectionIndex = pickSectionIndex(sections)
    if (sectionIndex == null) {
      cache.set(key, null)
      return null
    }

    const plain = await fetchSectionPlainText(pageTitle, sectionIndex)
    if (!plain || plain.length < 80) {
      cache.set(key, null)
      return null
    }

    result = {
      plot: truncate(plain),
      wikipediaTitle: pageTitle,
      wikipediaUrl: pageUrl(pageTitle),
    }
  } catch (err) {
    console.warn('Wikipedia plot fetch failed', err)
    result = null
  }

  cache.set(key, result)
  return result
}

/** Whether Wikipedia plot should replace the shorter synopsis for scoring. */
export function shouldUseWikipediaPlot(
  wikiPlot: string,
  currentPlot: string,
): boolean {
  if (wikiPlot.length > currentPlot.length) return true
  if (wikiPlot.length > 400) return true
  return false
}

/** Clear session cache (tests). */
export function clearWikipediaPlotCache(): void {
  cache.clear()
}
