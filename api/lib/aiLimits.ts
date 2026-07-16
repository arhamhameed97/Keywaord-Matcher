export const AI_CATEGORY_LIMITS = {
  Characteristics: { min: 6, max: 10, shortlist: 80 },
  Mood: { min: 4, max: 6, shortlist: 50 },
  Setting: { min: 2, max: 4, shortlist: 40 },
  Period: { min: 2, max: 4, shortlist: 40 },
} as const

export type SoftCategory = keyof typeof AI_CATEGORY_LIMITS
