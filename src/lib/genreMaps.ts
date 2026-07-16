/**
 * Genre → precision theme boosts for Characteristics.
 * Match against keyword NAME or last path segments only — never broad parents
 * like Fantasy / History / War and Military that fan out to every leaf.
 */
export interface GenreBoost {
  /** Themes to match against keyword name / last path segments */
  themes: string[]
  weight: number
  /** If set, at least one of these plot tokens must appear to apply this boost */
  requiresPlotTokens?: string[]
}

export const AVAILABLE_GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Biography',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Kids',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Sport',
  'Thriller',
  'War',
  'Western',
] as const

export type GenreName = (typeof AVAILABLE_GENRES)[number]

/** Legacy path-based boosts — used for Mood / soft category flavour only. */
export const GENRE_BOOSTS: Record<
  GenreName,
  Array<{ pathIncludes: string[]; weight: number }>
> = {
  Action: [
    { pathIncludes: ['Thrilling', 'Adventurous', 'Dangerous', 'Excitment', 'Heroism'], weight: 12 },
  ],
  Adventure: [
    { pathIncludes: ['Adventurous', 'Excitment', 'Fearless'], weight: 10 },
  ],
  Animation: [
    { pathIncludes: ['Childish', 'Imaginative', 'Playful', 'Wacky', 'Cheerful'], weight: 12 },
  ],
  Biography: [
    { pathIncludes: ['Insightful', 'Inspring'], weight: 10 },
  ],
  Comedy: [
    { pathIncludes: ['Hillarious', 'LOL', 'Playful', 'Wacky', 'Feel-good', 'Cheesy'], weight: 14 },
  ],
  Crime: [
    { pathIncludes: ['Suspensful', 'Mysterious', 'Tension', 'Dark'], weight: 10 },
  ],
  Documentary: [
    { pathIncludes: ['Insightful', 'Inspring', 'Relaxing'], weight: 10 },
  ],
  Drama: [
    { pathIncludes: ['Tear Jerkers', 'Heartrending', 'Dramatic', 'Grieving'], weight: 14 },
  ],
  Family: [
    { pathIncludes: ['Feel-good', 'Sweet', 'Uplifting', 'Kindness'], weight: 12 },
  ],
  Fantasy: [
    { pathIncludes: ['Imaginative', 'Playful', 'Adventurous'], weight: 10 },
  ],
  History: [
    { pathIncludes: ['Insightful', 'Dramatic'], weight: 8 },
  ],
  Horror: [
    { pathIncludes: ['Scary', 'Horrifying', 'Terror', 'Spooky'], weight: 14 },
  ],
  Kids: [
    { pathIncludes: ['Childish', 'Playful', 'Cheerful', 'Imaginative'], weight: 14 },
  ],
  Mystery: [
    { pathIncludes: ['Mysterious', 'Suspensful'], weight: 12 },
  ],
  Romance: [
    { pathIncludes: ['Feel-good', 'Sweet', 'Tear Jerkers', 'Heartrending'], weight: 10 },
  ],
  'Sci-Fi': [
    { pathIncludes: ['Thrilling', 'Surprising', 'Adventurous'], weight: 10 },
  ],
  Sport: [
    { pathIncludes: ['Challenging', 'Ambitious', 'Successful', 'Energizing'], weight: 8 },
  ],
  Thriller: [
    { pathIncludes: ['Suspensful', 'Tension', 'Shocking', 'Thrilling'], weight: 14 },
  ],
  War: [
    { pathIncludes: ['Traumatic', 'Dramatic', 'Heroism'], weight: 10 },
  ],
  Western: [
    { pathIncludes: ['Adventurous', 'Dangerous'], weight: 8 },
  ],
}

/**
 * Characteristics-only: precision themes. No Vampire/Mermaids/Werewolf auto-boost;
 * those need plot evidence via text match.
 */
export const CHARACTERISTICS_GENRE_BOOSTS: Record<GenreName, GenreBoost[]> = {
  Action: [
    {
      themes: ['Superhero', 'Vigilante', 'Car chases', 'Rescue Missions', 'Saving the day', 'Good vs Evil'],
      weight: 22,
      requiresPlotTokens: ['hero', 'superhero', 'chase', 'rescue', 'vigilante', 'villain'],
    },
    {
      themes: ['Special Forces', 'Soldier', 'Police Pursuits'],
      weight: 16,
      requiresPlotTokens: ['soldier', 'police', 'forces', 'military'],
    },
  ],
  Adventure: [
    {
      themes: ['Treasure Hunter', 'Roadtrip', 'Sea adventures', 'Pirate', 'Exploration'],
      weight: 20,
      requiresPlotTokens: ['treasure', 'pirate', 'voyage', 'quest', 'journey', 'explore'],
    },
  ],
  Animation: [
    {
      themes: ['Talking animals', 'Talking objects', 'Fairytales', 'Adult Animation'],
      weight: 18,
      requiresPlotTokens: ['animated', 'cartoon', 'talking'],
    },
  ],
  Biography: [
    {
      themes: ['Biography & autobiography', 'Inspired by true events', 'Historical drama'],
      weight: 22,
    },
  ],
  Comedy: [
    {
      themes: ['Parody', 'Dark humour', 'Pranks & Practical Jokes', 'Sitcom', 'Crime comedies'],
      weight: 18,
      requiresPlotTokens: ['comedy', 'comic', 'funny', 'parody', 'prank', 'sitcom'],
    },
  ],
  Crime: [
    {
      themes: ['Murder & Crime', 'Detective work and investigations', 'Mafia', 'Gangster', 'Whodunnit', 'Serial Killer'],
      weight: 22,
      requiresPlotTokens: ['murder', 'crime', 'detective', 'mafia', 'gangster', 'killer', 'thief'],
    },
  ],
  Documentary: [
    {
      themes: ['Documentary', 'Award winning documentaries', 'Dark Docu'],
      weight: 22,
      requiresPlotTokens: ['documentary', 'footage', 'real'],
    },
  ],
  Drama: [
    {
      themes: ['Love tragedy', 'Tragic Events', 'Class Difference', 'Historical drama', 'Intense life adversities'],
      weight: 20,
    },
  ],
  Family: [
    {
      themes: ['Orphan'],
      weight: 20,
      requiresPlotTokens: ['orphan', 'orphaned'],
    },
    {
      themes: ['Coming of age'],
      weight: 18,
      requiresPlotTokens: [
        'coming',
        'teenager',
        'adolescent',
        'teenage',
        'enrolls',
        'enroll',
        'discovers',
      ],
    },
    {
      themes: ['Parenthood'],
      weight: 18,
      requiresPlotTokens: ['parenthood', 'parenting', 'motherhood', 'fatherhood'],
    },
    {
      themes: ['Brothers and sisters'],
      weight: 18,
      requiresPlotTokens: ['sibling', 'brother', 'sister', 'siblings'],
    },
  ],
  Fantasy: [
    {
      themes: ['Magic'],
      weight: 24,
      requiresPlotTokens: ['magic', 'magical', 'spell', 'enchant'],
    },
    {
      themes: ['Wizardry'],
      weight: 24,
      requiresPlotTokens: ['wizard', 'wizards', 'wizardry'],
    },
    {
      themes: ['Witches'],
      weight: 24,
      requiresPlotTokens: ['witch', 'witches', 'witchcraft'],
    },
    {
      themes: ['Dragons'],
      weight: 22,
      requiresPlotTokens: ['dragon', 'dragons'],
    },
    {
      themes: ['Fairytales', 'Fairytales and stories'],
      weight: 18,
      requiresPlotTokens: ['fairytale', 'fairy', 'fairytales'],
    },
    {
      themes: ['Kingdom'],
      weight: 18,
      requiresPlotTokens: ['kingdom', 'prince', 'princess'],
    },
    {
      themes: ['Folklore & myths'],
      weight: 16,
      requiresPlotTokens: ['folklore', 'myth', 'myths', 'legend'],
    },
  ],
  History: [
    {
      themes: ['Historical drama', 'Medieval', 'Ancient', 'WWII', 'WWI'],
      weight: 22,
      requiresPlotTokens: ['historical', 'medieval', 'ancient', 'war', 'wwii', 'wwi', 'history'],
    },
  ],
  Horror: [
    {
      themes: ['Paranormal', 'Haunted House', 'Demons', 'Zombie', 'Exorcism', 'Occult'],
      weight: 22,
      requiresPlotTokens: ['haunt', 'ghost', 'demon', 'zombie', 'horror', 'exorcism', 'occult'],
    },
  ],
  Kids: [
    {
      themes: ["Kids' World", 'Talking animals', 'Games and fun', 'Friendly Monster'],
      weight: 18,
      requiresPlotTokens: ['kid', 'child', 'children', 'talking'],
    },
  ],
  Mystery: [
    {
      themes: ['Solving Mysteries', 'Murder Mystery', 'Whodunnit'],
      weight: 22,
      requiresPlotTokens: ['mystery', 'mysterious', 'whodunnit', 'clue', 'detective'],
    },
  ],
  Romance: [
    {
      themes: ['Love tragedy', 'Forbidden love/passion', 'Love triangles', 'Bittersweet romance', 'Love stories'],
      weight: 22,
      requiresPlotTokens: ['love', 'romance', 'romantic', 'lover', 'marriage', 'wedding'],
    },
  ],
  'Sci-Fi': [
    {
      themes: ['Aliens', 'Time travel', 'Artificial Intelligence', 'Robots and technology', 'Mind-boggling sci-fi'],
      weight: 22,
      requiresPlotTokens: ['alien', 'space', 'robot', 'future', 'ai', 'time travel', 'sci-fi'],
    },
  ],
  Sport: [
    {
      themes: ['Sport Fiction', 'Boxing', 'Coach', 'Racing'],
      weight: 20,
      requiresPlotTokens: ['sport', 'football', 'soccer', 'boxing', 'race', 'coach', 'athlete'],
    },
  ],
  Thriller: [
    {
      themes: ['Psychological thrillers', 'Mind Games', 'Spy', 'On the Run'],
      weight: 20,
      requiresPlotTokens: ['thriller', 'spy', 'assassin', 'fugitive', 'mind'],
    },
  ],
  War: [
    {
      themes: ['WWII', 'WWI', 'Battle', 'Soldier', 'Fictional War', 'Post-war burdens'],
      weight: 24,
      requiresPlotTokens: ['war', 'battle', 'soldier', 'wwii', 'wwi', 'army', 'combat'],
    },
  ],
  Western: [
    {
      themes: ['Western'],
      weight: 22,
      requiresPlotTokens: ['western', 'cowboy', 'frontier', 'outlaw'],
    },
  ],
}

/** Map OMDb / common genre strings onto our GenreName set. */
export function mapOmdbGenres(raw: string[]): GenreName[] {
  const found = new Set<GenreName>()
  for (const g of raw) {
    const lower = g.trim().toLowerCase()
    if (!lower) continue
    if (lower.includes('sci-fi') || lower.includes('science fiction')) {
      found.add('Sci-Fi')
      continue
    }
    if (lower.includes('sport')) {
      found.add('Sport')
      continue
    }
    if (lower.includes('children') || lower === 'kids') {
      found.add('Kids')
      continue
    }
    if (lower === 'family' || lower.includes('family')) {
      found.add('Family')
      continue
    }
    for (const known of AVAILABLE_GENRES) {
      if (known.toLowerCase() === lower) {
        found.add(known)
        break
      }
    }
  }
  return [...found]
}
