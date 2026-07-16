import {
  CHARACTERISTICS_GENRE_BOOSTS,
  GENRE_BOOSTS,
  type GenreName,
} from './genreMaps'
import type { KeywordEntry, ScoredKeyword } from './types'

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'shall', 'can', 'this', 'that', 'these', 'those', 'it', 'its',
  'he', 'she', 'they', 'them', 'his', 'her', 'their', 'we', 'you', 'i', 'who',
  'whom', 'which', 'what', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'about', 'into',
  'over', 'after', 'before', 'between', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'out', 'up', 'down', 'off', 'above', 'below', 'film',
  'movie', 'story', 'one', 'two', 'also', 'while', 'during', 'through',
])

/** Too generic to count as Characteristics evidence by themselves */
const WEAK_EVIDENCE_TOKENS = new Set([
  'family',
  'life',
  'world',
  'stories',
  'friends',
  'friend',
  'group',
  'evil',
  'dark',
  'good',
  'business',
  'school',
  'home',
  'house',
  'people',
  'human',
  'young',
  'boy',
  'girl',
  'man',
  'woman',
])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

function pathHaystack(entry: KeywordEntry): string {
  return entry.path.join(' ').toLowerCase()
}

function themeMatchesEntry(entry: KeywordEntry, theme: string): boolean {
  const t = theme.toLowerCase()
  const name = entry.name.toLowerCase()
  if (name === t) return true
  const nameToks = tokenize(name)
  const themeToks = tokenize(t)
  if (themeToks.length === 0) return false
  // Single-token themes (e.g. Magic) must match the whole keyword name — not "Magic Tricks"
  if (themeToks.length === 1) {
    return name === t || (nameToks.length === 1 && nameToks[0] === themeToks[0])
  }
  return themeToks.every((tok) => nameToks.includes(tok))
}

function plotHasAnyToken(plotTokens: Set<string>, required?: string[]): boolean {
  if (!required || required.length === 0) return true
  return required.some((t) => plotTokens.has(t.toLowerCase()))
}

/** Mood / Setting flavour — path-based, conservative lists in GENRE_BOOSTS. */
function genreScoreMoodPath(
  entry: KeywordEntry,
  genres: GenreName[],
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const hay = pathHaystack(entry)

  for (const genre of genres) {
    const boosts = GENRE_BOOSTS[genre]
    if (!boosts) continue
    for (const boost of boosts) {
      for (const segment of boost.pathIncludes) {
        if (hay.includes(segment.toLowerCase())) {
          score += boost.weight
          reasons.push(`${genre}→${segment}`)
          break
        }
      }
    }
  }
  return { score, reasons }
}

/**
 * Characteristics genre score: match theme against name / last path segments only.
 * Optional plot-token gate so Fantasy never auto-boosts Vampire without "vampire" in plot.
 */
export function characteristicsGenreScore(
  entry: KeywordEntry,
  genres: GenreName[],
  plotTokens: Set<string>,
): { score: number; reasons: string[] } {
  if (entry.category !== 'Characteristics') return { score: 0, reasons: [] }

  let score = 0
  const reasons: string[] = []

  for (const genre of genres) {
    const boosts = CHARACTERISTICS_GENRE_BOOSTS[genre]
    if (!boosts) continue
    for (const boost of boosts) {
      if (!plotHasAnyToken(plotTokens, boost.requiresPlotTokens)) continue
      for (const theme of boost.themes) {
        if (themeMatchesEntry(entry, theme)) {
          score += boost.weight
          reasons.push(`${genre}→${theme}`)
          break
        }
      }
    }
  }

  return { score, reasons }
}

/**
 * Text match against keyword name. Path-only hits disabled for Characteristics.
 */
export function textScore(
  entry: KeywordEntry,
  tokens: string[],
  options?: { forCharacteristics?: boolean },
): { score: number; reasons: string[]; evidence: number } {
  if (tokens.length === 0) return { score: 0, reasons: [], evidence: 0 }

  let score = 0
  let evidence = 0
  const reasons: string[] = []
  const nameLower = entry.name.toLowerCase()
  const search = entry.searchable
  const nameTokens = tokenize(entry.name)
  const forChar = options?.forCharacteristics === true

  for (const token of tokens) {
    if (token.length < 3) continue
    const weak = WEAK_EVIDENCE_TOKENS.has(token)

    if (nameLower === token) {
      // Single-word generics ("evil", "family") are not plot-specific Characteristics
      if (forChar && weak) {
        score += 4
        reasons.push(`weak-exact:${token}`)
        continue
      }
      score += 40
      evidence += 40
      reasons.push(`exact:${token}`)
      continue
    }
    if (nameTokens.includes(token)) {
      // Weak generic tokens (family, school…) are not enough evidence alone
      if (forChar && weak) {
        score += 4
        reasons.push(`weak:${token}`)
        continue
      }
      score += 28
      evidence += 28
      reasons.push(`name:${token}`)
      continue
    }
    // Whole-word substring only — avoid "stone" matching inside "milestones"
    if (
      token.length >= 5 &&
      !weak &&
      new RegExp(`\\b${escapeRegExp(token)}\\b`).test(nameLower)
    ) {
      score += 18
      evidence += 18
      reasons.push(`name~${token}`)
      continue
    }
    if (!forChar && search.includes(token)) {
      score += 8
      reasons.push(`path:${token}`)
    }
  }

  return { score, reasons, evidence }
}

export function suggestKeywords(
  keywords: KeywordEntry[],
  options: {
    genres: GenreName[]
    title?: string
    synopsis?: string
    limitPerCategory?: number
    minScore?: number
    /** When true, Characteristics need evidenceScore > 0 to be included */
    evidenceGateCharacteristics?: boolean
  },
): ScoredKeyword[] {
  const {
    genres,
    title = '',
    synopsis = '',
    limitPerCategory = 25,
    minScore = 8,
    evidenceGateCharacteristics = false,
  } = options

  const tokens = tokenize(`${title} ${synopsis}`)
  const plotTokenSet = new Set(tokens)
  const scored: ScoredKeyword[] = []

  for (const entry of keywords) {
    const isChar = entry.category === 'Characteristics'
    const t = textScore(entry, tokens, { forCharacteristics: isChar })

    let gScore = 0
  let gReasons: string[] = []
  if (isChar) {
      const g = characteristicsGenreScore(entry, genres, plotTokenSet)
      gScore = g.score
      gReasons = g.reasons
    } else {
      const g = genreScoreMoodPath(entry, genres)
      gScore = g.score
      gReasons = g.reasons
    }

    const score = gScore + t.score

    // Genre alone is not Characteristics evidence unless requiresPlotTokens already gated gScore
    if (isChar && evidenceGateCharacteristics) {
      if (t.evidence <= 0 && gScore <= 0) continue
    }

    if (score < minScore) continue

    const reasons = [...gReasons.slice(0, 3), ...t.reasons.slice(0, 3)]
    scored.push({
      ...entry,
      score,
      reasons: isChar
        ? [`evidence:${t.evidence + (gScore > 0 ? 1 : 0)}`, ...reasons]
        : reasons,
    })
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  const perCategory = new Map<string, number>()
  const limited: ScoredKeyword[] = []

  for (const item of scored) {
    const count = perCategory.get(item.category) ?? 0
    if (count >= limitPerCategory) continue
    perCategory.set(item.category, count + 1)
    limited.push(item)
  }

  return limited
}

/** Parse evidence marker from reasons if present. */
export function getEvidenceFlag(item: ScoredKeyword): number {
  const m = item.reasons.find((r) => r.startsWith('evidence:'))
  if (!m) return item.category === 'Characteristics' ? 0 : 1
  return Number(m.slice('evidence:'.length)) || 0
}

export function searchKeywords(
  keywords: KeywordEntry[],
  query: string,
  limit = 40,
): KeywordEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const tokens = q.split(/\s+/).filter(Boolean)

  return keywords
    .map((entry) => {
      let score = 0
      const hay = entry.searchable
      const name = entry.name.toLowerCase()
      if (name === q) score += 100
      else if (name.startsWith(q)) score += 60
      else if (name.includes(q)) score += 40
      for (const token of tokens) {
        if (hay.includes(token)) score += 10
      }
      return { entry, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((x) => x.entry)
}

export function groupByCategory(
  items: KeywordEntry[],
  categoryOrder: string[],
): Record<string, KeywordEntry[]> {
  const groups: Record<string, KeywordEntry[]> = {}
  for (const cat of categoryOrder) {
    groups[cat] = []
  }
  for (const item of items) {
    if (!groups[item.category]) groups[item.category] = []
    groups[item.category].push(item)
  }
  return groups
}
