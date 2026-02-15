import { NextResponse } from "next/server"
import { z } from "zod"

export const runtime = "nodejs"

const TtsRequestSchema = z.object({
  text: z.string().min(1).max(2500),
  voiceId: z.string().optional(),
  modelId: z.string().optional(),
})

const ELEVEN_DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM" // Rachel (commonly available)
const ELEVEN_DEFAULT_MODEL_ID = "eleven_multilingual_v2"
const TTS_TIMEOUT_MS = 18_000
const MAX_AUDIO_BYTES = 6 * 1024 * 1024

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = TtsRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const headerKey = request.headers.get("x-elevenlabs-api-key")?.trim() || ""
  const envKey = process.env.ELEVENLABS_API_KEY?.trim() || ""
  const apiKey = (envKey || headerKey).trim()

  if (!apiKey) {
    return NextResponse.json(
      {
        audioUrl: null,
        note: "Text-to-speech is disabled. Add an ElevenLabs API key (local) or set ELEVENLABS_API_KEY on the backend.",
      },
      { status: 200 }
    )
  }

  const headerVoiceId = request.headers.get("x-elevenlabs-voice-id")?.trim() || ""
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || ""
  const voiceId = (envVoiceId || parsed.data.voiceId?.trim() || headerVoiceId || ELEVEN_DEFAULT_VOICE_ID).trim()
  const modelId = (parsed.data.modelId?.trim() || ELEVEN_DEFAULT_MODEL_ID).trim()

  const ac = new AbortController()
  const timeoutId = setTimeout(() => ac.abort(), TTS_TIMEOUT_MS)

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        accept: "audio/mpeg",
        "content-type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: parsed.data.text,
        model_id: modelId,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      const msg = text.slice(0, 240)
      const code = res.status
      const error = msg ? `ElevenLabs error (${code}): ${msg}` : `ElevenLabs error (${code}).`
      return NextResponse.json({ error }, { status: code === 401 || code === 403 ? 401 : 502 })
    }

    const contentLength = Number(res.headers.get("content-length") ?? "")
    if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Audio payload too large" }, { status: 502 })
    }

    const ab = await res.arrayBuffer()
    if (ab.byteLength > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Audio payload too large" }, { status: 502 })
    }

    const ct = (res.headers.get("content-type") ?? "audio/mpeg").split(";")[0] || "audio/mpeg"
    const base64 = Buffer.from(ab).toString("base64")
    const audioUrl = `data:${ct};base64,${base64}`
    return NextResponse.json({ audioUrl }, { status: 200 })
  } catch (e) {
    const message = ac.signal.aborted
      ? `Text-to-speech timed out after ${TTS_TIMEOUT_MS}ms.`
      : e instanceof Error
        ? e.message
        : "Text-to-speech failed."
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    clearTimeout(timeoutId)
    ac.abort()
  }
}
