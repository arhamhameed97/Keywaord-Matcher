/**
 * Smoke: resolve Wikipedia plots for common titles.
 * Run: npx tsx scripts/smoke-wikipedia-plot.ts
 */
import {
  clearWikipediaPlotCache,
  fetchWikipediaPlot,
} from '../src/lib/wikipediaPlot.ts'

clearWikipediaPlotCache()

const titanic = await fetchWikipediaPlot('Titanic', '1997')
const hp = await fetchWikipediaPlot(
  "Harry Potter and the Sorcerer's Stone",
  '2001',
)

console.log('Titanic', titanic?.plot.length, titanic?.wikipediaTitle)
console.log('HP', hp?.plot.length, hp?.wikipediaTitle)
if (!titanic || titanic.plot.length < 400) {
  console.error('Titanic plot too short or missing')
  process.exit(1)
}
if (titanic.plot.includes('Cite error')) {
  console.error('Titanic plot still has Cite error junk')
  process.exit(1)
}
console.log('OK smoke wikipedia plot')
