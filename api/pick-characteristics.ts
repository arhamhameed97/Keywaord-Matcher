import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handlePickKeywordsRequest } from './lib/handler'

/** Legacy alias — defaults category to Characteristics when omitted. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const payload =
    req.body && typeof req.body === 'object'
      ? { ...req.body, category: req.body.category ?? 'Characteristics' }
      : req.body

  const { status, body } = await handlePickKeywordsRequest(
    payload,
    process.env.GEMINI_API_KEY,
  )
  return res.status(status).json(body)
}
