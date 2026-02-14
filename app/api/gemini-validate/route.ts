import { NextResponse } from "next/server"

export const runtime = "nodejs"

function looksLikeGeminiKey(value: string) {
  const raw = value.trim()
  if (raw.length === 0) return false
  return /^[A-Za-z0-9._-]{20,}$/.test(raw)
}

export async function POST(req: Request) {
  // Format-only validation (instant). No network calls.
  const headerKey = req.headers.get("x-gemini-api-key") ?? ""
  const body = await req.json().catch(() => ({}))
  const bodyKeyRaw = (body as any)?.geminiApiKey ?? (body as any)?.apiKey
  const bodyKey = typeof bodyKeyRaw === "string" ? bodyKeyRaw : ""
  const key = headerKey || bodyKey

  if (!key.trim()) {
    return NextResponse.json({ ok: false, error: "Missing API key" }, { status: 200 })
  }

  if (!looksLikeGeminiKey(key)) {
    return NextResponse.json({ ok: false, error: "Key format looks off" }, { status: 200 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
