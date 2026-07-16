import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  callGeminiPickKeywords,
  type PickKeywordsRequest,
} from './src/lib/geminiCharacteristics'

function geminiKeywordsProxy(): Plugin {
  return {
    name: 'gemini-keywords-proxy',
    configureServer(server) {
      const handlePick = async (
        req: import('http').IncomingMessage,
        res: import('http').ServerResponse,
      ) => {
        const env = loadEnv(server.config.mode, server.config.root, '')
        const apiKey = env.GEMINI_API_KEY?.trim()
        if (!apiKey) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error:
                'GEMINI_API_KEY not set. Add it to .env and restart the dev server.',
            }),
          )
          return
        }

        try {
          const raw = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = []
            req.on('data', (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            })
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
            req.on('error', reject)
          })
          const body = JSON.parse(raw) as PickKeywordsRequest & { category?: string }
          if (!body?.title || !Array.isArray(body.candidates)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid request body' }))
            return
          }

          const category =
            body.category === 'Mood' ||
            body.category === 'Setting' ||
            body.category === 'Period' ||
            body.category === 'Characteristics'
              ? body.category
              : 'Characteristics'

          const result = await callGeminiPickKeywords(apiKey, {
            title: body.title,
            year: body.year,
            genres: body.genres ?? [],
            plot: body.plot ?? '',
            category,
            candidates: body.candidates,
          })

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        } catch (err) {
          console.error('[pick-keywords]', err)
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error:
                err instanceof Error ? err.message : 'Gemini request failed',
            }),
          )
        }
      }

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        if (req.url === '/api/pick-keywords' || req.url === '/api/pick-characteristics') {
          await handlePick(req, res)
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), geminiKeywordsProxy()],
})
