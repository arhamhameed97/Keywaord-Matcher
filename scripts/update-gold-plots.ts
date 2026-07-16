/**
 * Fetch Wikipedia Plot sections into gold JSON for offline score parity.
 * Run: npx tsx scripts/update-gold-plots.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearWikipediaPlotCache,
  fetchWikipediaPlot,
} from '../src/lib/wikipediaPlot.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

clearWikipediaPlotCache()

const cases = [
  { file: 'titanic-1997.json', title: 'Titanic', year: '1997' },
  {
    file: 'harry-potter-1.json',
    title: "Harry Potter and the Sorcerer's Stone",
    year: '2001',
    altTitles: [
      "Harry Potter and the Philosopher's Stone",
      'Harry Potter and the Philosophers Stone',
    ],
  },
]

let failed = 0
for (const c of cases) {
  // Be gentle with Wikipedia rate limits when refreshing multiple titles
  await new Promise((r) => setTimeout(r, 1500))

  let wiki = await fetchWikipediaPlot(c.title, c.year)
  if (!wiki && c.altTitles) {
    for (const alt of c.altTitles) {
      await new Promise((r) => setTimeout(r, 800))
      wiki = await fetchWikipediaPlot(alt, c.year)
      if (wiki) break
    }
  }

  const goldPath = path.join(root, 'data', 'gold', c.file)
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8')) as Record<
    string,
    unknown
  >

  console.log(
    c.file,
    'wiki?',
    Boolean(wiki),
    'len',
    wiki?.plot.length,
    'page',
    wiki?.wikipediaTitle,
  )

  if (!wiki) {
    failed++
    continue
  }

  if (!gold.plotShort) gold.plotShort = gold.plot
  gold.plot = wiki.plot
  gold.plotSource = 'wikipedia-plot'
  gold.wikipediaTitle = wiki.wikipediaTitle
  gold.wikipediaUrl = wiki.wikipediaUrl
  fs.writeFileSync(goldPath, JSON.stringify(gold, null, 2) + '\n')
  console.log(
    'updated',
    c.file,
    'plot',
    wiki.plot.length,
    'short',
    String(gold.plotShort).length,
  )
}

if (failed > 0) {
  console.error(`${failed} gold files failed to fetch Wikipedia plot`)
  process.exit(1)
}
