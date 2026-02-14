import { NextResponse } from 'next/server'
import { z } from 'zod'

const TtsRequestSchema = z.object({
  text: z.string(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = TtsRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { audioUrl: null, note: 'Stub mode' },
      { status: 200 },
    )
  }

  // TODO: Implement ElevenLabs TTS fetch call and return an audio URL.
  return NextResponse.json({ audioUrl: null, note: 'Stub mode' }, { status: 200 })
}
