# Simply.TV Keyword Helper

Local helper that looks up a movie by title and auto-picks keywords from your Simply.TV keyword space for pasting into [editorial.simply.tv](https://editorial.simply.tv).

## Quick start

> **Windows note:** Keep this project in a path **without an apostrophe** in any folder name (Vite breaks otherwise). Canonical folder: `d:\Cursor AI Projects\simplytv-keyword-helper`.

```bash
cd "d:\Cursor AI Projects\simplytv-keyword-helper"
npm install
```

### OMDb API key (recommended)

OMDb provides IMDb-backed plot, genres, year, and country.

1. Get a free key at [https://www.omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx)
2. Copy `.env.example` to `.env`
3. Set `VITE_OMDB_API_KEY=your_key_here`
4. Restart the dev server

Without a key, the app falls back to Wikipedia summaries (weaker genre/period/setting signals).

### Gemini API key (Characteristics AI)

Characteristics can be refined by **Gemini** (`gemini-3.1-flash-lite`, with Flash fallbacks) during `npm run dev` (Vite proxy keeps the key server-side).

1. Get a free key at [Google AI Studio](https://aistudio.google.com/apikey)
2. In `.env` set `GEMINI_API_KEY=your_key_here` (do **not** use a `VITE_` prefix)
3. Restart the dev server

**Generate** always uses the local scorer first. Switch tabs to review each category; click **Improve {Category} with AI** when that category needs help. **Restore local {Category}** undoes AI for that tab only.

Without this key, the AI button fails gracefully and local picks stay.

### Deploying to Vercel

1. Connect the GitHub repo and deploy with the default Vite settings
2. In **Project → Settings → Environment Variables**, add:
   - `VITE_OMDB_API_KEY` — for client-side OMDb lookup
   - `GEMINI_API_KEY` — for `/api/pick-keywords` serverless routes (no `VITE_` prefix)
3. Redeploy after adding env vars

Eval with AI: `npm run score-gold-llm` (requires `GEMINI_API_KEY`). Local-only: `npm run score-gold`.

```bash
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

1. Enter a **movie title** (optional year)
2. Click **Generate keywords** — review local picks
3. Confirm the movie card (IMDb link when available)
4. Optionally click **Improve {Category} with AI** on any tab (Characteristics, Mood, Setting, Period)
5. **Copy selected** → paste into editorial.simply.tv

## How it works

1. **Lookup** — OMDb (IMDb data) first; Wikipedia if OMDb misses or no key
2. **Plot enrich** — Wikipedia Plot section when longer than OMDb synopsis
3. **Score** — local genre/token boosts for all categories
4. **Keywords AI (opt-in per tab)** — Gemini re-picks one category at a time via `/api/pick-keywords` when you click the button (Vite proxy in dev; Vercel serverless in production)
5. **Copy** — auto-selected pack ready for editorial

Ambiguous titles (same name, different years) show a short candidate list.

Use Advanced overrides to add genre boosts after a lookup if needed.

## Updating the keyword space

When the [XMind Keywords Space](https://xmind.app/m/pxg34i/#) changes:

1. Export / copy the outline as markdown into `data/keywords-source.md`
2. Run `npm run parse-keywords`
3. Refresh the app

## Project layout

| Path | Purpose |
|------|---------|
| `data/keywords-source.md` | Keyword space export |
| `scripts/parse-keywords.mjs` | Markdown → JSON |
| `public/keywords-space.json` | Runtime keyword data |
| `src/lib/lookupMovie.ts` | OMDb + Wikipedia lookup |
| `src/lib/wikipediaPlot.ts` | Wikipedia Plot section enrichment |
| `src/lib/pickKeywords.ts` | Soft-minimum selection + Characteristics shortlist |
| `src/lib/geminiCharacteristics.ts` | Gemini prompt + API (server/scripts) |
| `src/lib/llmCharacteristics.ts` | Browser client for Characteristics AI |
| `src/lib/genreMaps.ts` | Genre → path boosts |
| `src/App.tsx` | UI |
| `.env.example` | OMDb + Gemini key template |

## Build

```bash
npm run build
npm run preview
```

If the path has an apostrophe, use `npm run build:clean` instead.
