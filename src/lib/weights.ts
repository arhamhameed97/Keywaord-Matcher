import type { ScoredKeyword } from './types'

export const WEIGHT_TOTAL = 100

/**
 * Map relative strengths to positive integers that sum to exactly 100
 * (largest-remainder method). Empty input returns [].
 */
export function normalizeRelativeTo100(
  strengths: number[],
): number[] {
  const n = strengths.length
  if (n === 0) return []
  if (n === 1) return [WEIGHT_TOTAL]

  const safe = strengths.map((s) => (Number.isFinite(s) && s > 0 ? s : 0))
  const sum = safe.reduce((a, b) => a + b, 0)
  const base = sum > 0 ? safe : strengths.map(() => 1)
  const baseSum = base.reduce((a, b) => a + b, 0)

  // Floor share; guarantee at least 1 per item when possible
  const raw = base.map((s) => (s / baseSum) * WEIGHT_TOTAL)
  const floors = raw.map((r) => Math.max(1, Math.floor(r)))
  let floorSum = floors.reduce((a, b) => a + b, 0)

  // If floors exceed 100 (many items), fall back to pure floor without min-1
  let ints: number[]
  if (floorSum > WEIGHT_TOTAL) {
    ints = raw.map((r) => Math.floor(r))
    floorSum = ints.reduce((a, b) => a + b, 0)
    // ensure no zeros by stealing from largest later if needed
    for (let i = 0; i < ints.length; i++) {
      if (ints[i] < 1) ints[i] = 1
    }
    floorSum = ints.reduce((a, b) => a + b, 0)
    while (floorSum > WEIGHT_TOTAL) {
      let maxI = 0
      for (let i = 1; i < ints.length; i++) {
        if (ints[i] > ints[maxI]) maxI = i
      }
      if (ints[maxI] <= 1) break
      ints[maxI] -= 1
      floorSum -= 1
    }
  } else {
    ints = floors
  }

  let remainder = WEIGHT_TOTAL - ints.reduce((a, b) => a + b, 0)
  const fracs = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)

  let fi = 0
  while (remainder > 0 && fracs.length > 0) {
    ints[fracs[fi % fracs.length].i] += 1
    remainder -= 1
    fi += 1
  }
  // If still short (edge), dump on first
  if (remainder > 0) ints[0] += remainder

  // Final fix if overshot
  let total = ints.reduce((a, b) => a + b, 0)
  while (total > WEIGHT_TOTAL) {
    let maxI = 0
    for (let i = 1; i < ints.length; i++) {
      if (ints[i] > ints[maxI]) maxI = i
    }
    if (ints[maxI] <= 1) break
    ints[maxI] -= 1
    total -= 1
  }
  while (total < WEIGHT_TOTAL) {
    ints[0] += 1
    total += 1
  }

  return ints
}

/** Attach weights from relative strengths on scored keywords (mutates order preserved). */
export function normalizeWeightsTo100<T extends { weight?: number }>(
  items: T[],
  getStrength: (item: T, index: number) => number = (item) =>
    item.weight != null && item.weight > 0 ? item.weight : 1,
): Array<T & { weight: number }> {
  if (items.length === 0) return []
  const strengths = items.map((item, i) => getStrength(item, i))
  const weights = normalizeRelativeTo100(strengths)
  return items.map((item, i) => ({ ...item, weight: weights[i]! }))
}

/** Derive category weights from local/AI score (higher score → higher weight). */
export function assignWeightsFromScores(
  items: ScoredKeyword[],
): ScoredKeyword[] {
  if (items.length === 0) return []
  return normalizeWeightsTo100(items, (item, index) => {
    if (item.score > 0) return item.score
    // Rank fallback: earlier = stronger
    return Math.max(1, items.length - index)
  })
}

/** Apply Gemini-provided weights by id, then normalize to sum 100. */
export function applyAiWeights(
  items: ScoredKeyword[],
  weightById: Map<string, number>,
): ScoredKeyword[] {
  if (items.length === 0) return []
  const withRaw = items.map((item) => ({
    ...item,
    weight:
      weightById.has(item.id) && (weightById.get(item.id) ?? 0) > 0
        ? weightById.get(item.id)!
        : Math.max(1, item.score || 1),
  }))
  return normalizeWeightsTo100(withRaw)
}

export function sumWeights(items: { weight?: number }[]): number {
  return items.reduce((a, b) => a + (b.weight ?? 0), 0)
}

export function formatKeywordWithWeight(item: {
  name: string
  weight?: number
}): string {
  return item.weight != null ? `${item.name} (${item.weight})` : item.name
}
