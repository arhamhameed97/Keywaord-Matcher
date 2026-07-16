import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handlePickKeywordsRequest } from './api/lib/handler'

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

        try {
          const raw = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = []
            req.on('data', (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            })
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
            req.on('error', reject)
          })
          const body = JSON.parse(raw) as unknown
          const { status, body: payload } = await handlePickKeywordsRequest(
            body,
            apiKey,
          )

          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
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
