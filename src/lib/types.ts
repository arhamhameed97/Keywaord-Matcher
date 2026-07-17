export type TopCategory = 'Characteristics' | 'Mood' | 'Setting' | 'Period' | string

export interface KeywordNode {
  id: string
  name: string
  categoryOnly: boolean
  path: string[]
  children: KeywordNode[]
}

export interface KeywordEntry {
  id: string
  name: string
  category: string
  path: string[]
  pathLabel: string
  searchable: string
}

export interface KeywordsSpace {
  version: number
  source: string
  generatedAt: string
  categories: string[]
  tree: KeywordNode[]
  keywords: KeywordEntry[]
  stats: {
    roots: number
    selectableKeywords: number
  }
}

export interface ScoredKeyword extends KeywordEntry {
  score: number
  reasons: string[]
  /** Editorial weight within category; category pack sums to 100. */
  weight?: number
}

export type CopyFormat = 'newline' | 'comma'
