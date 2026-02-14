import { NextResponse } from "next/server"
import { z } from "zod"

export const runtime = "nodejs"

const LOG_PREFIX = "[panel-recommend]"
const MODEL_NOT_FOUND_RE = /not found|not supported|not available|unsupported model/i

function uniqueModels(models: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of models) {
    const model = String(raw ?? "").trim()
    if (!model || seen.has(model)) continue
    seen.add(model)
    out.push(model)
  }
  return out
}

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
  const key = process.env.GEMINI_API_KEY?.trim() || ""
  const configuredModel = process.env.GEMINI_MODEL?.trim() || ""
  const modelsToTry = uniqueModels([
    configuredModel,
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
  ])

  const body = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 })
  }

  const { lat, lng, roofAreaM2, options, currentId, notes } = parsed.data
  const loc = lat !== undefined && lng !== undefined ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "unknown"

  function fallbackRecommendation(reason: string, attemptedModels: string[] = []) {
    const ranked = options
      .map((o) => ({
        opt: o,
        dcKw: Number(o.fit?.dcKw ?? 0),
        panelCount: Number(o.fit?.panelCount ?? 0),
      }))
      .sort((a, b) => (b.dcKw !== a.dcKw ? b.dcKw - a.dcKw : b.panelCount - a.panelCount))

    const current = currentId ? options.find((o) => o.id === currentId) : null
    const best = ranked[0]?.opt ?? options[0]
    const selected = current ?? best
    const dcKw = Number(selected.fit?.dcKw ?? 0)
    const panelCount = Number(selected.fit?.panelCount ?? 0)

    const why = [
      `Picked ${selected.brand} ${selected.model} using a local fallback rule because Gemini was unavailable.`,
      `This option currently fits about ${panelCount} panels (${dcKw.toFixed(1)} kW DC) for your traced roof.`,
      "You can still switch models manually if local installer pricing or stock favors another panel.",
    ]
    const caveats = [
      "AI recommendation is temporarily unavailable; this is a deterministic fallback.",
      "Always confirm final panel choice with installer pricing, permits, and shading checks.",
    ]

    console.warn(`${LOG_PREFIX} fallback`, {
      reason,
      selectedId: selected.id,
      attemptedModels,
    })

    return NextResponse.json(
      {
        selectedId: selected.id,
        brand: selected.brand,
        model: selected.model,
        why,
        caveats,
        usedModel: "local-fallback",
        fallbackReason: reason,
        attemptedModels,
      },
      { status: 200 }
    )
  }

  if (!key) {
    return fallbackRecommendation("Missing GEMINI_API_KEY")
  }

  console.info(`${LOG_PREFIX} request`, {
    location: loc,
    roofAreaM2: Number(roofAreaM2.toFixed(1)),
    options: options.length,
    currentId: currentId ?? null,
    modelsToTry,
  })

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

  const allowedIds = new Set(options.map((o) => o.id))
  const requestBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 300,
      responseMimeType: "application/json",
    },
  }

  const attemptedModels: string[] = []
  let lastUpstreamError = "Gemini unavailable"

  for (const modelName of modelsToTry) {
    attemptedModels.push(modelName)
    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`
    )
    url.searchParams.set("key", key)

    console.info(`${LOG_PREFIX} trying model`, { model: modelName })

    let res: Response
    let json: any = null
    try {
      res = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      })
      json = (await res.json().catch(() => null)) as any
    } catch (e) {
      const message = e instanceof Error ? e.message : "Network error"
      lastUpstreamError = message
      console.error(`${LOG_PREFIX} request failed`, { model: modelName, message })
      continue
    }

    if (!res.ok) {
      const msg =
        typeof json?.error?.message === "string"
          ? json.error.message
          : `Gemini error (${res.status})`
      lastUpstreamError = msg
      console.warn(`${LOG_PREFIX} model failed`, {
        model: modelName,
        status: res.status,
        message: msg.slice(0, 240),
      })
      const canRetryModel = res.status === 404 || res.status === 429 || MODEL_NOT_FOUND_RE.test(msg)
      if (canRetryModel) continue
      return fallbackRecommendation(msg, attemptedModels)
    }

    const text = extractText(json)
    const parsedJson = tryParseJson(text)
    const out = parsedJson && typeof parsedJson === "object" ? parsedJson : null

    const selectedId = typeof out?.selectedId === "string" ? out.selectedId : null
    const brand = typeof out?.brand === "string" ? out.brand : null
    const model = typeof out?.model === "string" ? out.model : null
    const why = Array.isArray(out?.why) ? out.why.map((v: any) => String(v)).filter(Boolean) : []
    const caveats = Array.isArray(out?.caveats) ? out.caveats.map((v: any) => String(v)).filter(Boolean) : []

    if (!selectedId || !allowedIds.has(selectedId) || !brand || !model) {
      lastUpstreamError = "Failed to parse Gemini JSON"
      console.warn(`${LOG_PREFIX} parse failed`, {
        model: modelName,
        selectedId,
        hasBrand: !!brand,
        hasModel: !!model,
      })
      return fallbackRecommendation("Failed to parse Gemini JSON", attemptedModels)
    }

    console.info(`${LOG_PREFIX} success`, {
      model: modelName,
      selectedId,
      brand,
      panelModel: model,
    })

    return NextResponse.json(
      {
        selectedId,
        brand,
        model,
        why: why.slice(0, 4),
        caveats: caveats.slice(0, 3),
        usedModel: modelName,
      },
      { status: 200 }
    )
  }

  return fallbackRecommendation(lastUpstreamError, attemptedModels)
}
