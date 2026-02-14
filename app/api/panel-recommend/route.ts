import { NextResponse } from "next/server"
import { z } from "zod"

export const runtime = "nodejs"

const BodySchema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  roofAreaM2: z.number().positive(),
  currentId: z.string().optional(),
  options: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        brand: z.string(),
        model: z.string(),
        spec: z.object({
          widthM: z.number().positive(),
          heightM: z.number().positive(),
          wattW: z.number().positive(),
          gapM: z.number().positive().optional(),
        }),
        fit: z
          .object({
            panelCount: z.number().int().nonnegative(),
            dcKw: z.number().nonnegative(),
            orientationDeg: z.number().optional(),
          })
          .optional(),
      })
    )
    .min(1),
  notes: z.string().optional(),
})

function extractText(resp: any): string {
  const parts = resp?.candidates?.[0]?.content?.parts
  if (Array.isArray(parts)) {
    return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("\n").trim()
  }
  return ""
}

function tryParseJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 501 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 })
  }

  const { lat, lng, roofAreaM2, options, currentId, notes } = parsed.data
  const loc = lat !== undefined && lng !== undefined ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "unknown"

  const optionLines = options
    .map((o) => {
      const fit = o.fit
      const fitText = fit
        ? `fits ${fit.panelCount} panels (${fit.dcKw.toFixed(1)} kW DC) at orient ${fit.orientationDeg ?? "?"}°`
        : "fit unknown"
      return `- id=${o.id} | ${o.brand} ${o.model} | ${o.spec.widthM.toFixed(3)}m x ${o.spec.heightM.toFixed(3)}m | ${Math.round(o.spec.wattW)}W | ${fitText}`
    })
    .join("\n")

  const prompt = `You are helping pick the best solar panel option for a specific roof.

Inputs:
- Location: ${loc}
- Usable roof plane area: ${roofAreaM2.toFixed(1)} m^2
${currentId ? `- Current selection id: ${currentId}` : ""}
${notes ? `- Notes: ${notes}` : ""}

Candidate panel options (choose exactly ONE id):
${optionLines}

Task:
- Choose the best option id for this roof.
- Explain briefly why it is best given the computed fit counts (panelCount/dcKw) and general reliability.
- Include 2 caveats (availability/pricing, permitting/shading).

Return STRICT JSON with keys:
{ "selectedId": string, "brand": string, "model": string, "why": string[], "caveats": string[] }
No extra keys, no markdown.`

  const url = new URL(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
  )
  url.searchParams.set("key", key)

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
      },
    }),
  })

  const json = (await res.json().catch(() => null)) as any
  if (!res.ok) {
    const msg =
      typeof json?.error?.message === "string"
        ? json.error.message
        : `Gemini error (${res.status})`
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const text = extractText(json)
  const parsedJson = tryParseJson(text)
  const out = parsedJson && typeof parsedJson === "object" ? parsedJson : null

  const selectedId = typeof out?.selectedId === "string" ? out.selectedId : null
  const brand = typeof out?.brand === "string" ? out.brand : null
  const model = typeof out?.model === "string" ? out.model : null
  const why = Array.isArray(out?.why) ? out.why.map((v: any) => String(v)).filter(Boolean) : []
  const caveats = Array.isArray(out?.caveats) ? out.caveats.map((v: any) => String(v)).filter(Boolean) : []

  const allowedIds = new Set(options.map((o) => o.id))
  if (!selectedId || !allowedIds.has(selectedId) || !brand || !model) {
    return NextResponse.json(
      {
        error: "Failed to parse Gemini JSON",
        raw: text.slice(0, 800),
      },
      { status: 502 }
    )
  }

  return NextResponse.json(
    {
      selectedId,
      brand,
      model,
      why: why.slice(0, 4),
      caveats: caveats.slice(0, 3),
    },
    { status: 200 }
  )
}
