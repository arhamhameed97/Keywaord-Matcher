/**
 * Smoke: full-taxonomy Characteristics candidates + diversity rails.
 * Run: npx tsx scripts/smoke-ai-characteristics.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildAiCharacteristicsCandidates,
  diversifyAiCharacteristics,
  buildCharacteristicsShortlist,
  AI_CATEGORY_LIMITS,
  AI_CHARACTERISTICS_MAX_PER_BRANCH,
} from '../src/lib/pickKeywords.ts'
import type { KeywordsSpace, ScoredKeyword } from '../src/lib/types.ts'
import type { MovieLookupResult } from '../src/lib/lookupMovie.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const space = JSON.parse(
  fs.readFileSync(path.join(root, 'public', 'keywords-space.json'), 'utf8'),
) as KeywordsSpace

let failed = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`OK  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failed++
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const full = buildAiCharacteristicsCandidates(space.keywords)
check(
  'full candidates >> legacy shortlist',
  full.length > AI_CATEGORY_LIMITS.Characteristics.shortlist,
  `${full.length} pickable vs shortlist cap ${AI_CATEGORY_LIMITS.Characteristics.shortlist}`,
)
check('all candidates are Characteristics', full.every((k) => k.category === 'Characteristics'))
check('no score gate on candidates', full.every((k) => k.reasons.includes('ai-candidate')))

const movie: MovieLookupResult = {
  title: 'Titanic',
  year: '1997',
  plot: 'A young aristocrat falls in love with a poor artist aboard the Titanic.',
  genres: ['Drama', 'Romance'],
  source: 'omdb',
}
const legacy = buildCharacteristicsShortlist(space.keywords, movie)
check(
  'legacy shortlist still capped',
  legacy.length <= AI_CATEGORY_LIMITS.Characteristics.shortlist,
  String(legacy.length),
)

// Simulate AI returning many same-branch picks
const romanceish = full.filter((k) =>
  k.path.some((p) => /relationship|romantic|love/i.test(p) || /love|romance/i.test(k.name)),
)
const fakeAi: ScoredKeyword[] = [
  ...romanceish.slice(0, 8).map((k, i) => ({ ...k, score: 100 - i, reasons: ['ai:test'] })),
  ...full
    .filter((k) => !romanceish.some((r) => r.id === k.id))
    .slice(0, 4)
    .map((k, i) => ({ ...k, score: 90 - i, reasons: ['ai:test'] })),
]
const diversified = diversifyAiCharacteristics(fakeAi, space.keywords)
check(
  'diversity respects min/max',
  diversified.length >= AI_CATEGORY_LIMITS.Characteristics.min &&
    diversified.length <= AI_CATEGORY_LIMITS.Characteristics.max,
  String(diversified.length),
)

const branchCounts = new Map<string, number>()
for (const item of diversified) {
  const key =
    item.path.length >= 3 ? item.path.slice(0, 3).join('>') : item.path.join('>')
  branchCounts.set(key, (branchCounts.get(key) ?? 0) + 1)
}
const maxBranch = Math.max(...branchCounts.values(), 0)
check(
  'branch cap enforced when possible',
  maxBranch <= AI_CHARACTERISTICS_MAX_PER_BRANCH || diversified.length <= AI_CATEGORY_LIMITS.Characteristics.min,
  `max branch count ${maxBranch}`,
)

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll smoke checks passed.')
