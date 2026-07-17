import { useCallback, useEffect, useMemo, useState } from 'react'
import { AVAILABLE_GENRES, type GenreName } from './lib/genreMaps'
import {
  hasOmdbKey,
  lookupMovie,
  lookupMovieByImdbId,
  type MovieCandidate,
  type MovieLookupResult,
} from './lib/lookupMovie'
import {
  buildAiCharacteristicsCandidates,
  mergeAiCategory,
  pickKeywordsForMovie,
  restoreLocalCategory,
  SOFT_MINIMUMS,
  AI_CATEGORY_LIMITS,
  type CategorySource,
  type PickResult,
  type SoftCategory,
} from './lib/pickKeywords'
import { pickCategoryWithLlm } from './lib/llmCharacteristics'
import {
  clearUsageHistory,
  formatTokens,
  getUsageSnapshot,
  setFreeTierLimits,
  type UsageSnapshot,
} from './lib/geminiUsage'
import {
  formatKeywordWithWeight,
  normalizeWeightsTo100,
  sumWeights,
  WEIGHT_TOTAL,
} from './lib/weights'
import { groupByCategory, searchKeywords } from './lib/suggest'
import { getPickReason } from './lib/plotEvidence'
import type {
  CopyFormat,
  KeywordEntry,
  KeywordsSpace,
  ScoredKeyword,
} from './lib/types'

const CATEGORY_ORDER = ['Characteristics', 'Mood', 'Setting', 'Period'] as const
const USAGE_TAB = 'API Usage' as const
type MainTab = (typeof CATEGORY_ORDER)[number] | typeof USAGE_TAB

export default function App() {
  const [space, setSpace] = useState<KeywordsSpace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [extraGenres, setExtraGenres] = useState<GenreName[]>([])

  const [movie, setMovie] = useState<MovieLookupResult | null>(null)
  const [candidates, setCandidates] = useState<MovieCandidate[]>([])
  const [suggestions, setSuggestions] = useState<ScoredKeyword[]>([])
  const [selected, setSelected] = useState<Map<string, ScoredKeyword>>(new Map())
  const [activeTab, setActiveTab] = useState<MainTab>('Characteristics')
  const [searchQuery, setSearchQuery] = useState('')
  const [copyFormat, setCopyFormat] = useState<CopyFormat>('newline')
  const [copyFlash, setCopyFlash] = useState(false)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [showFullPlot, setShowFullPlot] = useState(false)
  const [categorySources, setCategorySources] = useState<
    Record<SoftCategory, CategorySource>
  >({
    Characteristics: 'local',
    Mood: 'local',
    Setting: 'local',
    Period: 'local',
  })
  const [refiningAi, setRefiningAi] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [localPickResult, setLocalPickResult] = useState<PickResult | null>(null)
  const [displayPickResult, setDisplayPickResult] = useState<PickResult | null>(
    null,
  )
  const [pickFloors, setPickFloors] = useState<{
    Characteristics: number
    Mood: number
    Setting: number
    Period: number
  }>(SOFT_MINIMUMS)
  const [usageSnap, setUsageSnap] = useState<UsageSnapshot>(() =>
    getUsageSnapshot(),
  )
  const [limitDraftRpd, setLimitDraftRpd] = useState(String(usageSnap.limits.rpd))
  const [limitDraftRpm, setLimitDraftRpm] = useState(String(usageSnap.limits.rpm))

  const isUsageTab = activeTab === USAGE_TAB
  const activeCategory = (
    isUsageTab ? 'Characteristics' : activeTab
  ) as SoftCategory

  const refreshUsage = useCallback(() => {
    const snap = getUsageSnapshot()
    setUsageSnap(snap)
    setLimitDraftRpd(String(snap.limits.rpd))
    setLimitDraftRpm(String(snap.limits.rpm))
  }, [])

  useEffect(() => {
    if (isUsageTab) refreshUsage()
  }, [isUsageTab, refreshUsage])

  useEffect(() => {
    fetch('/keywords-space.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load keywords (${res.status})`)
        return res.json() as Promise<KeywordsSpace>
      })
      .then(setSpace)
      .catch((err: Error) => setLoadError(err.message))
  }, [])

  const searchResults = useMemo(() => {
    if (!space || !searchQuery.trim()) return []
    return searchKeywords(space.keywords, searchQuery)
  }, [space, searchQuery])

  const groupedSuggestions = useMemo(
    () => groupByCategory(suggestions, [...CATEGORY_ORDER]),
    [suggestions],
  )

  const applyResultToUi = useCallback(
    (lookedUp: MovieLookupResult, result: PickResult, opts?: { keepTab?: boolean }) => {
      setDisplayPickResult(result)
      setSuggestions(result.picked)
      setSelected(new Map(result.picked.map((k) => [k.id, k])))
      setHasGenerated(true)
      if (!opts?.keepTab) setActiveTab('Characteristics')
      setMovie(lookedUp)
      setCandidates(lookedUp.candidates ?? [])
      setShowFullPlot(false)
      setCategorySources(
        result.categorySources ?? {
          Characteristics: 'local',
          Mood: 'local',
          Setting: 'local',
          Period: 'local',
        },
      )
      setPickFloors(result.floors)
    },
    [],
  )

  /** Local scorer only — AI is opt-in per tab. */
  const applyPick = useCallback(
    (lookedUp: MovieLookupResult, keywords: KeywordEntry[]) => {
      const local = pickKeywordsForMovie(keywords, lookedUp, { extraGenres })
      setLocalPickResult(local)
      setDisplayPickResult(local)
      setAiError(null)
      applyResultToUi(lookedUp, local)
    },
    [extraGenres, applyResultToUi],
  )

  const improveActiveCategoryWithAi = useCallback(async () => {
    if (!movie || !localPickResult || !displayPickResult) return
    const category = activeCategory
    const shortlist =
      category === 'Characteristics' && space?.keywords?.length
        ? buildAiCharacteristicsCandidates(space.keywords)
        : (localPickResult.categoryShortlists?.[category] ??
          (category === 'Characteristics'
            ? localPickResult.characteristicsShortlist
            : undefined) ??
          [])
    if (shortlist.length === 0) {
      setAiError(`No ${category} candidates available for AI.`)
      return
    }

    setRefiningAi(true)
    setAiError(null)
    try {
      const aiPicks = await pickCategoryWithLlm({
        movie,
        category,
        shortlist,
        genres: localPickResult.movieGenres,
        keywords: space?.keywords,
      })
      const merged = mergeAiCategory(displayPickResult, category, aiPicks)
      applyResultToUi(movie, merged, { keepTab: true })
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : `${category} AI failed — local picks kept.`,
      )
    } finally {
      setRefiningAi(false)
      refreshUsage()
    }
  }, [
    movie,
    localPickResult,
    displayPickResult,
    activeCategory,
    applyResultToUi,
    space?.keywords,
    refreshUsage,
  ])

  const restoreActiveCategoryLocal = useCallback(() => {
    if (!movie || !localPickResult || !displayPickResult) return
    setAiError(null)
    const restored = restoreLocalCategory(
      displayPickResult,
      localPickResult,
      activeCategory,
    )
    applyResultToUi(movie, restored, { keepTab: true })
  }, [movie, localPickResult, displayPickResult, activeCategory, applyResultToUi])

  const runGenerate = async () => {
    if (!space || !title.trim()) return
    setLoading(true)
    setLookupError(null)
    setCandidates([])
    setRefiningAi(false)
    setAiError(null)
    try {
      const lookedUp = await lookupMovie(title.trim(), year.trim() || undefined)
      if (lookedUp.candidates && lookedUp.candidates.length > 1 && !lookedUp.plot) {
        setCandidates(lookedUp.candidates)
        setMovie(null)
        setSuggestions([])
        setHasGenerated(false)
        setLocalPickResult(null)
        setDisplayPickResult(null)
        setLookupError('Several matches found — pick the correct title.')
        setLoading(false)
        return
      }
      applyPick(lookedUp, space.keywords)
      setLoading(false)
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
      setMovie(null)
      setSuggestions([])
      setHasGenerated(false)
      setLocalPickResult(null)
      setDisplayPickResult(null)
      setLoading(false)
    }
  }

  const chooseCandidate = async (candidate: MovieCandidate) => {
    if (!space) return
    setLoading(true)
    setLookupError(null)
    setRefiningAi(false)
    setAiError(null)
    try {
      let lookedUp: MovieLookupResult
      if (candidate.imdbID && hasOmdbKey()) {
        lookedUp = await lookupMovieByImdbId(candidate.imdbID)
      } else {
        lookedUp = await lookupMovie(candidate.title, candidate.year)
      }
      setCandidates([])
      applyPick(lookedUp, space.keywords)
      setLoading(false)
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
      setLoading(false)
    }
  }

  const toggleGenre = (genre: GenreName) => {
    setExtraGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    )
  }

  const toggleSelect = (entry: KeywordEntry | ScoredKeyword) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(entry.id)) next.delete(entry.id)
      else {
        const scored = entry as ScoredKeyword
        next.set(entry.id, {
          ...entry,
          score: scored.score ?? 0,
          reasons: scored.reasons ?? [],
          weight: scored.weight,
        })
      }
      return next
    })
  }

  const selectAllVisible = (items: Array<KeywordEntry | ScoredKeyword>) => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const item of items) {
        const scored = item as ScoredKeyword
        next.set(item.id, {
          ...item,
          score: scored.score ?? 0,
          reasons: scored.reasons ?? [],
          weight: scored.weight,
        })
      }
      return next
    })
  }

  const copySelected = useCallback(async () => {
    const lines = [...selected.values()].map((k) => formatKeywordWithWeight(k))
    if (lines.length === 0) return
    const text = copyFormat === 'comma' ? lines.join(', ') : lines.join('\n')
    await navigator.clipboard.writeText(text)
    setCopyFlash(true)
    window.setTimeout(() => setCopyFlash(false), 1600)
  }, [selected, copyFormat])

  const clearSelection = () => setSelected(new Map())

  /** Tweak one keyword weight in the selection map. */
  const updateWeight = (id: string, raw: number) => {
    setSelected((prev) => {
      const current = prev.get(id)
      if (!current) return prev
      const next = new Map(prev)
      next.set(id, { ...current, weight: Math.max(0, Math.floor(raw) || 0) })
      return next
    })
  }

  /** Re-normalize selected weights for a category so they sum to 100. */
  const renormSelectedCategory = (category: SoftCategory) => {
    setSelected((prev) => {
      const inCat = [...prev.values()].filter((k) => k.category === category)
      if (inCat.length === 0) return prev
      if (
        category === 'Characteristics' &&
        inCat.length !== SOFT_MINIMUMS.Characteristics
      ) {
        return prev
      }
      const normalized = normalizeWeightsTo100(inCat, (item) =>
        item.weight != null && item.weight > 0 ? item.weight : 1,
      )
      const next = new Map(prev)
      for (const item of normalized) next.set(item.id, item)

      setSuggestions((sug) =>
        sug.map((s) => {
          const n = normalized.find((x) => x.id === s.id)
          return n ? { ...s, weight: n.weight } : s
        }),
      )
      setDisplayPickResult((cur) => {
        if (!cur) return cur
        const byCategory = { ...cur.byCategory }
        byCategory[category] = (byCategory[category] ?? []).map((s) => {
          const n = normalized.find((x) => x.id === s.id)
          return n ? { ...s, weight: n.weight } : s
        })
        return {
          ...cur,
          byCategory,
          picked: [
            ...(byCategory.Characteristics ?? []),
            ...(byCategory.Mood ?? []),
            ...(byCategory.Setting ?? []),
            ...(byCategory.Period ?? []),
          ],
        }
      })
      return next
    })
  }

  const watermark = (
    <div className="watermark" aria-hidden="true">
      <div className="watermark-track">
        <img src="/watermark/selfie.png" alt="" />
        <img src="/watermark/cat-cone.png" alt="" />
        <img src="/watermark/cat-cuddle.png" alt="" />
        <img src="/watermark/kitten.png" alt="" />
        <img src="/watermark/selfie.png" alt="" />
      </div>
    </div>
  )

  if (loadError) {
    return (
      <>
        {watermark}
        <div className="shell">
          <p className="error">Could not load keyword space: {loadError}</p>
          <p className="hint">
            Run <code>npm run parse-keywords</code> then restart the dev server.
          </p>
        </div>
      </>
    )
  }

  if (!space) {
    return (
      <>
        {watermark}
        <div className="shell">
          <p className="muted">Loading keyword space…</p>
        </div>
      </>
    )
  }

  const tabItems = groupedSuggestions[activeTab] ?? []
  const omdbReady = hasOmdbKey()
  const activeSource = categorySources[activeCategory]
  const activeShortlist =
    activeCategory === 'Characteristics' && space.keywords.length > 0
      ? buildAiCharacteristicsCandidates(space.keywords)
      : (localPickResult?.categoryShortlists?.[activeCategory] ??
        (activeCategory === 'Characteristics'
          ? localPickResult?.characteristicsShortlist
          : undefined) ??
        [])

  const floorForCategory = (cat: SoftCategory) =>
    categorySources[cat] === 'ai'
      ? AI_CATEGORY_LIMITS[cat].min
      : pickFloors[cat]

  return (
    <>
      {watermark}
      <div className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">Simply.TV editorial helper</p>
          <h1>Keyword Helper</h1>
          <p className="lede">
            Enter a movie title — we look it up and pick keywords from your space
            for <span className="mono">editorial.simply.tv</span>
          </p>
        </div>
        <div className="meta">
          <span>{space.stats.selectableKeywords} keywords</span>
          <span className={omdbReady ? 'ok' : 'warn'}>
            {omdbReady ? 'OMDb connected' : 'Wikipedia fallback (add OMDb key)'}
          </span>
        </div>
      </header>

      <div className="layout">
        <aside className="panel inputs">
          <label className="field">
            <span>Movie title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Silence of the Lambs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runGenerate()
              }}
            />
          </label>

          <label className="field">
            <span>Year (optional)</span>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 1991"
              inputMode="numeric"
            />
          </label>

          <button
            type="button"
            className="primary"
            onClick={() => void runGenerate()}
            disabled={!title.trim() || loading}
          >
            {loading ? 'Looking up…' : 'Generate keywords'}
          </button>

          {lookupError && <p className="error tight">{lookupError}</p>}

          {candidates.length > 0 && (
            <div className="candidates">
              <p className="field-label">Pick the correct film</p>
              {candidates.map((c) => (
                <button
                  key={c.imdbID ?? `${c.title}-${c.year}`}
                  type="button"
                  className="candidate"
                  onClick={() => void chooseCandidate(c)}
                  disabled={loading}
                >
                  <strong>{c.title}</strong>
                  <span>{c.year}</span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="ghost linkish"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide advanced' : 'Advanced overrides'}
          </button>

          {showAdvanced && (
            <div className="field">
              <span>Extra genre boosts</span>
              <div className="genre-grid">
                {AVAILABLE_GENRES.map((genre) => {
                  const on = extraGenres.includes(genre)
                  return (
                    <button
                      key={genre}
                      type="button"
                      className={on ? 'chip on' : 'chip'}
                      onClick={() => toggleGenre(genre)}
                    >
                      {genre}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="divider" />

          <label className="field">
            <span>Search full keyword space</span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Add anything the auto-pick missed…"
            />
          </label>

          {searchResults.length > 0 && (
            <div className="search-list">
              {searchResults.map((item) => (
                <label key={item.id} className="row">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item)}
                  />
                  <span className="row-body">
                    <strong>{item.name}</strong>
                    <small>{item.pathLabel}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </aside>

        <main className="panel results">
          {movie && (
            <article className="movie-card">
              {movie.poster && (
                <img src={movie.poster} alt="" className="poster" />
              )}
              <div className="movie-body">
                <h2>
                  {movie.title}
                  {movie.year ? <span className="year"> ({movie.year})</span> : null}
                </h2>
                <p className="movie-meta">
                  via {movie.source === 'omdb' ? 'IMDb (OMDb)' : 'Wikipedia'}
                  {movie.genres.length > 0 && ` · ${movie.genres.join(', ')}`}
                  {movie.country && ` · ${movie.country}`}
                  {movie.plotSource && (
                    <>
                      {' · '}
                      <span className="plot-badge">
                        {movie.plotSource === 'wikipedia-plot'
                          ? 'Plot: Wikipedia'
                          : movie.plotSource === 'wikipedia-summary'
                            ? 'Plot: Wikipedia summary'
                            : 'Plot: OMDb'}
                      </span>
                    </>
                  )}
                </p>
                {(() => {
                  const short = movie.plotShort || movie.plot
                  const full = movie.plot
                  const hasLonger =
                    Boolean(full) &&
                    Boolean(short) &&
                    full !== short &&
                    full.length > short.length
                  const display = showFullPlot && hasLonger ? full : short
                  if (!display) return null
                  return (
                    <div className="plot-block">
                      <p className={showFullPlot && hasLonger ? 'plot plot-expanded' : 'plot'}>
                        {display}
                      </p>
                      {hasLonger && (
                        <button
                          type="button"
                          className="plot-toggle"
                          onClick={() => setShowFullPlot((v) => !v)}
                        >
                          {showFullPlot ? 'Show short synopsis' : 'Full plot (Wikipedia)'}
                        </button>
                      )}
                    </div>
                  )
                })()}
                <div className="movie-links">
                  {movie.imdbUrl && (
                    <a href={movie.imdbUrl} target="_blank" rel="noreferrer">
                      Open on IMDb
                    </a>
                  )}
                  {movie.wikipediaUrl && (
                    <a href={movie.wikipediaUrl} target="_blank" rel="noreferrer">
                      Wikipedia
                    </a>
                  )}
                </div>
              </div>
            </article>
          )}

          <div className="tabs">
            {CATEGORY_ORDER.map((cat) => {
              const softCat = cat as SoftCategory
              const count = groupedSuggestions[cat]?.length ?? 0
              const min = floorForCategory(softCat)
              const isAi = categorySources[softCat] === 'ai'
              return (
                <button
                  key={cat}
                  type="button"
                  className={activeTab === cat ? 'tab on' : 'tab'}
                  onClick={() => setActiveTab(cat)}
                >
                  {cat}
                  {isAi && <span className="tab-ai-dot" title="AI picks">AI</span>}
                  <em>
                    {count} / min {min}
                  </em>
                </button>
              )
            })}
            <button
              type="button"
              className={isUsageTab ? 'tab on' : 'tab'}
              onClick={() => setActiveTab(USAGE_TAB)}
              title="Gemini free-tier usage"
            >
              {USAGE_TAB}
              <em>
                {usageSnap.requestsLeftToday}/{usageSnap.limits.rpd} left
              </em>
            </button>
          </div>

          {hasGenerated && !isUsageTab && (
            <div className="chars-actions tab-ai-bar">
              <p className="chars-status">
                <span
                  className={
                    activeSource === 'ai' ? 'chars-badge ai' : 'chars-badge local'
                  }
                >
                  {activeCategory}: {activeSource === 'ai' ? 'AI' : 'local'}
                </span>
                {refiningAi && (
                  <span className="chars-refining">Asking AI…</span>
                )}
              </p>
              <div className="chars-buttons">
                <button
                  type="button"
                  className="primary chars-ai-btn"
                  onClick={() => void improveActiveCategoryWithAi()}
                  disabled={
                    refiningAi || loading || activeShortlist.length === 0
                  }
                >
                  {refiningAi
                    ? 'Improving…'
                    : `Improve ${activeCategory} with AI`}
                </button>
                {activeSource === 'ai' && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={restoreActiveCategoryLocal}
                    disabled={refiningAi || !localPickResult}
                  >
                    Restore local {activeCategory}
                  </button>
                )}
              </div>
              {aiError && <p className="chars-error">{aiError}</p>}
            </div>
          )}

          {isUsageTab ? (
            <section className="usage-panel">
              <p className="usage-lede">
                Tracks Gemini calls from this browser only (free-tier estimate).
                Match the daily/minute limits to your{' '}
                <a
                  href="https://aistudio.google.com/rate-limit"
                  target="_blank"
                  rel="noreferrer"
                >
                  AI Studio rate limits
                </a>
                . Do not enable billing if you want to stay on free tokens.
              </p>

              <div className="usage-meters">
                <div className="usage-meter">
                  <h3>Requests today (RPD)</h3>
                  <p className="usage-big">
                    <strong>{usageSnap.day.requests}</strong>
                    <span> / {usageSnap.limits.rpd}</span>
                  </p>
                  <p className="usage-left">
                    <strong>{usageSnap.requestsLeftToday}</strong> left today
                  </p>
                  <div
                    className="usage-bar"
                    role="progressbar"
                    aria-valuenow={usageSnap.day.requests}
                    aria-valuemax={usageSnap.limits.rpd}
                  >
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          (usageSnap.day.requests / usageSnap.limits.rpd) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                  <small className="muted">{usageSnap.resetHint}</small>
                </div>

                <div className="usage-meter">
                  <h3>Last minute (RPM)</h3>
                  <p className="usage-big">
                    <strong>{usageSnap.requestsLastMinute}</strong>
                    <span> / {usageSnap.limits.rpm}</span>
                  </p>
                  <p className="usage-left">
                    <strong>{usageSnap.rpmLeft}</strong> left this minute
                  </p>
                  <div
                    className="usage-bar"
                    role="progressbar"
                    aria-valuenow={usageSnap.requestsLastMinute}
                    aria-valuemax={usageSnap.limits.rpm}
                  >
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          (usageSnap.requestsLastMinute / usageSnap.limits.rpm) *
                            100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="usage-meter">
                  <h3>Tokens today</h3>
                  <p className="usage-big">
                    <strong>{formatTokens(usageSnap.day.totalTokens)}</strong>
                  </p>
                  <p className="muted usage-token-split">
                    in {formatTokens(usageSnap.day.promptTokens)} · out{' '}
                    {formatTokens(usageSnap.day.candidatesTokens)}
                    {usageSnap.day.errors > 0
                      ? ` · ${usageSnap.day.errors} failed`
                      : ''}
                  </p>
                  <small className="muted">
                    Pacific day key: {usageSnap.dayKey}
                  </small>
                </div>
              </div>

              <div className="usage-limits">
                <h3>Assumed free limits</h3>
                <p className="muted">
                  Defaults are conservative Flash-Lite ballparks. Edit to match
                  AI Studio for your project.
                </p>
                <div className="usage-limit-row">
                  <label>
                    RPD
                    <input
                      type="number"
                      min={1}
                      value={limitDraftRpd}
                      onChange={(e) => setLimitDraftRpd(e.target.value)}
                    />
                  </label>
                  <label>
                    RPM
                    <input
                      type="number"
                      min={1}
                      value={limitDraftRpm}
                      onChange={(e) => setLimitDraftRpm(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      const next = setFreeTierLimits({
                        rpd: Number(limitDraftRpd),
                        rpm: Number(limitDraftRpm),
                      })
                      setUsageSnap(next)
                    }}
                  >
                    Save limits
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Clear local AI usage history for this browser?',
                        )
                      ) {
                        return
                      }
                      setUsageSnap(clearUsageHistory())
                    }}
                  >
                    Clear history
                  </button>
                </div>
              </div>

              <div className="usage-history">
                <h3>Per try</h3>
                {usageSnap.history.length === 0 ? (
                  <p className="empty">
                    No AI calls yet. Use Improve … with AI on a category tab.
                  </p>
                ) : (
                  <ul className="usage-log">
                    {usageSnap.history.map((ev) => (
                      <li key={ev.id} className={ev.ok ? 'ok' : 'fail'}>
                        <div className="usage-log-main">
                          <strong>{ev.title}</strong>
                          <span className="usage-log-meta">
                            {ev.category}
                            {ev.model ? ` · ${ev.model}` : ''}
                            {' · '}
                            {new Date(ev.at).toLocaleString()}
                          </span>
                        </div>
                        <div className="usage-log-stats">
                          {ev.ok ? (
                            <>
                              <span>
                                {ev.totalTokens.toLocaleString()} tok
                                <small>
                                  {' '}
                                  (in {ev.promptTokens.toLocaleString()} / out{' '}
                                  {ev.candidatesTokens.toLocaleString()})
                                </small>
                              </span>
                              <span>
                                {ev.attempts} HTTP attempt
                                {ev.attempts === 1 ? '' : 's'}
                              </span>
                            </>
                          ) : (
                            <span className="usage-fail-msg">
                              Failed
                              {ev.error ? `: ${ev.error}` : ''}
                              {ev.attempts > 1
                                ? ` · ${ev.attempts} attempts`
                                : ''}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : !hasGenerated ? (
            <p className="empty">
              Enter a title and click Generate for local picks. Switch tabs to
              review each category; use <strong>Improve … with AI</strong> on
              any tab when you want Gemini to re-pick that category.
            </p>
          ) : tabItems.length === 0 ? (
            <p className="empty">No keywords in {activeTab}.</p>
          ) : (
            <>
              <div className="list-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => selectAllVisible(tabItems)}
                >
                  Select all in tab
                </button>
                {(() => {
                  const catItems = [...selected.values()].filter(
                    (k) => k.category === activeCategory,
                  )
                  const wSum = sumWeights(catItems)
                  const needEight =
                    activeCategory === 'Characteristics' &&
                    catItems.length !== SOFT_MINIMUMS.Characteristics
                  return (
                    <span
                      className={
                        wSum === WEIGHT_TOTAL && !needEight
                          ? 'weight-sum ok'
                          : 'weight-sum warn'
                      }
                    >
                      Weights: {wSum}/{WEIGHT_TOTAL}
                      {needEight
                        ? ` (need ${SOFT_MINIMUMS.Characteristics} Characteristics)`
                        : ''}
                    </span>
                  )
                })()}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => renormSelectedCategory(activeCategory)}
                  title="Rebalance selected weights in this category to sum 100"
                >
                  Normalize to 100
                </button>
              </div>
              <div className="kw-list">
                {tabItems.map((item) => {
                  const scored = item as ScoredKeyword
                  const pickReason = getPickReason(scored.reasons)
                  const selectedItem = selected.get(item.id)
                  const weight =
                    selectedItem?.weight ?? scored.weight
                  return (
                    <label key={item.id} className="row">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item)}
                      />
                      <span className="row-body">
                        <strong>{item.name}</strong>
                        <small>{item.pathLabel}</small>
                        {pickReason && (
                          <small className="pick-reason">
                            {pickReason.text}
                          </small>
                        )}
                      </span>
                      <span
                        className="weight-cell"
                        onClick={(e) => e.preventDefault()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {selected.has(item.id) ? (
                          <input
                            type="number"
                            className="weight-input"
                            min={0}
                            max={100}
                            value={weight ?? 0}
                            aria-label={`Weight for ${item.name}`}
                            onChange={(e) =>
                              updateWeight(item.id, Number(e.target.value))
                            }
                            onBlur={() =>
                              renormSelectedCategory(activeCategory)
                            }
                          />
                        ) : (
                          <span className="weight-badge" title="Weight">
                            {weight ?? '—'}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="sticky-bar">
        <div className="sel-info">
          <strong>{selected.size}</strong> selected
          {hasGenerated && (
            <span className="preview floors">
              {CATEGORY_ORDER.map((cat) => {
                const softCat = cat as SoftCategory
                const items = [...selected.values()].filter(
                  (k) => k.category === cat,
                )
                const n = items.length
                const min = floorForCategory(softCat)
                const tag = categorySources[softCat] === 'ai' ? '*' : ''
                const w = sumWeights(items)
                return `${cat.slice(0, 4)} ${n}/${min}${tag} w${w}`
              }).join(' · ')}
            </span>
          )}
        </div>
        <div className="bar-actions">
          <label className="format">
            Copy as
            <select
              value={copyFormat}
              onChange={(e) => setCopyFormat(e.target.value as CopyFormat)}
            >
              <option value="newline">one per line</option>
              <option value="comma">comma-separated</option>
            </select>
          </label>
          <button
            type="button"
            className="ghost"
            onClick={clearSelection}
            disabled={selected.size === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void copySelected()}
            disabled={selected.size === 0}
          >
            {copyFlash ? 'Copied!' : 'Copy selected'}
          </button>
        </div>
      </footer>
    </div>
    </>
  )
}
