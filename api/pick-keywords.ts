import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handlePickKeywordsRequest } from '../src/lib/pickKeywordsApi'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { status, body } = await handlePickKeywordsRequest(
    req.body,
    process.env.GEMINI_API_KEY,
  )
  return res.status(status).json(body)
}
