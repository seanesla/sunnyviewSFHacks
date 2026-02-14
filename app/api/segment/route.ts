import { NextResponse } from "next/server"
import { z } from "zod"

import { clamp, mercatorToPixel, mercatorUnproject, pixelToMercator } from "@/lib/segment/mercator"
import {
  fetchOverpassBuildings,
  fetchOverpassByHouseNumber,
  fetchOverpassByOsmId,
  normalizeCandidatePolygon,
  pickTopOrCandidates,
  rankBuildingCandidates,
  staticMapTransformFromMeta,
} from "@/lib/segment/osm-buildings"
import { looksLikeBuildingHit, nominatimReverse } from "@/lib/segment/nominatim"
import { parseAddressHints } from "@/lib/segment/address"
import { requestClientKey, takeRateLimitToken } from "@/lib/rate-limit"

export const runtime = "nodejs"

const SegmentSchema = z.object({
  imageDataUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  mode: z.string().optional(),
  clicks: z
    .array(z.object({ x: z.number(), y: z.number(), type: z.enum(["pos", "neg"]) }))
    .optional(),
  roi: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .optional(),
  meta: z.record(z.unknown()).optional(),
})

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_FETCH_TIMEOUT_MS = 12_000
const SEGMENT_SERVICE_TIMEOUT_MS = 25_000
const SEGMENT_UPSTREAM_TIMEOUT_MS = 20_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 18

function readHostAllowlist() {
  const raw = process.env.SEGMENT_IMAGE_FETCH_ALLOWLIST ?? ""
  return raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
}

function isPrivateIpv4(hostname: string) {
  const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0) return true
  return false
}

function isPrivateHostname(hostname: string) {
  const host = hostname.trim().toLowerCase()
  if (!host) return true
  if (host === "localhost") return true
  if (host.endsWith(".localhost")) return true
  if (host.endsWith(".local")) return true
  if (isPrivateIpv4(host)) return true
  if (host === "::1") return true
  if (host.startsWith("fc") || host.startsWith("fd")) return true
  if (host.startsWith("fe80:")) return true
  return false
}

function hostAllowed(hostname: string, requestHost: string, allowlist: string[]) {
  if (hostname === requestHost) return true
  return allowlist.some((allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`))
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  const parentSignal = init.signal
  const onParentAbort = () => controller.abort()
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort()
    else parentSignal.addEventListener("abort", onParentAbort, { once: true })
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort)
  }
}

async function readBufferWithLimit(res: Response, maxBytes: number) {
  const contentLength = Number(res.headers.get("content-length") ?? "")
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Image exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    const fallback = await res.arrayBuffer()
    if (fallback.byteLength > maxBytes) {
      throw new Error(`Image exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`)
    }
    return fallback
  }

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      throw new Error(`Image exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`)
    }
    chunks.push(value)
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined.buffer
}

function estimateDataUrlBytes(dataUrl: string) {
  const commaIdx = dataUrl.indexOf(",")
  if (commaIdx < 0) return null
  const meta = dataUrl.slice(0, commaIdx).toLowerCase()
  if (!meta.startsWith("data:image/")) return null
  const base64 = dataUrl.slice(commaIdx + 1)
  if (!base64.length) return null
  const pad = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - pad
}

function num(x: unknown) {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

function isLikelyUrl(s: string) {
  return /^https?:\/\//i.test(s) || s.startsWith("/")
}

async function imageUrlToDataUrl(imageUrl: string, reqUrl: string, signal: AbortSignal) {
  const allowlist = readHostAllowlist()
  const abs = new URL(imageUrl, reqUrl)
  const requestUrl = new URL(reqUrl)
  const reqHost = requestUrl.hostname.toLowerCase()
  const absHost = abs.hostname.toLowerCase()

  if (!["https:", "http:"].includes(abs.protocol)) {
    throw new Error("imageUrl must use http(s)")
  }

  if (isPrivateHostname(absHost) && absHost !== reqHost) {
    throw new Error("imageUrl host is not allowed")
  }

  if (!hostAllowed(absHost, reqHost, allowlist)) {
    throw new Error("imageUrl host must match this app host or SEGMENT_IMAGE_FETCH_ALLOWLIST")
  }

  if (abs.protocol !== "https:" && absHost !== "localhost" && absHost !== "127.0.0.1") {
    throw new Error("imageUrl must use https for remote hosts")
  }

  const res = await fetchWithTimeout(
    abs.toString(),
    { cache: "no-store", signal, headers: { accept: "image/*" } },
    IMAGE_FETCH_TIMEOUT_MS
  )
  if (!res.ok) throw new Error(`Image fetch failed (${res.status})`)

  const ct = res.headers.get("content-type") ?? "image/png"
  if (!ct.toLowerCase().startsWith("image/")) {
    throw new Error("Fetched URL did not return an image")
  }

  const ab = await readBufferWithLimit(res, MAX_IMAGE_BYTES)
  const base64 = Buffer.from(ab).toString("base64")
  return `data:${ct};base64,${base64}`
}

export async function POST(req: Request) {
  const clientKey = requestClientKey(req.headers)
  const rate = takeRateLimitToken({
    key: `segment:${clientKey}`,
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many segmentation requests. Please slow down." },
      {
        status: 429,
        headers: { "retry-after": String(rate.retryAfterSec) },
      }
    )
  }

  const body = await req.json().catch(() => ({}))
  const parsed = SegmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 })
  }

  const svc = process.env.SEGMENT_SERVICE_URL?.trim()
  const mode = parsed.data.mode ?? "roof"
  const clicks = parsed.data.clicks
  const roi = parsed.data.roi
  const meta = parsed.data.meta

  const metaLat = num((meta as any)?.lat)
  const metaLng = num((meta as any)?.lng)
  const metaZoom = num((meta as any)?.zoom)
  const metaW = num((meta as any)?.widthPx)
  const metaH = num((meta as any)?.heightPx)
  const metaAddress = typeof (meta as any)?.address === "string" ? String((meta as any).address) : null
  const upstreamSignal = AbortSignal.timeout(SEGMENT_UPSTREAM_TIMEOUT_MS)

  // No segmentation service configured: try a footprint-based outline using OSM buildings.
  if (!svc) {
    if (metaLat !== null && metaLng !== null && metaZoom !== null && metaW !== null && metaH !== null) {
      const tf = staticMapTransformFromMeta({
        lat: metaLat,
        lng: metaLng,
        zoom: metaZoom,
        widthPx: metaW,
        heightPx: metaH,
        staticMap: (meta as any)?.staticMap,
      })

      const posClick = Array.isArray(clicks) ? clicks.find((c) => c.type === "pos") : null
      const focusPx = posClick ? { x: posClick.x, y: posClick.y } : { x: metaW / 2, y: metaH / 2 }
      const focusMerc = pixelToMercator(focusPx, tf)
      const focusLatLng = mercatorUnproject(focusMerc)

      try {
        // 1) Try to resolve the exact building element via Nominatim reverse.
        let elements = [] as any[]
        try {
          const rev = await nominatimReverse({ lat: focusLatLng.lat, lng: focusLatLng.lng, signal: upstreamSignal })
          if (looksLikeBuildingHit(rev) && (rev.osmType === "way" || rev.osmType === "relation") && rev.osmId) {
            elements = await fetchOverpassByOsmId({ osmType: rev.osmType, osmId: rev.osmId, signal: upstreamSignal })
          }
        } catch {
          // ignore reverse failures
        }

        // 2) Fallback: nearby buildings.
        if (!elements.length) {
          elements = await fetchOverpassBuildings({ lat: focusLatLng.lat, lng: focusLatLng.lng, radiusM: 160, signal: upstreamSignal })
        }

        // 3) If we have an address number, also query addr-tagged buildings.
        const hints = parseAddressHints(metaAddress)
        if (hints?.houseNumber) {
          try {
            const tagged = await fetchOverpassByHouseNumber({
              lat: focusLatLng.lat,
              lng: focusLatLng.lng,
              radiusM: 260,
              houseNumber: hints.houseNumber,
              signal: upstreamSignal,
            })
            if (tagged.length) elements = elements.concat(tagged)
          } catch {
            // ignore
          }
        }

        const scored = rankBuildingCandidates({
          elements,
          tf,
          focusPx,
          address: metaAddress,
        })
        const pick = pickTopOrCandidates(scored)
        if (pick.kind === "single") {
          const poly = normalizeCandidatePolygon(pick.best, tf)
          return NextResponse.json(
            {
              roofPolygon: poly,
              source: "osm_building",
              confidence: pick.best.containsFocus || pick.best.addrScore > 0 ? 0.8 : 0.6,
              debug: { bestId: pick.best.id, addrScore: pick.best.addrScore, contains: pick.best.containsFocus },
            },
            { status: 200 }
          )
        }
        if (pick.kind === "candidates") {
          return NextResponse.json(
            {
              candidates: pick.candidates.map((c) => ({
                id: c.id,
                polygon: normalizeCandidatePolygon(c, tf),
                score: c.score,
                contains: c.containsFocus,
                addrScore: c.addrScore,
                tags: {
                  building: c.tags.building ?? null,
                  housenumber: c.tags["addr:housenumber"] ?? null,
                  street: c.tags["addr:street"] ?? null,
                },
              })),
              source: "osm_candidates",
              note: "Multiple nearby buildings found. Click the correct roof.",
            },
            { status: 200 }
          )
        }
      } catch (e) {
        const timedOut = upstreamSignal.aborted || (e instanceof Error && e.name === "AbortError")
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Overpass failed", source: "osm_error" },
          { status: timedOut ? 504 : 502 }
        )
      }

      return NextResponse.json(
        {
          error: "No building footprint found near this address.",
          note: "Trace the roof manually.",
        },
        { status: 404 }
      )
    }

    return NextResponse.json(
      {
        error: "SEGMENT_SERVICE_URL not configured",
        note: "Provide meta {lat,lng,zoom,widthPx,heightPx} for OSM footprint fallback, or set SEGMENT_SERVICE_URL for CV segmentation.",
      },
      { status: 501 }
    )
  }

  let imageDataUrl = parsed.data.imageDataUrl?.trim() || null
  const imageUrl = parsed.data.imageUrl?.trim() || null

  if (!imageDataUrl && imageUrl) {
    if (!isLikelyUrl(imageUrl)) {
      return NextResponse.json({ error: "Invalid imageUrl" }, { status: 400 })
    }
    try {
      imageDataUrl = await imageUrlToDataUrl(imageUrl, req.url, AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS))
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to fetch image" }, { status: 502 })
    }
  }

  if (!imageDataUrl) {
    return NextResponse.json({ error: "Provide imageDataUrl or imageUrl" }, { status: 400 })
  }

  if (imageDataUrl.length > MAX_IMAGE_BYTES * 2) {
    return NextResponse.json(
      { error: `Image payload exceeds ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB limit` },
      { status: 413 }
    )
  }

  const imageSizeBytes = estimateDataUrlBytes(imageDataUrl)
  if (imageSizeBytes === null) {
    return NextResponse.json({ error: "imageDataUrl must be a base64 data:image/* URL" }, { status: 400 })
  }
  if (imageSizeBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image exceeds ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB limit` },
      { status: 413 }
    )
  }

  const svcUrl = `${svc.replace(/\/$/, "")}/segment`

  async function callService(payload: Record<string, unknown>) {
    const res = await fetchWithTimeout(
      svcUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      },
      SEGMENT_SERVICE_TIMEOUT_MS
    )
    const json = await res.json().catch(() => null)
    return { res, json }
  }

  try {
    // If we have map metadata, use OSM to guide the segmenter to the correct house.
    let guidedClicks = clicks
    let guidedRoi = roi
    let guidedMeta = meta
    if (metaLat !== null && metaLng !== null && metaZoom !== null && metaW !== null && metaH !== null) {
      try {
        const tf = staticMapTransformFromMeta({
          lat: metaLat,
          lng: metaLng,
          zoom: metaZoom,
          widthPx: metaW,
          heightPx: metaH,
          staticMap: (meta as any)?.staticMap,
        })

        const posClick = Array.isArray(clicks) ? clicks.find((c) => c.type === "pos") : null
        const focusPx = posClick ? { x: posClick.x, y: posClick.y } : { x: metaW / 2, y: metaH / 2 }
        const focusMerc = pixelToMercator(focusPx, tf)
        const focusLatLng = mercatorUnproject(focusMerc)

        let elements = [] as any[]
        try {
          const rev = await nominatimReverse({ lat: focusLatLng.lat, lng: focusLatLng.lng, signal: upstreamSignal })
          if (looksLikeBuildingHit(rev) && (rev.osmType === "way" || rev.osmType === "relation") && rev.osmId) {
            elements = await fetchOverpassByOsmId({ osmType: rev.osmType, osmId: rev.osmId, signal: upstreamSignal })
          }
        } catch {
          // ignore reverse failures
        }
        if (!elements.length) {
          elements = await fetchOverpassBuildings({ lat: focusLatLng.lat, lng: focusLatLng.lng, radiusM: 160, signal: upstreamSignal })
        }

        const hints = parseAddressHints(metaAddress)
        if (hints?.houseNumber) {
          try {
            const tagged = await fetchOverpassByHouseNumber({
              lat: focusLatLng.lat,
              lng: focusLatLng.lng,
              radiusM: 260,
              houseNumber: hints.houseNumber,
              signal: upstreamSignal,
            })
            if (tagged.length) elements = elements.concat(tagged)
          } catch {
            // ignore
          }
        }

        const scored = rankBuildingCandidates({ elements, tf, focusPx, address: metaAddress })
        const best = scored[0]
        if (best) {
          // Default click at footprint centroid.
          if (!guidedClicks || guidedClicks.length === 0) {
            const centroidMerc = {
              x: best.ringMerc.reduce((s, p) => s + p.x, 0) / best.ringMerc.length,
              y: best.ringMerc.reduce((s, p) => s + p.y, 0) / best.ringMerc.length,
            }
            const cp = mercatorToPixel(centroidMerc, tf)
            guidedClicks = [{ x: cp.x, y: cp.y, type: "pos" as const }]
          }

          // Default ROI to the footprint bbox (+ margin) to force the segmenter to focus.
          if (!guidedRoi) {
            let minX = Infinity
            let minY = Infinity
            let maxX = -Infinity
            let maxY = -Infinity
            for (const p of best.ringMerc) {
              const pp = mercatorToPixel(p, tf)
              minX = Math.min(minX, pp.x)
              minY = Math.min(minY, pp.y)
              maxX = Math.max(maxX, pp.x)
              maxY = Math.max(maxY, pp.y)
            }
            const pad = 24
            const x = clamp(Math.floor(minX - pad), 0, metaW)
            const y = clamp(Math.floor(minY - pad), 0, metaH)
            const w = clamp(Math.ceil(maxX - minX + pad * 2), 1, metaW - x)
            const h = clamp(Math.ceil(maxY - minY + pad * 2), 1, metaH - y)
            guidedRoi = { x, y, w, h }
          }

          if (guidedMeta && typeof guidedMeta === "object") {
            guidedMeta = { ...(guidedMeta as any), osmBestId: best.id, osmSource: "guided" }
          }
        }
      } catch {
        // ignore guidance failures
      }
    }

    // Try the most common payloads.
    const base = { mode, ...(guidedClicks ? { clicks: guidedClicks } : {}), ...(guidedRoi ? { roi: guidedRoi } : {}), ...(guidedMeta ? { meta: guidedMeta } : {}) }

    const attempt1 = await callService({ imageDataUrl, ...base })
    if (attempt1.res.ok) return NextResponse.json(attempt1.json, { status: 200 })

    // Some services expect `imageRef` instead of `imageDataUrl`.
    const attempt2 = await callService({ imageRef: imageDataUrl, ...base })
    if (attempt2.res.ok) return NextResponse.json(attempt2.json, { status: 200 })

    return NextResponse.json(
      {
        error: `Segmentation failed (${attempt2.res.status})`,
        details: attempt2.json,
        note: "Tried payloads: {imageDataUrl,...} then {imageRef,...}",
      },
      { status: 502 }
    )
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError"
    return NextResponse.json({ error: e instanceof Error ? e.message : "Segmentation exception" }, { status: timedOut ? 504 : 502 })
  }
}
