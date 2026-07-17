/**
 * Client-side Gemini free-tier usage tracker (localStorage).
 * Google does not expose remaining quota via the generate API — we estimate
 * from configurable free limits (match AI Studio) minus calls this browser made.
 */

export interface FreeTierLimits {
  /** Assumed free requests per day (RPD). Reset midnight Pacific. */
  rpd: number
  /** Assumed free requests per minute (RPM). */
  rpm: number
}

export interface GeminiUsageMeta {
  model: string
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
  attempts: number
}

export interface UsageEvent {
  id: string
  at: string
  title: string
  category: string
  ok: boolean
  model?: string
  promptTokens: number
  candidatesTokens: number
  totalTokens: number
  attempts: number
  error?: string
}

export interface DayTotals {
  requests: number
  errors: number
  promptTokens: number
  candidatesTokens: number
  totalTokens: number
}

export interface UsageSnapshot {
  limits: FreeTierLimits
  dayKey: string
  day: DayTotals
  requestsLeftToday: number
  requestsLastMinute: number
  rpmLeft: number
  history: UsageEvent[]
  resetHint: string
}

const STORAGE_KEY = 'simplytv-gemini-usage-v1'
const HISTORY_MAX = 80

/** Conservative Flash-Lite free-tier ballpark — edit in Usage tab to match AI Studio. */
export const DEFAULT_FREE_LIMITS: FreeTierLimits = {
  rpd: 1000,
  rpm: 15,
}

interface StoredState {
  version: 1
  limits: FreeTierLimits
  history: UsageEvent[]
}

function emptyDay(): DayTotals {
  return {
    requests: 0,
    errors: 0,
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0,
  }
}

/** Gemini RPD resets at midnight Pacific Time. */
export function pacificDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function loadState(): StoredState {
  const fallback: StoredState = {
    version: 1,
    limits: { ...DEFAULT_FREE_LIMITS },
    history: [],
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      version: 1,
      limits: {
        rpd: Math.max(1, Number(parsed.limits?.rpd) || DEFAULT_FREE_LIMITS.rpd),
        rpm: Math.max(1, Number(parsed.limits?.rpm) || DEFAULT_FREE_LIMITS.rpm),
      },
      history: Array.isArray(parsed.history) ? parsed.history : [],
    }
  } catch {
    return fallback
  }
}

function saveState(state: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // quota / private mode — ignore
  }
}

function dayTotalsFromHistory(history: UsageEvent[], dayKey: string): DayTotals {
  const day = emptyDay()
  for (const ev of history) {
    if (pacificDateKey(new Date(ev.at)) !== dayKey) continue
    day.requests += Math.max(1, ev.attempts || 1)
    if (!ev.ok) day.errors += 1
    day.promptTokens += ev.promptTokens || 0
    day.candidatesTokens += ev.candidatesTokens || 0
    day.totalTokens += ev.totalTokens || 0
  }
  return day
}

function requestsInLastMinute(history: UsageEvent[], now = Date.now()): number {
  const cutoff = now - 60_000
  let n = 0
  for (const ev of history) {
    const t = Date.parse(ev.at)
    if (Number.isNaN(t) || t < cutoff) continue
    n += Math.max(1, ev.attempts || 1)
  }
  return n
}

export function getUsageSnapshot(): UsageSnapshot {
  const state = loadState()
  const dayKey = pacificDateKey()
  const day = dayTotalsFromHistory(state.history, dayKey)
  const requestsLastMinute = requestsInLastMinute(state.history)
  const requestsLeftToday = Math.max(0, state.limits.rpd - day.requests)
  const rpmLeft = Math.max(0, state.limits.rpm - requestsLastMinute)
  return {
    limits: state.limits,
    dayKey,
    day,
    requestsLeftToday,
    requestsLastMinute,
    rpmLeft,
    history: state.history,
    resetHint: 'Daily free quota (RPD) resets at midnight Pacific Time.',
  }
}

export function setFreeTierLimits(limits: Partial<FreeTierLimits>): UsageSnapshot {
  const state = loadState()
  if (limits.rpd != null && Number.isFinite(limits.rpd)) {
    state.limits.rpd = Math.max(1, Math.floor(limits.rpd))
  }
  if (limits.rpm != null && Number.isFinite(limits.rpm)) {
    state.limits.rpm = Math.max(1, Math.floor(limits.rpm))
  }
  saveState(state)
  return getUsageSnapshot()
}

export function recordUsageEvent(input: {
  title: string
  category: string
  ok: boolean
  usage?: GeminiUsageMeta | null
  error?: string
}): UsageSnapshot {
  const state = loadState()
  const attempts = Math.max(1, input.usage?.attempts ?? 1)
  const event: UsageEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    title: input.title.slice(0, 120),
    category: input.category,
    ok: input.ok,
    model: input.usage?.model,
    promptTokens: input.usage?.promptTokenCount ?? 0,
    candidatesTokens: input.usage?.candidatesTokenCount ?? 0,
    totalTokens: input.usage?.totalTokenCount ?? 0,
    attempts,
    error: input.error?.slice(0, 200),
  }
  state.history = [event, ...state.history].slice(0, HISTORY_MAX)
  saveState(state)
  return getUsageSnapshot()
}

export function clearUsageHistory(): UsageSnapshot {
  const state = loadState()
  state.history = []
  saveState(state)
  return getUsageSnapshot()
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
