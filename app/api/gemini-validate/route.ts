import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const headerKey = req.headers.get("x-gemini-api-key")?.trim() || ""
  const body = await req.json().catch(() => ({}))
  const bodyKeyRaw = (body as any)?.geminiApiKey ?? (body as any)?.apiKey
  const bodyKey = typeof bodyKeyRaw === "string" ? bodyKeyRaw.trim() : ""
  const key = headerKey || bodyKey || ""

  if (!key) {
    return NextResponse.json({ ok: false, error: "Missing API key" }, { status: 400 })
  }

  // Lightweight validation: hit the public models list endpoint.
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models")
  url.searchParams.set("key", key)

  try {
    const res = await fetch(url.toString(), { method: "GET" })
    if (res.ok) {
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    const json = (await res.json().catch(() => null)) as any
    const msg =
      typeof json?.error?.message === "string"
        ? json.error.message
        : `Validation failed (${res.status})`
    return NextResponse.json({ ok: false, error: msg }, { status: 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error"
    return NextResponse.json({ ok: false, error: msg }, { status: 200 })
  }
}
