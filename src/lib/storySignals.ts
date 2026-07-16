/**
 * Extract story-level signals from movie metadata (plot/title/country).
 * Prefer story cues over production release year / production Country cascades.
 */

export type StoryTone = 'tragedy' | 'horror' | 'comedy' | 'feelgood' | 'thriller' | 'neutral'

export interface StorySignals {
  /** Prefer this for Period boosts; falls back to release year outside this module */
  storyYear?: number
  storyDecade?: string
  hasFlashbacks: boolean
  isTeenFocused: boolean
  tone: StoryTone
  /** Tokens / phrases that map toward geographic Setting leaves */
  geoHints: string[]
  /** Tokens that map toward Specific/Vague place-type Settings */
  placeTypeHints: string[]
  /** Phrase boost targets for Characteristics / Mood (keyword name or path segment) */
  themeHints: Array<{ match: string; weight: number }>
}

const PLACE_TYPE_CUES: Array<{ re: RegExp; hints: string[] }> = [
  { re: /\b(school|classroom|high school|college|university)\b/i, hints: ['Classroom', 'School Life'] },
  { re: /\b(hospital|clinic|nurse|surgeon|patient)\b/i, hints: ['Hospital'] },
  { re: /\b(office|workplace|cubicle|corporate)\b/i, hints: ['At the office'] },
  { re: /\b(prison|jail|inmate)\b/i, hints: ['Prison'] },
  { re: /\b(lab|laboratory)\b/i, hints: ['Lab'] },
  { re: /\b(suburb|suburban)\b/i, hints: ['Suburbs'] },
  { re: /\b(farm|ranch|barn)\b/i, hints: ['Farm'] },
  { re: /\b(theme park|amusement park)\b/i, hints: ['Theme Park'] },
  { re: /\b(apartment|flat)\b/i, hints: ['Apartment life'] },
  { re: /\b(home|house|household)\b/i, hints: ['Around home', 'Indoors'] },
  { re: /\b(village|small town)\b/i, hints: ['Small village/town'] },
  { re: /\b(city|metropolis|urban)\b/i, hints: ['Cityscape', 'Big city life'] },
  { re: /\b(street|alley)\b/i, hints: ['On the street'] },
  { re: /\b(forest|woods)\b/i, hints: ['Forest', 'Out in the nature'] },
  { re: /\b(wilderness|jungle|desert)\b/i, hints: ['Wilderness', 'Out in the nature'] },
  { re: /\b(island)\b/i, hints: ['On an island'] },
  { re: /\b(space|orbit|spaceship|mars|galaxy)\b/i, hints: ['In space'] },
  { re: /\b(cemetery|graveyard)\b/i, hints: ['Cemetery'] },
  { re: /\b(ship|ocean|sea|atlantic|aboard|voyage|liner|iceberg|sinks?|sinking)\b/i, hints: ['Seaside', 'Under the water', 'On an island'] },
  { re: /\b(indoors?|interior)\b/i, hints: ['Indoors'] },
]

const GEO_CUES: Array<{ re: RegExp; hints: string[] }> = [
  { re: /\b(england|britain|british|uk|united kingdom|southampton|london)\b/i, hints: ['UK', 'London', 'Europe'] },
  { re: /\b(ireland|dublin)\b/i, hints: ['Ireland', 'Europe'] },
  { re: /\b(france|paris|french)\b/i, hints: ['France', 'Paris', 'Europe'] },
  { re: /\b(germany|berlin|german)\b/i, hints: ['Germany', 'Europe'] },
  { re: /\b(italy|rome|italian)\b/i, hints: ['Italy', 'Europe'] },
  { re: /\b(spain|madrid|spanish)\b/i, hints: ['Spain', 'Europe'] },
  { re: /\b(russia|moscow|soviet)\b/i, hints: ['Russia', 'Europe'] },
  { re: /\b(japan|tokyo|japanese)\b/i, hints: ['Japan', 'Asia'] },
  { re: /\b(china|beijing|chinese)\b/i, hints: ['China', 'Asia'] },
  { re: /\b(india|mumbai|delhi|indian)\b/i, hints: ['India', 'Asia'] },
  { re: /\b(korea|seoul|korean)\b/i, hints: ['South Korea', 'Asia'] },
  { re: /\b(new york|manhattan|nyc|brooklyn)\b/i, hints: ['New York', 'Manhattan', 'United States'] },
  { re: /\b(los angeles|hollywood|hollywood|los angeles)\b/i, hints: ['Los Angeles', 'Hollywood', 'California', 'United States'] },
  { re: /\b(chicago)\b/i, hints: ['Chicago', 'United States'] },
  { re: /\b(las vegas)\b/i, hints: ['Las Vegas', 'United States'] },
  { re: /\b(miami)\b/i, hints: ['Miami', 'United States'] },
  { re: /\b(texas)\b/i, hints: ['Texas', 'United States'] },
  { re: /\b(california)\b/i, hints: ['California', 'United States'] },
  { re: /\b(america|american|united states|u\.s\.a?\.?)\b/i, hints: ['United States'] },
  { re: /\b(canada|canadian|toronto|vancouver)\b/i, hints: ['Canada', 'North America'] },
  { re: /\b(mexico|mexican)\b/i, hints: ['Mexico', 'Latin America'] },
  { re: /\b(brazil|brasil|brazilian)\b/i, hints: ['Brasil', 'Latin America'] },
  { re: /\b(sweden|norwegian|denmark|finland|iceland|nordic|scandinavia)\b/i, hints: ['Nordic Scenery', 'Europe'] },
  { re: /\b(egypt|egyptian)\b/i, hints: ['Egypt', 'Africa'] },
  { re: /\b(south africa)\b/i, hints: ['South Africa', 'Africa'] },
  { re: /\b(australia|sydney|melbourne)\b/i, hints: ['Oceania'] },
  { re: /\b(turkey|istanbul)\b/i, hints: ['Turkey', 'Middle East', 'Asia'] },
]

const THEME_CUES: Array<{ re: RegExp; match: string; weight: number }> = [
  { re: /\b(class|social class|aristocrat|steerage|first.?class|upper class|poverty|wealth)\b/i, match: 'Class Difference', weight: 55 },
  { re: /\b(true (story|events)|based on (a )?true|real(-| )life|inspired by)\b/i, match: 'Inspired by true events', weight: 50 },
  { re: /\b(forbidden|star-?crossed|against (their |the )?will|elop)\b/i, match: 'Forbidden love/passion', weight: 48 },
  { re: /\b(love triangle|rival for|two men|two women fight for)\b/i, match: 'Love triangles', weight: 48 },
  { re: /\b(tragic(ally)?|dies?|death|drown|perish|loss|doomed)\b/i, match: 'Love tragedy', weight: 45 },
  { re: /\b(tragic events|catastrophe|disaster|shipwreck|sinks?|tragedy)\b/i, match: 'Tragic Events', weight: 52 },
  { re: /\b(historical|history|period piece)\b/i, match: 'Historical drama', weight: 48 },
  { re: /\b(race against|running out of time|countdown|hurry)\b/i, match: 'A race against time/the clock', weight: 45 },
  { re: /\b(blockbuster|box.?office)\b/i, match: 'Blockbuster', weight: 40 },
  { re: /\b(academy award|oscar|best picture)\b/i, match: 'Academy Award for Best Picture', weight: 42 },
  // Sensitive / historical war leaves — only when plot clearly names them (never parent branch)
  { re: /\bworld war\s*ii\b|\bwwii\b|\bsecond world war\b/i, match: 'WWII', weight: 50 },
  { re: /\bworld war\s*i\b|\bwwi\b|\bfirst world war\b/i, match: 'WWI', weight: 50 },
  { re: /\b(hiroshima|nagasaki|atomic bomb)\b/i, match: 'Atomic bombings of Hiroshima and Nagasaki', weight: 60 },
  { re: /\b(battlefield|soldiers?|combat|army)\b/i, match: 'Soldier', weight: 40 },
  { re: /\b(murder|detective|investigation|serial killer)\b/i, match: 'Murder & Crime', weight: 40 },
  { re: /\b(haunted|ghost|exorcism|demon)\b/i, match: 'Paranormal', weight: 40 },
  { re: /\b(witch|witches|witchcraft)\b/i, match: 'Witches', weight: 48 },
  { re: /\b(wizard|wizards|wizardry)\b/i, match: 'Wizardry', weight: 48 },
  { re: /\b(magic|magical|spell)\b/i, match: 'Magic', weight: 46 },
  { re: /\b(friends?|friendship)\b/i, match: 'Friendship', weight: 42 },
  { re: /\b(school|classroom|hogwarts)\b/i, match: 'School Life', weight: 44 },
  { re: /\b(orphan|orphaned)\b/i, match: 'Orphan', weight: 46 },
  {
    re: /\b(coming of age|learns the truth about (himself|herself)|discovers (he|she) is|enrolls? in .{0,80}school)\b/i,
    match: 'Coming of age',
    weight: 44,
  },
  {
    re: /\b(college|high[- ]school|enrolls? in .{0,60}school|school for)\b/i,
    match: 'College/High-school Students',
    weight: 40,
  },
]

function decadeLabel(year: number): string {
  return `${Math.floor(year / 10) * 10}s`
}

function extractStoryYear(text: string): number | undefined {
  const years: number[] = []

  const explicit = [
    /\bset\s+in\s+(?:the\s+)?(\d{4})s?\b/gi,
    /\btakes\s+place\s+in\s+(?:the\s+)?(\d{4})s?\b/gi,
    /\bin\s+the\s+year\s+(\d{4})\b/gi,
    /\b(?:april|may|june|july|january|february|march|august|september|october|november|december)\s+\d{1,2},?\s+(\d{4})\b/gi,
  ]

  for (const re of explicit) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const y = Number(m[1])
      if (y >= 1700 && y <= 2035) years.push(y)
    }
  }

  // Decade phrases: "1910s", "the 1920s"
  const decadeRe = /\b(?:the\s+)?(\d{3})0s\b/gi
  let dm: RegExpExecArray | null
  while ((dm = decadeRe.exec(text)) !== null) {
    const y = Number(`${dm[1]}0`)
    if (y >= 1700 && y <= 2030) years.push(y + 5) // mid-decade
  }

  // Fallback: any year in plot, but prefer historical if mixed with modern
  if (years.length === 0) {
    const anyYear = /\b(1[8-9]\d{2}|20[0-2]\d)\b/g
    let m: RegExpExecArray | null
    while ((m = anyYear.exec(text)) !== null) {
      years.push(Number(m[1]))
    }
  }

  if (years.length === 0) return undefined
  years.sort((a, b) => a - b)
  if (years.length >= 2 && years[years.length - 1] - years[0] >= 40) {
    return years[0]
  }
  return years[0]
}

function detectTone(text: string): StoryTone {
  const t = text.toLowerCase()
  if (/\b(horror|haunted|demon|zombie|slash|terrify)\b/.test(t)) return 'horror'
  if (/\b(comedy|hilarious|laugh|romcom|romantic comedy)\b/.test(t)) return 'comedy'
  if (/\b(thrill|suspense|assassin|espionage|chase)\b/.test(t)) return 'thriller'
  if (
    /\b(tragic|tragedy|dies?|death|drown|grief|heartbreak|disaster|shipwreck|massacre|doomed)\b/.test(
      t,
    )
  ) {
    return 'tragedy'
  }
  if (/\b(feel-?good|uplifting|heartwarming|wholesome)\b/.test(t)) return 'feelgood'
  return 'neutral'
}

/**
 * Build story signals from title + plot (+ optional production country as weak geo hint).
 */
export function extractStorySignals(input: {
  title: string
  plot: string
  releaseYear?: string
  country?: string
}): StorySignals {
  const text = `${input.title} ${input.plot}`
  const storyYear = extractStoryYear(text)
  const tone = detectTone(text)
  const hasFlashbacks =
    /\b(flashback|present day|years later|looking back|recount|framed)\b/i.test(text)
  const isTeenFocused =
    /\b(teen|teenager|high school|coming of age|adolescent)\b/i.test(text)

  const geoHints: string[] = []
  const placeTypeHints: string[] = []

  for (const cue of GEO_CUES) {
    if (cue.re.test(text)) geoHints.push(...cue.hints)
  }
  for (const cue of PLACE_TYPE_CUES) {
    if (cue.re.test(text)) placeTypeHints.push(...cue.hints)
  }

  // Weak geo from production country only if plot gave nothing
  if (geoHints.length === 0 && input.country) {
    const parts = input.country.split(',').map((p) => p.trim().toLowerCase())
    for (const part of parts) {
      if (part.includes('united kingdom') || part === 'uk') geoHints.push('UK', 'Europe')
      else if (part.includes('united states') || part === 'usa') geoHints.push('United States')
      else if (part.includes('france')) geoHints.push('France', 'Europe')
      else if (part.includes('germany')) geoHints.push('Germany', 'Europe')
      else if (part.includes('japan')) geoHints.push('Japan', 'Asia')
      else if (part.includes('canada')) geoHints.push('Canada')
      else if (part.includes('mexico')) geoHints.push('Mexico')
      else if (part.includes('australia')) geoHints.push('Oceania')
      else if (part.length > 2) geoHints.push(part)
    }
  }

  const themeHints: StorySignals['themeHints'] = []
  for (const cue of THEME_CUES) {
    if (cue.re.test(text)) themeHints.push({ match: cue.match, weight: cue.weight })
  }

  // Tone-driven themes/moods
  if (tone === 'tragedy') {
    themeHints.push(
      { match: 'Tear Jerkers', weight: 40 },
      { match: 'Heartrending', weight: 40 },
      { match: 'Tragic Events', weight: 35 },
      { match: 'Suspensful', weight: 28 },
      { match: 'Thrilling', weight: 26 },
    )
  }
  if (tone === 'thriller') {
    themeHints.push(
      { match: 'Suspensful', weight: 38 },
      { match: 'Thrilling', weight: 36 },
      { match: 'Tension', weight: 30 },
    )
  }
  if (tone === 'horror') {
    themeHints.push(
      { match: 'Scary', weight: 40 },
      { match: 'Horrifying', weight: 38 },
      { match: 'Terror', weight: 35 },
    )
  }
  if (tone === 'comedy' || tone === 'feelgood') {
    themeHints.push(
      { match: 'Feel-good', weight: 36 },
      { match: 'Hillarious', weight: 30 },
    )
  }
  if (hasFlashbacks) {
    themeHints.push({ match: 'Flashbacks', weight: 48 })
  }

  const releaseY = parseYearString(input.releaseYear)
  if (storyYear != null && releaseY != null && releaseY - storyYear >= 40) {
    themeHints.push(
      { match: 'Historical drama', weight: 48 },
      { match: 'Back in history', weight: 32 },
    )
  }

  return {
    storyYear,
    storyDecade: storyYear != null ? decadeLabel(storyYear) : undefined,
    hasFlashbacks,
    isTeenFocused,
    tone,
    geoHints: [...new Set(geoHints)],
    placeTypeHints: [...new Set(placeTypeHints)],
    themeHints,
  }
}

export function parseYearString(year?: string): number | undefined {
  if (!year) return undefined
  const m = year.match(/\d{4}/)
  return m ? Number(m[0]) : undefined
}

export function decadeFromYear(year: number): string {
  return decadeLabel(year)
}

/** Coarse production-country → setting names (never city children). */
export const COARSE_COUNTRY_SETTINGS: Record<string, string[]> = {
  usa: ['United States'],
  'united states': ['United States'],
  'united states of america': ['United States'],
  uk: ['UK', 'Europe'],
  'united kingdom': ['UK', 'Europe'],
  britain: ['UK', 'Europe'],
  england: ['UK', 'Europe'],
  france: ['France', 'Europe'],
  germany: ['Germany', 'Europe'],
  italy: ['Italy', 'Europe'],
  spain: ['Spain', 'Europe'],
  japan: ['Japan', 'Asia'],
  china: ['China', 'Asia'],
  india: ['India', 'Asia'],
  canada: ['Canada'],
  australia: ['Oceania'],
  mexico: ['Mexico'],
  brazil: ['Brasil'],
  brasil: ['Brasil'],
  sweden: ['Sweden', 'Nordic Scenery'],
  norway: ['Norway', 'Nordic Scenery'],
  denmark: ['Denmark', 'Nordic Scenery'],
  finland: ['Finland', 'Nordic Scenery'],
  iceland: ['Iceland', 'Nordic Scenery'],
  russia: ['Russia'],
  ireland: ['Ireland'],
  poland: ['Poland'],
  egypt: ['Egypt'],
  'south africa': ['South Africa'],
  'south korea': ['South Korea'],
  korea: ['South Korea'],
}
