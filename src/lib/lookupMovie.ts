import {
  fetchWikipediaPlot,
  shouldUseWikipediaPlot,
} from './wikipediaPlot'

export type MovieSource = 'omdb' | 'wikipedia'

export type PlotSource = 'omdb' | 'wikipedia-summary' | 'wikipedia-plot'

export interface MovieCandidate {
  title: string
  year?: string
  imdbID?: string
  type?: string
  poster?: string
}

export interface MovieLookupResult {
  title: string
  year?: string
  /** Text used for keyword scoring (enriched Wikipedia plot when available) */
  plot: string
  /** Short synopsis for default card display (usually OMDb) */
  plotShort?: string
  plotSource?: PlotSource
  wikipediaTitle?: string
  wikipediaUrl?: string
  genres: string[]
  country?: string
  imdbID?: string
  poster?: string
  source: MovieSource
  imdbUrl?: string
  candidates?: MovieCandidate[]
}

interface OmdbSearchItem {
  Title: string
  Year: string
  imdbID: string
  Type: string
  Poster: string
}

interface OmdbSearchResponse {
  Search?: OmdbSearchItem[]
  totalResults?: string
  Response: string
  Error?: string
}

interface OmdbDetailResponse {
  Title: string
  Year: string
  Plot: string
  Genre: string
  Country: string
  imdbID: string
  Poster: string
  Type: string
  Response: string
  Error?: string
}

function getOmdbKey(): string | undefined {
  const key = import.meta.env.VITE_OMDB_API_KEY
  return typeof key === 'string' && key.trim() ? key.trim() : undefined
}

export function hasOmdbKey(): boolean {
  return Boolean(getOmdbKey())
}

function parseYear(year?: string): number | undefined {
  if (!year) return undefined
  const m = year.match(/\d{4}/)
  return m ? Number(m[0]) : undefined
}

function titlesClose(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const na = norm(a)
  const nb = norm(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

/**
 * After OMDb (or summary) identity is known, try to replace scoring plot
 * with a longer Wikipedia Plot section.
 */
async function enrichWithWikipediaPlot(
  movie: MovieLookupResult,
): Promise<MovieLookupResult> {
  const short = movie.plotShort ?? movie.plot
  const base: MovieLookupResult = {
    ...movie,
    plotShort: short,
    plotSource: movie.plotSource ?? (movie.source === 'omdb' ? 'omdb' : 'wikipedia-summary'),
  }

  try {
    const wiki = await fetchWikipediaPlot(movie.title, movie.year, movie.imdbID)
    if (!wiki) return base
    if (!shouldUseWikipediaPlot(wiki.plot, short)) {
      return {
        ...base,
        wikipediaTitle: wiki.wikipediaTitle,
        wikipediaUrl: wiki.wikipediaUrl,
      }
    }
    return {
      ...base,
      plot: wiki.plot,
      plotShort: short,
      plotSource: 'wikipedia-plot',
      wikipediaTitle: wiki.wikipediaTitle,
      wikipediaUrl: wiki.wikipediaUrl,
    }
  } catch (err) {
    console.warn('Plot enrichment failed', err)
    return base
  }
}

async function omdbSearch(
  title: string,
  year?: string,
): Promise<{ candidates: MovieCandidate[]; detail?: MovieLookupResult }> {
  const key = getOmdbKey()
  if (!key) throw new Error('NO_OMDB_KEY')

  const params = new URLSearchParams({
    apikey: key,
    s: title,
    type: 'movie',
  })
  if (year) params.set('y', year)

  const searchRes = await fetch(`https://www.omdbapi.com/?${params}`)
  if (!searchRes.ok) throw new Error(`OMDb search failed (${searchRes.status})`)
  const searchJson = (await searchRes.json()) as OmdbSearchResponse

  if (searchJson.Response === 'False' || !searchJson.Search?.length) {
    // Try exact title lookup
    const byTitle = await omdbByTitle(title, year)
    if (byTitle) return { candidates: [], detail: byTitle }
    return { candidates: [] }
  }

  const candidates: MovieCandidate[] = searchJson.Search.slice(0, 8).map((item) => ({
    title: item.Title,
    year: item.Year,
    imdbID: item.imdbID,
    type: item.Type,
    poster: item.Poster !== 'N/A' ? item.Poster : undefined,
  }))

  const yearNum = parseYear(year)
  const best =
    candidates.find((c) => {
      const cy = parseYear(c.year)
      const yearOk = yearNum == null || cy === yearNum
      return yearOk && titlesClose(c.title, title)
    }) ??
    (yearNum != null
      ? candidates.find((c) => parseYear(c.year) === yearNum)
      : undefined) ??
    candidates[0]

  // Ambiguous: multiple close matches with different years and no year filter
  const closeMatches = candidates.filter((c) => titlesClose(c.title, title))
  if (!year && closeMatches.length > 1) {
    const years = new Set(closeMatches.map((c) => parseYear(c.year)).filter(Boolean))
    if (years.size > 1) {
      return { candidates: closeMatches.slice(0, 6) }
    }
  }

  if (!best?.imdbID) return { candidates }

  const detail = await omdbById(best.imdbID)
  return {
    candidates: closeMatches.length > 1 && !year ? closeMatches.slice(0, 6) : [],
    detail: detail ?? undefined,
  }
}

async function omdbByTitle(
  title: string,
  year?: string,
): Promise<MovieLookupResult | null> {
  const key = getOmdbKey()
  if (!key) return null

  const params = new URLSearchParams({
    apikey: key,
    t: title,
    type: 'movie',
    plot: 'full',
  })
  if (year) params.set('y', year)

  const res = await fetch(`https://www.omdbapi.com/?${params}`)
  if (!res.ok) return null
  const json = (await res.json()) as OmdbDetailResponse
  if (json.Response === 'False') return null
  return mapOmdbDetail(json)
}

async function omdbById(imdbID: string): Promise<MovieLookupResult | null> {
  const key = getOmdbKey()
  if (!key) return null

  const params = new URLSearchParams({
    apikey: key,
    i: imdbID,
    plot: 'full',
  })
  const res = await fetch(`https://www.omdbapi.com/?${params}`)
  if (!res.ok) return null
  const json = (await res.json()) as OmdbDetailResponse
  if (json.Response === 'False') return null
  return mapOmdbDetail(json)
}

function mapOmdbDetail(json: OmdbDetailResponse): MovieLookupResult {
  const genres = (json.Genre || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  const plot = json.Plot && json.Plot !== 'N/A' ? json.Plot : ''
  return {
    title: json.Title,
    year: json.Year !== 'N/A' ? json.Year : undefined,
    plot,
    plotShort: plot,
    plotSource: 'omdb',
    genres,
    country: json.Country && json.Country !== 'N/A' ? json.Country : undefined,
    imdbID: json.imdbID,
    poster: json.Poster && json.Poster !== 'N/A' ? json.Poster : undefined,
    source: 'omdb',
    imdbUrl: json.imdbID ? `https://www.imdb.com/title/${json.imdbID}/` : undefined,
  }
}

async function wikipediaLookup(
  title: string,
  year?: string,
): Promise<MovieLookupResult | null> {
  // Prefer full Plot section first
  const wikiPlot = await fetchWikipediaPlot(title, year)
  if (wikiPlot && wikiPlot.plot.length > 80) {
    return {
      title: wikiPlot.wikipediaTitle.replace(/\s*\(\d{4} film\)\s*$/i, '').replace(/\s*\(film\)\s*$/i, '') || title,
      year,
      plot: wikiPlot.plot,
      plotShort: wikiPlot.plot.slice(0, 400).replace(/\s+\S*$/, '').trim(),
      plotSource: 'wikipedia-plot',
      wikipediaTitle: wikiPlot.wikipediaTitle,
      wikipediaUrl: wikiPlot.wikipediaUrl,
      genres: [],
      source: 'wikipedia',
    }
  }

  const attempts = [
    year ? `${title} (${year} film)` : null,
    `${title} (film)`,
    title,
  ].filter(Boolean) as string[]

  for (const attempt of attempts) {
    const encoded = encodeURIComponent(attempt.replace(/ /g, '_'))
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) continue
      const json = (await res.json()) as {
        title?: string
        extract?: string
        description?: string
        type?: string
        content_urls?: { desktop?: { page?: string } }
        thumbnail?: { source?: string }
      }
      if (json.type === 'disambiguation') continue
      const extract = json.extract?.trim()
      if (!extract) continue

      return {
        title: json.title || title,
        year,
        plot: extract,
        plotShort: extract,
        plotSource: 'wikipedia-summary',
        wikipediaUrl: json.content_urls?.desktop?.page,
        genres: [],
        source: 'wikipedia',
        poster: json.thumbnail?.source,
      }
    } catch {
      continue
    }
  }
  return null
}

export async function lookupMovieByImdbId(
  imdbID: string,
): Promise<MovieLookupResult> {
  const detail = await omdbById(imdbID)
  if (!detail) throw new Error('Could not load that IMDb title.')
  return enrichWithWikipediaPlot(detail)
}

/**
 * Look up a movie by title (OMDb/IMDb first, Wikipedia fallback).
 * When multiple year variants match, returns candidates for the UI to choose.
 */
export async function lookupMovie(
  title: string,
  year?: string,
): Promise<MovieLookupResult> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Enter a movie title.')

  const key = getOmdbKey()
  if (key) {
    try {
      const { candidates, detail } = await omdbSearch(trimmed, year?.trim() || undefined)
      if (candidates.length > 1 && !detail) {
        return {
          title: trimmed,
          year,
          plot: '',
          genres: [],
          source: 'omdb',
          candidates,
        }
      }
      if (detail) {
        if (candidates.length > 1) detail.candidates = candidates
        return enrichWithWikipediaPlot(detail)
      }
    } catch (err) {
      if (err instanceof Error && err.message !== 'NO_OMDB_KEY') {
        console.warn('OMDb lookup failed, trying Wikipedia', err)
      }
    }
  }

  const wiki = await wikipediaLookup(trimmed, year?.trim() || undefined)
  if (wiki) return wiki

  throw new Error(
    key
      ? `No movie found for “${trimmed}”. Try a different title or add the year.`
      : `No movie found for “${trimmed}”. Add a free OMDb API key in .env for better IMDb results, or try Wikipedia-style titles.`,
  )
}
