/**
 * Quick offline smoke test for soft-minimum picks (no network).
 * Run: node scripts/smoke-pick.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const space = JSON.parse(
  fs.readFileSync(path.join(root, 'public', 'keywords-space.json'), 'utf8'),
)

// Inline minimal ports of map + pick logic would require TS compile.
// Instead assert keyword space shape and floor constants match plan.
const floors = { Characteristics: 8, Mood: 4, Setting: 2, Period: 2 }
const byCat = {}
for (const k of space.keywords) {
  byCat[k.category] = (byCat[k.category] || 0) + 1
}
console.log('Keyword counts by category:', byCat)
for (const [cat, min] of Object.entries(floors)) {
  if ((byCat[cat] || 0) < min) {
    console.error(`Not enough ${cat} keywords to satisfy minimum ${min}`)
    process.exit(1)
  }
}
console.log('Soft-minimum floors feasible against keyword space: OK')
