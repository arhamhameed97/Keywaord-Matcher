/**
 * Smoke: weight normalization sums to 100.
 * Run: npx tsx scripts/smoke-weights.ts
 */
import {
  assignWeightsFromScores,
  normalizeRelativeTo100,
  normalizeWeightsTo100,
  sumWeights,
  WEIGHT_TOTAL,
} from '../src/lib/weights.ts'
import type { ScoredKeyword } from '../src/lib/types.ts'

let failed = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`OK  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failed++
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const eight = normalizeRelativeTo100([40, 30, 20, 10, 5, 5, 5, 5])
check('8 strengths → 8 weights', eight.length === 8, String(eight.length))
check('8 strengths sum 100', eight.reduce((a, b) => a + b, 0) === WEIGHT_TOTAL, String(eight.reduce((a, b) => a + b, 0)))
check('all positive', eight.every((w) => w >= 1))

const items: ScoredKeyword[] = [
  { id: '1', name: 'A', category: 'Characteristics', path: [], pathLabel: '', searchable: 'a', score: 50, reasons: [] },
  { id: '2', name: 'B', category: 'Characteristics', path: [], pathLabel: '', searchable: 'b', score: 30, reasons: [] },
  { id: '3', name: 'C', category: 'Characteristics', path: [], pathLabel: '', searchable: 'c', score: 20, reasons: [] },
  { id: '4', name: 'D', category: 'Characteristics', path: [], pathLabel: '', searchable: 'd', score: 10, reasons: [] },
  { id: '5', name: 'E', category: 'Characteristics', path: [], pathLabel: '', searchable: 'e', score: 8, reasons: [] },
  { id: '6', name: 'F', category: 'Characteristics', path: [], pathLabel: '', searchable: 'f', score: 6, reasons: [] },
  { id: '7', name: 'G', category: 'Characteristics', path: [], pathLabel: '', searchable: 'g', score: 4, reasons: [] },
  { id: '8', name: 'H', category: 'Characteristics', path: [], pathLabel: '', searchable: 'h', score: 2, reasons: [] },
]
const weighted = assignWeightsFromScores(items)
check('assign from scores sum 100', sumWeights(weighted) === WEIGHT_TOTAL, String(sumWeights(weighted)))
check('highest score gets highest weight', (weighted[0]!.weight ?? 0) >= (weighted[7]!.weight ?? 0))

const renorm = normalizeWeightsTo100(
  weighted.map((w, i) => ({ ...w, weight: i === 0 ? 90 : 1 })),
)
check('renorm after tweak sum 100', sumWeights(renorm) === WEIGHT_TOTAL)

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll weight smoke checks passed.')
