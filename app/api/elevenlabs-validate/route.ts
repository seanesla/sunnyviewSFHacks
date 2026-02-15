import { NextResponse } from "next/server"

export const runtime = "nodejs"

const TIMEOUT_MS = 3500

function looksLikeElevenLabsKey(value: string) {
  const raw = value.trim()
  if (raw.length === 0) return false
  if (raw.length < 20) return false
  return !/\s/.test(raw)
}

export async function POST(req: Request) {
  // Quick online validation (small, cheap request).
  const envKey = process.env.ELEVENLABS_API_KEY?.trim() || ""
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || ""
  const envLoaded = envKey.length > 0
  const voiceEnvLoaded = envVoiceId.length > 0

  const headerKey = req.headers.get("x-elevenlabs-api-key") ?? ""
  const body = await req.json().catch(() => ({}))
  const bodyKeyRaw = (body as any)?.elevenLabsApiKey ?? (body as any)?.apiKey
  const bodyKey = typeof bodyKeyRaw === "string" ? bodyKeyRaw : ""
  const key = (headerKey || bodyKey).trim()

  if (!key) {
    return NextResponse.json({ ok: false, error: "Missing API key", envLoaded, voiceEnvLoaded }, { status: 200 })
  }

  if (!looksLikeElevenLabsKey(key)) {
    return NextResponse.json({ ok: false, envLoaded, voiceEnvLoaded }, { status: 200 })
  }

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      method: "GET",
      signal: ac.signal,
      headers: {
        accept: "application/json",
        "xi-api-key": key,
      },
      cache: "no-store",
    })

    if (!res.ok) {
      return NextResponse.json({ ok: false, envLoaded, voiceEnvLoaded }, { status: 200 })
    }

    const json = (await res.json().catch(() => null)) as any
    if (!json || typeof json !== "object") {
      return NextResponse.json({ ok: false, envLoaded, voiceEnvLoaded }, { status: 200 })
    }

    return NextResponse.json({ ok: true, envLoaded, voiceEnvLoaded }, { status: 200 })
  } catch {
    return NextResponse.json({ ok: false, envLoaded, voiceEnvLoaded }, { status: 200 })
  } finally {
    clearTimeout(t)
    ac.abort()
  }
}
