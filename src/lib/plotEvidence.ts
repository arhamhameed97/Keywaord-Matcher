import { tokenize } from './suggest'
import type { KeywordEntry, ScoredKeyword } from './types'

const MAX_EXCERPT = 220

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitSentences(plot: string): string[] {
  const normalized = plot.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24)
}

function trimExcerpt(sentence: string): string {
  const clean = sentence.replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_EXCERPT) return clean
  return `${clean.slice(0, MAX_EXCERPT - 1).trim()}…`
}

function termsFromReasons(reasons: string[]): string[] {
  const terms: string[] = []
  for (const reason of reasons) {
    if (
      reason.startsWith('evidence:') ||
      reason.startsWith('shortlist-pad') ||
      reason.startsWith('penalize:') ||
      reason.startsWith('downrank:') ||
      reason.startsWith('tone-block')
    ) {
      continue
    }

    const arrow = reason.match(/^[^→]+→(.+)$/)
    if (arrow) {
      terms.push(...tokenize(arrow[1]))
      continue
    }

    const tagged = reason.match(/^(?:exact|weak-exact|name~?|weak|path):(.+)$/i)
    if (tagged) {
      terms.push(...tokenize(tagged[1]))
    }
  }
  return terms
}

function collectSearchTerms(entry: KeywordEntry, reasons: string[]): string[] {
  const terms = new Set<string>()
  for (const tok of tokenize(entry.name)) terms.add(tok)
  for (const seg of entry.path) {
    for (const tok of tokenize(seg)) terms.add(tok)
  }
  for (const tok of termsFromReasons(reasons)) terms.add(tok)
  return [...terms].filter((t) => t.length >= 3)
}

function scoreSentence(sentence: string, entry: KeywordEntry, terms: string[]): number {
  const lower = sentence.toLowerCase()
  let score = 0

  const name = entry.name.toLowerCase()
  if (name.length >= 4 && lower.includes(name)) score += 40

  const namePhrase = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i')
  if (namePhrase.test(sentence)) score += 25

  for (const term of terms) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i')
    if (re.test(sentence)) score += 8
    else if (lower.includes(term)) score += 3
  }

  return score
}

function inferFallback(entry: KeywordEntry, reasons: string[]): string | null {
  for (const reason of reasons) {
    const theme = reason.match(/^theme→(.+)$/)
    if (theme && theme[1].toLowerCase() === entry.name.toLowerCase()) {
      return `Plot theme cue matches “${entry.name}”.`
    }

    const genre = reason.match(/^([^→]+)→(.+)$/)
    if (genre) {
      const [, from, to] = genre
      if (to.toLowerCase() === entry.name.toLowerCase()) {
        return `Suggested by ${from} genre mapping to “${entry.name}”.`
      }
      if (entry.path.some((p) => p.toLowerCase().includes(to.toLowerCase()))) {
        return `Suggested by ${from} genre (${to}).`
      }
    }

    const exact = reason.match(/^(?:exact|name~?|weak-exact?):(.+)$/i)
    if (exact) {
      return `Plot mentions “${exact[1]}”, matching “${entry.name}”.`
    }

    const period = reason.match(/^period→(.+)$/)
    if (period) {
      return `Story period signal: ${period[1]}.`
    }

    const geo = reason.match(/^(?:geoExact→|coarse→|place→)(.+)$/)
    if (geo) {
      return `Story setting cue: ${geo[1]}.`
    }
  }

  return null
}

/** Best plot sentence (or short inference) explaining a local keyword pick. */
export function extractPlotEvidence(
  plot: string | undefined,
  entry: KeywordEntry,
  reasons: string[] = [],
): string | null {
  const terms = collectSearchTerms(entry, reasons)
  const sentences = plot ? splitSentences(plot) : []

  let best: { sentence: string; score: number } | null = null
  for (const sentence of sentences) {
    const score = scoreSentence(sentence, entry, terms)
    if (!best || score > best.score) best = { sentence, score }
  }

  if (best && best.score >= 8) {
    return trimExcerpt(best.sentence)
  }

  return inferFallback(entry, reasons)
}

export function attachPlotEvidence(
  items: ScoredKeyword[],
  plot: string | undefined,
): ScoredKeyword[] {
  if (!plot?.trim()) return items

  return items.map((item) => {
    if (item.reasons.some((r) => r.startsWith('ai:'))) return item
    if (item.reasons.some((r) => r.startsWith('plot:'))) return item

    const excerpt = extractPlotEvidence(plot, item, item.reasons)
    if (!excerpt) return item

    return {
      ...item,
      reasons: [`plot:${excerpt}`, ...item.reasons],
    }
  })
}

export function getPickReason(
  reasons?: string[],
): { kind: 'ai' | 'plot'; text: string } | null {
  if (!reasons?.length) return null
  const ai = reasons.find((r) => r.startsWith('ai:'))
  if (ai) return { kind: 'ai', text: ai.slice(3) }
  const plot = reasons.find((r) => r.startsWith('plot:'))
  if (plot) return { kind: 'plot', text: plot.slice(5) }
  return null
}
