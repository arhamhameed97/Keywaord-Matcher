/**
 * Regression smoke: Titanic gold sample + Setting geo/place-type pair.
 * Run: npx --yes tsx scripts/score-titanic.ts
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

const gold = JSON.parse(
  fs.readFileSync(path.join(root, 'data', 'gold', 'titanic-1997.json'), 'utf8'),
) as {
  title: string
  year: string
  plot: string
  genres: string[]
  country: string
  expected: {
    characteristicsAnyOf: string[]
    moodPrefer: string[]
    moodAvoid: string[]
    periodPrefer: string[]
    periodAvoid: string[]
    settingGeoAnyOf: string[]
    settingPlaceAnyOf: string[]
    settingAvoid: string[]
  }
}

const movie: MovieLookupResult = {
  title: gold.title,
  year: gold.year,
  plot: gold.plot,
  genres: gold.genres,
  country: gold.country,
  source: 'omdb',
}

const result = pickKeywordsForMovie(space.keywords, movie)
const chars = result.byCategory.Characteristics.map((k) => k.name)
const moods = result.byCategory.Mood.map((k) => k.name)
const settings = result.byCategory.Setting
const periods = result.byCategory.Period.map((k) => k.name)

const geo = settings.filter((k) => settingKind(k) === 'geo')
const place = settings.filter((k) => settingKind(k) === 'place')

let failed = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`OK  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failed++
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

check(
  'Characteristics floor',
  chars.length >= 8,
  `${chars.length}`,
)
check(
  'Mood floor',
  moods.length >= 4,
  `${moods.length}`,
)
check(
  'Setting floor',
  settings.length >= 2,
  `${settings.length}`,
)
check(
  'Period floor',
  periods.length >= 2,
  `${periods.length}`,
)
check(
  'Setting has geo',
  geo.length >= 1,
  geo.map((g) => g.name).join(', '),
)
check(
  'Setting has place-type',
  place.length >= 1,
  place.map((g) => g.name).join(', '),
)

const charHits = gold.expected.characteristicsAnyOf.filter((n) => chars.includes(n))
check(
  'Characteristics overlap gold (≥4)',
  charHits.length >= 4,
  `hits=${charHits.length}: ${charHits.join(', ')}`,
)

const moodHits = gold.expected.moodPrefer.filter((n) => moods.includes(n))
check(
  'Mood prefers gold tones (≥2)',
  moodHits.length >= 2,
  moodHits.join(', '),
)

const moodBad = gold.expected.moodAvoid.filter((n) => moods.includes(n))
check('Mood avoids feel-good pack', moodBad.length === 0, moodBad.join(', '))

const periodHits = gold.expected.periodPrefer.filter((n) => periods.includes(n))
check(
  'Period prefers story era',
  periodHits.length >= 1,
  periodHits.join(', '),
)

const periodBad = gold.expected.periodAvoid.filter((n) => periods.includes(n))
check('Period avoids release decade', periodBad.length === 0, periodBad.join(', '))

const geoHit = gold.expected.settingGeoAnyOf.some((n) =>
  settings.some((s) => s.name === n),
)
check('Setting geo near gold', geoHit, settings.map((s) => s.name).join(', '))

const placeHit = gold.expected.settingPlaceAnyOf.some((n) =>
  settings.some((s) => s.name === n),
)
check('Setting place-type near gold', placeHit, settings.map((s) => s.name).join(', '))

const settingBad = gold.expected.settingAvoid.filter((n) =>
  settings.some((s) => s.name === n),
)
check('Setting avoids USA city spam', settingBad.length === 0, settingBad.join(', '))

console.log('\n--- Picked ---')
console.log('Characteristics:', chars.join(' | '))
console.log('Mood:', moods.join(' | '))
console.log(
  'Setting:',
  settings.map((s) => `${s.name}(${settingKind(s)})`).join(' | '),
)
console.log('Period:', periods.join(' | '))

if (failed > 0) {
  console.error(`\n${failed} checks failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
