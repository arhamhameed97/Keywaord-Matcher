/**
 * Gold regressions: Titanic + Harry Potter Characteristics evidence gate.
 * Run: npm run score-gold
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickKeywordsForMovie, settingKind } from '../src/lib/pickKeywords.ts'
import type { KeywordsSpace } from '../src/lib/types.ts'
import type { MovieLookupResult } from '../src/lib/lookupMovie.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
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

function runCase(
  name: string,
  file: string,
  extraChecks?: (chars: string[], moods: string[], settings: ReturnType<typeof pickKeywordsForMovie>['byCategory']['Setting'], periods: string[]) => void,
) {
  console.log(`\n=== ${name} ===`)
  const gold = JSON.parse(fs.readFileSync(path.join(root, 'data', 'gold', file), 'utf8'))
  const movie: MovieLookupResult = {
    title: gold.title,
    year: gold.year,
    plot: gold.plot,
    plotShort: gold.plotShort,
    plotSource: gold.plotSource,
    wikipediaTitle: gold.wikipediaTitle,
    wikipediaUrl: gold.wikipediaUrl,
    genres: gold.genres,
    country: gold.country,
    source: 'omdb',
  }
  const result = pickKeywordsForMovie(space.keywords, movie)
  const chars = result.byCategory.Characteristics.map((k) => k.name)
  const moods = result.byCategory.Mood.map((k) => k.name)
  const settings = result.byCategory.Setting
  const periods = result.byCategory.Period.map((k) => k.name)

  check(`${name} Characteristics floor`, chars.length >= 8, String(chars.length))
  check(`${name} Mood floor`, moods.length >= 4, String(moods.length))
  check(`${name} Setting floor`, settings.length >= 2, String(settings.length))
  check(
    `${name} Setting geo+place`,
    settings.some((s) => settingKind(s) === 'geo') &&
      settings.some((s) => settingKind(s) === 'place'),
  )

  if (gold.expected.characteristicsExclude) {
    const bad = gold.expected.characteristicsExclude.filter((n: string) =>
      chars.includes(n),
    )
    check(`${name} excludes bad Characteristics`, bad.length === 0, bad.join(', '))
  }
  if (gold.expected.characteristicsPreferAnyOf) {
    const hits = gold.expected.characteristicsPreferAnyOf.filter((n: string) =>
      chars.includes(n),
    )
    check(
      `${name} prefers plot-supported Characteristics (≥2)`,
      hits.length >= 2,
      hits.join(', '),
    )
  }
  if (gold.expected.moodAvoid) {
    const bad = gold.expected.moodAvoid.filter((n: string) => moods.includes(n))
    check(`${name} mood avoid`, bad.length === 0, bad.join(', '))
  }
  if (gold.expected.periodAvoid) {
    const bad = gold.expected.periodAvoid.filter((n: string) => periods.includes(n))
    check(`${name} period avoid`, bad.length === 0, bad.join(', '))
  }
  if (gold.expected.periodPrefer) {
    const hits = gold.expected.periodPrefer.filter((n: string) => periods.includes(n))
    check(`${name} period prefer`, hits.length >= 1, hits.join(', '))
  }
  if (gold.expected.settingAvoid) {
    const bad = gold.expected.settingAvoid.filter((n: string) =>
      settings.some((s) => s.name === n),
    )
    check(`${name} setting avoid`, bad.length === 0, bad.join(', '))
  }

  console.log('Characteristics:', chars.join(' | '))
  extraChecks?.(chars, moods, settings, periods)
}

runCase('Titanic', 'titanic-1997.json')
runCase('Harry Potter 1', 'harry-potter-1.json')

if (failed > 0) {
  console.error(`\n${failed} checks failed`)
  process.exit(1)
}
console.log('\nAll gold checks passed')
