/**
 * Gold regressions with Gemini Characteristics picker.
 * Requires GEMINI_API_KEY in .env
 * Run: npm run score-gold-llm
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCharacteristicsShortlist,
  mergeAiCharacteristics,
  pickKeywordsForMovieLocal,
  settingKind,
  AI_CHARACTERISTICS_FLOOR,
} from '../src/lib/pickKeywords.ts'
import {
  callGeminiPickKeywords,
} from '../api/pick-keywords.ts'
import { validateLlmPicks } from '../src/lib/geminiCharacteristics.ts'
import type { KeywordsSpace } from '../src/lib/types.ts'
import type { MovieLookupResult } from '../src/lib/lookupMovie.ts'
import type { ScoredKeyword } from '../src/lib/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function loadEnvFile() {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null) process.env[key] = val
  }
}

loadEnvFile()

const apiKey = process.env.GEMINI_API_KEY?.trim()
if (!apiKey) {
  console.error('GEMINI_API_KEY missing. Set it in .env and retry.')
  process.exit(1)
}

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

async function pickWithLlm(movie: MovieLookupResult) {
  const local = pickKeywordsForMovieLocal(space.keywords, movie)
  const shortlist = buildCharacteristicsShortlist(space.keywords, movie)
  const byId = new Map(shortlist.map((s) => [s.id, s]))
  const { picks } = await callGeminiPickKeywords(apiKey!, {
    title: movie.title,
    year: movie.year,
    genres: local.movieGenres,
    plot: movie.plot,
    category: 'Characteristics',
    candidates: shortlist.map((s) => ({
      id: s.id,
      name: s.name,
      path: s.path,
    })),
  })
  const validated = validateLlmPicks(picks, byId, {
    min: AI_CHARACTERISTICS_FLOOR,
    max: 10,
  })
  const aiChars: ScoredKeyword[] = validated.map(
    ({ rank: _r, ...rest }) => rest,
  )
  return mergeAiCharacteristics(local, aiChars)
}

async function runCase(name: string, file: string) {
  console.log(`\n=== ${name} (LLM) ===`)
  const gold = JSON.parse(
    fs.readFileSync(path.join(root, 'data', 'gold', file), 'utf8'),
  )
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

  const result = await pickWithLlm(movie)
  const chars = result.byCategory.Characteristics.map((k) => k.name)
  const moods = result.byCategory.Mood.map((k) => k.name)
  const settings = result.byCategory.Setting
  const periods = result.byCategory.Period.map((k) => k.name)

  check(
    `${name} Characteristics floor`,
    chars.length >= AI_CHARACTERISTICS_FLOOR,
    String(chars.length),
  )
  check(`${name} characteristicsSource ai`, result.characteristicsSource === 'ai')
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
      `${name} prefers plot-supported Characteristics (≥4)`,
      hits.length >= 4,
      hits.join(', '),
    )
  }
  if (gold.expected.characteristicsAnyOf) {
    const hits = gold.expected.characteristicsAnyOf.filter((n: string) =>
      chars.includes(n),
    )
    check(
      `${name} anyOf Characteristics (≥3)`,
      hits.length >= 3,
      hits.join(', '),
    )
  }
  if (gold.expected.moodAvoid) {
    const bad = gold.expected.moodAvoid.filter((n: string) => moods.includes(n))
    check(`${name} mood avoid`, bad.length === 0, bad.join(', '))
  }
  if (gold.expected.periodPrefer) {
    const hits = gold.expected.periodPrefer.filter((n: string) =>
      periods.includes(n),
    )
    check(`${name} period prefer`, hits.length >= 1, hits.join(', '))
  }

  console.log('Characteristics:', chars.join(' | '))
}

await runCase('Titanic', 'titanic-1997.json')
await new Promise((r) => setTimeout(r, 3000))
await runCase('Harry Potter 1', 'harry-potter-1.json')

if (failed > 0) {
  console.error(`\n${failed} checks failed`)
  process.exit(1)
}
console.log('\nAll LLM gold checks passed')
