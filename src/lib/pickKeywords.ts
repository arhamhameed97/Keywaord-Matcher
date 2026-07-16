import { mapOmdbGenres, type GenreName } from './genreMaps'
import type { MovieLookupResult } from './lookupMovie'
import {
  COARSE_COUNTRY_SETTINGS,
  decadeFromYear,
  extractStorySignals,
  parseYearString,
  type StorySignals,
} from './storySignals'
import { attachPlotEvidence } from './plotEvidence'
import { suggestKeywords, tokenize } from './suggest'
import type { KeywordEntry, ScoredKeyword } from './types'

export const SOFT_MINIMUMS = {
  Characteristics: 8,
  Mood: 4,
  Setting: 2,
  Period: 2,
} as const

/** Floor when a category comes from the LLM. */
export const AI_CATEGORY_LIMITS = {
  Characteristics: { min: 6, max: 10, shortlist: 80 },
  Mood: { min: 4, max: 6, shortlist: 50 },
  Setting: { min: 2, max: 4, shortlist: 40 },
  Period: { min: 2, max: 4, shortlist: 40 },
} as const

/** @deprecated use AI_CATEGORY_LIMITS.Characteristics */
export const AI_CHARACTERISTICS_FLOOR = AI_CATEGORY_LIMITS.Characteristics.min
/** @deprecated use AI_CATEGORY_LIMITS.Characteristics */
export const AI_CHARACTERISTICS_MAX = AI_CATEGORY_LIMITS.Characteristics.max
/** @deprecated use AI_CATEGORY_LIMITS.Characteristics */
export const CHARACTERISTICS_SHORTLIST_SIZE =
  AI_CATEGORY_LIMITS.Characteristics.shortlist

export type SoftCategory = keyof typeof SOFT_MINIMUMS
export type CategorySource = 'local' | 'ai'
/** @deprecated use CategorySource */
export type CharacteristicsSource = CategorySource

export interface PickResult {
  picked: ScoredKeyword[]
  byCategory: Record<string, ScoredKeyword[]>
  floors: {
    Characteristics: number
    Mood: number
    Setting: number
    Period: number
  }
  movieGenres: GenreName[]
  categorySources?: Record<SoftCategory, CategorySource>
  /** @deprecated use categorySources */
  characteristicsSource?: CategorySource
  /** Per-category LLM candidate pools (from local scoring). */
  categoryShortlists?: Record<SoftCategory, ScoredKeyword[]>
  /** @deprecated use categoryShortlists.Characteristics */
  characteristicsShortlist?: ScoredKeyword[]
}

const GEO_REGIONS = new Set([
  'North America',
  'Latin America',
  'Europe',
  'Asia',
  'Africa',
  'Oceania',
])

const POSITIVE_MOODS = new Set([
  'Feel-good',
  'Sweet',
  'Cheerful',
  'Playful',
  'Uplifting',
  'Hillarious',
  'LOL',
  'Wacky',
  'Festive',
])

function isGeographicSetting(entry: KeywordEntry): boolean {
  if (entry.category !== 'Setting') return false
  return entry.path.some((p) => GEO_REGIONS.has(p))
}

function isPlaceTypeSetting(entry: KeywordEntry): boolean {
  if (entry.category !== 'Setting') return false
  return entry.path.includes('Specific') || entry.path.includes('Vague')
}

function isLeafKeyword(entry: KeywordEntry, all: KeywordEntry[]): boolean {
  return !all.some(
    (k) =>
      k.id !== entry.id &&
      k.path.length > entry.path.length &&
      entry.path.every((p, i) => k.path[i] === p),
  )
}

const CHAR_NON_PICKABLE = new Set([
  'Family',
  'Fantasy',
  'History',
  'Enchantment',
  'Everyday Life',
  'Relationships',
  'Romantic Relationships',
  'Other Relationships',
  'Interests',
  'Society',
  'Heroes',
  'Dark',
  'Comedy',
  'Crime-themed',
  'Education',
])

export function isPickableCharacteristic(
  entry: KeywordEntry,
  all: KeywordEntry[],
): boolean {
  if (entry.category !== 'Characteristics') return false
  if (CHAR_NON_PICKABLE.has(entry.name)) return false
  if (isLeafKeyword(entry, all)) return true
  return entry.name.split(/\s+/).length >= 2
}

function midBranchKey(entry: KeywordEntry): string {
  // Characteristics > Everyday Life > Relationships > Romantic Relationships > leaf
  // Cap under third path segment when present
  if (entry.path.length >= 3) return entry.path.slice(0, 3).join('>')
  return entry.path.join('>')
}

function applyPeriodBoosts(
  entry: KeywordEntry,
  storyYear: number | undefined,
  releaseYear: number | undefined,
  signals: StorySignals,
): { score: number; reasons: string[] } {
  if (entry.category !== 'Period') return { score: 0, reasons: [] }

  let score = 0
  const reasons: string[] = []
  const hay = entry.searchable
  const name = entry.name.toLowerCase()
  const year = storyYear ?? releaseYear

  if (entry.path.includes('Life-stages') && !signals.isTeenFocused) {
    score -= 40
    reasons.push('downrank:life-stage')
  }

  if (year != null) {
    const decade = decadeFromYear(year).toLowerCase()
    if (name === decade) {
      score += storyYear != null ? 55 : 28
      reasons.push(`period→${decade}`)
    }

    // Keyword space has 1900s then jumps to 1920s — map 1900-1919 → 1900s only
    if (year >= 1900 && year < 1920 && name === '1900s') {
      score += storyYear != null ? 62 : 30
      reasons.push('period→1900s-early')
    }

    const century =
      year < 1800
        ? '<18th century'
        : year < 1900
          ? '19th century'
          : year < 2000
            ? '20th century'
            : '2000s'
    if (hay.includes(century.toLowerCase()) || name.includes(century.toLowerCase())) {
      score += 16
      reasons.push(`period→${century}`)
    }
    if (year >= 2000 && year < 2010 && hay.includes('early 2000s')) score += 30
    if (year >= 2010 && year < 2020 && hay.includes('2010s')) score += 35
    if (year >= 2020 && hay.includes('2020s')) score += 35
    if (
      storyYear == null &&
      year >= 2010 &&
      (name.includes('contemporary') || hay.includes('contemporary'))
    ) {
      score += 22
    }
  }

  if (signals.hasFlashbacks && name.includes('flashback')) {
    score += 50
    reasons.push('flashbacks')
  }

  return { score, reasons }
}

function applySettingBoosts(
  entry: KeywordEntry,
  signals: StorySignals,
  country?: string,
): { score: number; reasons: string[] } {
  if (entry.category !== 'Setting') return { score: 0, reasons: [] }

  let score = 0
  const reasons: string[] = []
  const name = entry.name.toLowerCase()

  if (isGeographicSetting(entry)) {
    let matchedHint: string | undefined
    for (const hint of signals.geoHints) {
      if (name === hint.toLowerCase()) {
        matchedHint = hint
        // Prefer city/country leaves over continent-level names
        const isContinent = GEO_REGIONS.has(entry.name)
        score += isContinent ? 45 : 72
        reasons.push(`geoExact→${hint}`)
        break
      }
    }

    // Coarse production country only as weak fallback on coarse nodes
    if (score === 0 && country && signals.geoHints.length === 0) {
      const parts = country.split(',').map((p) => p.trim().toLowerCase())
      for (const part of parts) {
        const targets = COARSE_COUNTRY_SETTINGS[part] ?? []
        for (const target of targets) {
          if (name === target.toLowerCase()) {
            score += 25
            reasons.push(`coarse→${target}`)
            matchedHint = target
            break
          }
        }
      }
    }

    // Strongly penalize geos that were not exact-hinted when we have geo hints
    if (signals.geoHints.length > 0 && !matchedHint) {
      score -= 95
      reasons.push('penalize:unhinted-geo')
    }

    const deepUsCities = [
      'las vegas',
      'hollywood',
      'chicago',
      'miami',
      'hawaii',
      'broadway',
      'ohio',
      'texas',
      'california',
      'san francisco',
      'north pole',
      'alaska',
    ]
    if (
      deepUsCities.includes(name) &&
      !signals.geoHints.some((h) => h.toLowerCase() === name)
    ) {
      score -= 80
      reasons.push('penalize:unhinted-city')
    }
  }

  if (isPlaceTypeSetting(entry)) {
    for (const hint of signals.placeTypeHints) {
      const h = hint.toLowerCase()
      if (name === h) {
        // Prefer Seaside slightly for ocean voyages when multiple sea cues fire
        score += name === 'seaside' ? 64 : 56
        reasons.push(`place→${hint}`)
        break
      }
    }
  }

  return { score, reasons }
}

function applyThemeBoosts(
  entry: KeywordEntry,
  signals: StorySignals,
): { score: number; reasons: string[]; evidence: number } {
  let score = 0
  let evidence = 0
  const reasons: string[] = []

  for (const theme of signals.themeHints) {
    const m = theme.match.toLowerCase()
    const nameLower = entry.name.toLowerCase()
    const nameToks = tokenize(nameLower)
    const themeToks = tokenize(m)
    const ok =
      nameLower === m ||
      (themeToks.length === 1
        ? nameToks.length === 1 && nameToks[0] === themeToks[0]
        : themeToks.length > 0 && themeToks.every((tok) => nameToks.includes(tok)))
    if (!ok) continue
    score += theme.weight
    evidence += theme.weight
    reasons.push(`theme→${theme.match}`)
  }

  // Mood coherence: suppress feel-good pack on tragedy/horror
  if (
    entry.category === 'Mood' &&
    (signals.tone === 'tragedy' || signals.tone === 'horror') &&
    POSITIVE_MOODS.has(entry.name)
  ) {
    score -= 50
    reasons.push('tone-block-positive')
  }

  return { score, reasons, evidence }
}

function isNearDuplicate(a: ScoredKeyword, b: ScoredKeyword): boolean {
  const an = a.name.toLowerCase()
  const bn = b.name.toLowerCase()
  if (an === bn) return true
  if (an.includes(bn) || bn.includes(an)) return true
  const ap = a.path.slice(0, -1).join('>')
  const bp = b.path.slice(0, -1).join('>')
  if (ap && ap === bp) {
    const stem = (s: string) => s.replace(/(ing|ed|s)$/i, '').slice(0, 5)
    if (stem(an) === stem(bn) && stem(an).length >= 4) return true
  }
  return false
}

function pickWithBranchCap(
  ranked: ScoredKeyword[],
  minimum: number,
  softMax: number,
  extrasRatio: number,
  maxPerBranch: number,
): ScoredKeyword[] {
  const picked: ScoredKeyword[] = []
  const branchCounts = new Map<string, number>()

  const tryAdd = (item: ScoredKeyword, force = false) => {
    if (picked.some((p) => p.id === item.id)) return false
    if (!force && picked.some((p) => isNearDuplicate(p, item))) return false
    const branch = midBranchKey(item)
    const count = branchCounts.get(branch) ?? 0
    if (!force && count >= maxPerBranch && picked.length >= minimum) return false
    picked.push(item)
    branchCounts.set(branch, count + 1)
    return true
  }

  for (const item of ranked) {
    tryAdd(item)
    if (picked.length >= softMax) break
  }

  if (picked.length < minimum) {
    for (const item of ranked) {
      tryAdd(item, true)
      if (picked.length >= minimum) break
    }
  }

  const floorItems = picked.slice(0, minimum)
  const lastMinScore = floorItems[floorItems.length - 1]?.score ?? 0
  const extrasThreshold = Math.max(18, lastMinScore * extrasRatio)

  const result = [...floorItems]
  for (const item of picked.slice(minimum)) {
    if (item.score >= extrasThreshold && result.length < softMax) result.push(item)
    else if (item.score < extrasThreshold) break
  }
  return result
}

function pickSettings(ranked: ScoredKeyword[], softMax = 4): ScoredKeyword[] {
  const geo = ranked.filter(isGeographicSetting)
  const place = ranked.filter(isPlaceTypeSetting)

  const bestGeo = geo[0]
  const bestPlace = place[0]
  const result: ScoredKeyword[] = []
  if (bestGeo) result.push(bestGeo)
  if (bestPlace && bestPlace.id !== bestGeo?.id) result.push(bestPlace)

  if (!bestGeo) {
    const g = geo[0] ?? ranked.find(isGeographicSetting)
    if (g && !result.some((r) => r.id === g.id)) result.push(g)
  }
  if (!result.some(isPlaceTypeSetting)) {
    const p = place.find((x) => !result.some((r) => r.id === x.id))
    if (p) result.push(p)
  }

  // Only strong extras; keep Setting lean (geo + place, maybe 1–2 more)
  const extrasThreshold = Math.max(
    45,
    Math.min(...result.map((r) => r.score), 60) * 0.85,
  )

  for (const item of [...geo.slice(1), ...place.slice(1)]) {
    if (result.some((r) => r.id === item.id)) continue
    if (item.score < extrasThreshold) continue
    if (isGeographicSetting(item) && item.score < 55) continue
    result.push(item)
    if (result.length >= softMax) break
  }

  if (result.length < 2) {
    for (const item of ranked) {
      if (result.some((r) => r.id === item.id)) continue
      result.push(item)
      if (result.length >= 2) break
    }
  }

  return result.slice(0, softMax)
}

function enrichScores(
  keywords: KeywordEntry[],
  movie: MovieLookupResult,
  genres: GenreName[],
  signals: StorySignals,
): ScoredKeyword[] {
  const releaseYear = parseYearString(movie.year)
  const storyYear = signals.storyYear

  const base = suggestKeywords(keywords, {
    genres,
    title: movie.title,
    synopsis: movie.plot,
    limitPerCategory: 120,
    minScore: 1,
    evidenceGateCharacteristics: true,
  })
  const byId = new Map(base.map((s) => [s.id, s]))
  const leafBonus = (entry: KeywordEntry) =>
    isLeafKeyword(entry, keywords) ? 8 : -12

  const enriched: ScoredKeyword[] = []

  for (const entry of keywords) {
    const existing = byId.get(entry.id)
    const period = applyPeriodBoosts(entry, storyYear, releaseYear, signals)
    const setting = applySettingBoosts(entry, signals, movie.country)
    const theme = applyThemeBoosts(entry, signals)
    const leaf = leafBonus(entry)

    let score =
      (existing?.score ?? 0) + period.score + setting.score + theme.score + leaf

    // Characteristics: exclude genre-only / no-evidence
    if (entry.category === 'Characteristics') {
      const fromBase = existing != null
      const themeEv = theme.evidence > 0
      if (!fromBase && !themeEv) continue
      // Prefer evidence-backed over parent category nodes
      if (!isLeafKeyword(entry, keywords) && theme.evidence === 0) {
        score -= 20
      }
    }

    if (score < 1) continue

    enriched.push({
      ...(existing ?? { ...entry, score: 0, reasons: [] }),
      score,
      reasons: [
        ...(existing?.reasons ?? []).slice(0, 2),
        ...period.reasons,
        ...setting.reasons,
        ...theme.reasons,
      ].slice(0, 6),
    })
  }

  enriched.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return enriched
}

function resolveGenres(
  movie: MovieLookupResult,
  extraGenres?: GenreName[],
): GenreName[] {
  const mapped = mapOmdbGenres(movie.genres)
  const movieGenres = [...new Set([...mapped, ...(extraGenres ?? [])])]
  const extras =
    movieGenres.length === 0
      ? (['Drama'] as GenreName[])
      : (extraGenres ?? [])
  return [...new Set([...movieGenres, ...extras])]
}

/**
 * Top candidates for LLM selection for any category.
 */
export function buildCategoryShortlist(
  keywords: KeywordEntry[],
  movie: MovieLookupResult,
  category: SoftCategory,
  options?: { extraGenres?: GenreName[] },
): ScoredKeyword[] {
  if (category === 'Characteristics') {
    return buildCharacteristicsShortlist(keywords, movie, options)
  }

  const limit = AI_CATEGORY_LIMITS[category].shortlist
  const genres = resolveGenres(movie, options?.extraGenres)
  const signals = extractStorySignals({
    title: movie.title,
    plot: movie.plot,
    releaseYear: movie.year,
    country: movie.country,
  })
  const ranked = enrichScores(keywords, movie, genres, signals)
  const scored = ranked.filter((k) => k.category === category)
  const have = new Set(scored.map((k) => k.id))
  const shortlist: ScoredKeyword[] = [...scored]

  if (shortlist.length < limit) {
    const rest = keywords
      .filter((k) => k.category === category && !have.has(k.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of rest) {
      shortlist.push({ ...entry, score: 0, reasons: ['shortlist-pad'] })
      if (shortlist.length >= limit) break
    }
  }

  return shortlist.slice(0, limit)
}

function buildAllCategoryShortlists(
  keywords: KeywordEntry[],
  movie: MovieLookupResult,
  options?: { extraGenres?: GenreName[] },
): Record<SoftCategory, ScoredKeyword[]> {
  return {
    Characteristics: buildCategoryShortlist(
      keywords,
      movie,
      'Characteristics',
      options,
    ),
    Mood: buildCategoryShortlist(keywords, movie, 'Mood', options),
    Setting: buildCategoryShortlist(keywords, movie, 'Setting', options),
    Period: buildCategoryShortlist(keywords, movie, 'Period', options),
  }
}

const ALL_LOCAL: Record<SoftCategory, CategorySource> = {
  Characteristics: 'local',
  Mood: 'local',
  Setting: 'local',
  Period: 'local',
}

function flattenPicked(byCategory: Record<string, ScoredKeyword[]>): ScoredKeyword[] {
  return [
    ...(byCategory.Characteristics ?? []),
    ...(byCategory.Mood ?? []),
    ...(byCategory.Setting ?? []),
    ...(byCategory.Period ?? []),
  ]
}

/**
 * Replace one category on a pick result with AI picks (other categories unchanged).
 */
export function mergeAiCategory(
  current: PickResult,
  category: SoftCategory,
  aiPicks: ScoredKeyword[],
): PickResult {
  const byCategory = { ...current.byCategory, [category]: aiPicks }
  const floors = {
    ...current.floors,
    [category]: AI_CATEGORY_LIMITS[category].min,
  }
  const categorySources: Record<SoftCategory, CategorySource> = {
    ...(current.categorySources ?? ALL_LOCAL),
    [category]: 'ai',
  }
  return {
    ...current,
    byCategory,
    picked: flattenPicked(byCategory),
    floors,
    categorySources,
    characteristicsSource: categorySources.Characteristics,
  }
}

/** Restore a single category from the local baseline pick. */
export function restoreLocalCategory(
  current: PickResult,
  local: PickResult,
  category: SoftCategory,
): PickResult {
  const byCategory = {
    ...current.byCategory,
    [category]: [...(local.byCategory[category] ?? [])],
  }
  const floors = { ...current.floors, [category]: local.floors[category] }
  const categorySources: Record<SoftCategory, CategorySource> = {
    ...(current.categorySources ?? ALL_LOCAL),
    [category]: 'local',
  }
  return {
    ...current,
    byCategory,
    picked: flattenPicked(byCategory),
    floors,
    categorySources,
    characteristicsSource: categorySources.Characteristics,
  }
}

/**
 * Top pickable Characteristics for LLM selection.
 * Prefer locally scored leaves, then pad with other pickable leaves up to cap
 * so central themes the lexical scorer missed remain available.
 */
export function buildCharacteristicsShortlist(
  keywords: KeywordEntry[],
  movie: MovieLookupResult,
  options?: { extraGenres?: GenreName[]; limit?: number },
): ScoredKeyword[] {
  const limit = options?.limit ?? CHARACTERISTICS_SHORTLIST_SIZE
  const genres = resolveGenres(movie, options?.extraGenres)
  const signals = extractStorySignals({
    title: movie.title,
    plot: movie.plot,
    releaseYear: movie.year,
    country: movie.country,
  })
  const ranked = enrichScores(keywords, movie, genres, signals)
  const scored = ranked.filter((k) => isPickableCharacteristic(k, keywords))
  const have = new Set(scored.map((k) => k.id))
  const shortlist: ScoredKeyword[] = [...scored]

  if (shortlist.length < limit) {
    const rest = keywords
      .filter((k) => isPickableCharacteristic(k, keywords) && !have.has(k.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of rest) {
      shortlist.push({ ...entry, score: 0, reasons: ['shortlist-pad'] })
      if (shortlist.length >= limit) break
    }
  }

  return shortlist.slice(0, limit)
}

/**
 * Replace Characteristics on a local PickResult with AI picks (Mood/Setting/Period kept).
 * @deprecated use mergeAiCategory
 */
export function mergeAiCharacteristics(
  local: PickResult,
  aiChars: ScoredKeyword[],
): PickResult {
  return mergeAiCategory(local, 'Characteristics', aiChars)
}

/**
 * Score + pick soft-minimum keyword packs for a looked-up movie (local scorer).
 * Alias: pickKeywordsForMovieLocal
 */
export function pickKeywordsForMovie(
  keywords: KeywordEntry[],
  movie: MovieLookupResult,
  options?: { extraGenres?: GenreName[] },
): PickResult {
  const genres = resolveGenres(movie, options?.extraGenres)

  const signals = extractStorySignals({
    title: movie.title,
    plot: movie.plot,
    releaseYear: movie.year,
    country: movie.country,
  })

  const ranked = enrichScores(keywords, movie, genres, signals)
  const categoryShortlists = buildAllCategoryShortlists(keywords, movie, {
    extraGenres: options?.extraGenres,
  })

  const byCategory: Record<string, ScoredKeyword[]> = {
    Characteristics: pickWithBranchCap(
      ranked.filter((k) => isPickableCharacteristic(k, keywords)),
      SOFT_MINIMUMS.Characteristics,
      12,
      0.85,
      3,
    ),
    Mood: pickWithBranchCap(
      ranked.filter((k) => k.category === 'Mood'),
      SOFT_MINIMUMS.Mood,
      6,
      0.85,
      2,
    ),
    Setting: pickSettings(
      ranked.filter((k) => k.category === 'Setting'),
      6,
    ),
    Period: pickWithBranchCap(
      ranked.filter((k) => k.category === 'Period'),
      SOFT_MINIMUMS.Period,
      5,
      0.8,
      2,
    ),
  }

  // If a category still under minimum (sparse scores), fill from ranked only
  // (Characteristics already evidence-gated in ranked pool — never invent Hiroshima-style filler)
  for (const cat of Object.keys(SOFT_MINIMUMS) as SoftCategory[]) {
    const need = SOFT_MINIMUMS[cat]
    if (byCategory[cat].length >= need) continue
    const have = new Set(byCategory[cat].map((k) => k.id))
    const pool = ranked.filter((k) =>
      cat === 'Characteristics'
        ? isPickableCharacteristic(k, keywords)
        : k.category === cat,
    )
    for (const item of pool) {
      if (have.has(item.id)) continue
      byCategory[cat].push(item)
      if (byCategory[cat].length >= need) break
    }
  }

  const picked = attachPlotEvidence(
    [
      ...byCategory.Characteristics,
      ...byCategory.Mood,
      ...byCategory.Setting,
      ...byCategory.Period,
    ],
    movie.plot,
  )

  const pickedByCategory: Record<string, ScoredKeyword[]> = {
    Characteristics: picked.filter((k) => k.category === 'Characteristics'),
    Mood: picked.filter((k) => k.category === 'Mood'),
    Setting: picked.filter((k) => k.category === 'Setting'),
    Period: picked.filter((k) => k.category === 'Period'),
  }

  return {
    picked,
    byCategory: pickedByCategory,
    floors: SOFT_MINIMUMS,
    movieGenres: genres,
    categorySources: ALL_LOCAL,
    characteristicsSource: 'local',
    categoryShortlists,
    characteristicsShortlist: categoryShortlists.Characteristics,
  }
}

/** Explicit alias for local-only picking (fallback path). */
export const pickKeywordsForMovieLocal = pickKeywordsForMovie

/** Exported for smoke tests */
export function settingKind(entry: KeywordEntry): 'geo' | 'place' | 'other' {
  if (isGeographicSetting(entry)) return 'geo'
  if (isPlaceTypeSetting(entry)) return 'place'
  return 'other'
}
