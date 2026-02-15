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

function extractGeojsonRingNorm(poly: unknown): Array<[number, number]> | null {
  if (!poly || typeof poly !== "object") return null

  const obj = poly as any
  if (obj?.type === "Feature" && obj?.geometry) return extractGeojsonRingNorm(obj.geometry)

  const typ = typeof obj?.type === "string" ? String(obj.type) : null
  const coords = obj?.coordinates
  if (!Array.isArray(coords)) return null

  let ring: unknown[] | null = null
  if (typ === "Polygon" && Array.isArray(coords[0])) ring = coords[0] as unknown[]
  else if (typ === "MultiPolygon" && Array.isArray(coords[0]) && Array.isArray((coords[0] as any)[0])) {
    ring = (coords[0] as any)[0] as unknown[]
  } else if (!typ && coords.length >= 3 && Array.isArray(coords[0])) {
    // tolerate {coordinates:[[x,y],...]} without type
    ring = coords as unknown[]
  }
  if (!ring) return null

  const pts: Array<[number, number]> = []
  for (const item of ring) {
    if (!Array.isArray(item) || item.length < 2) return null
    const x = num(item[0])
    const y = num(item[1])
    if (x === null || y === null) return null
    pts.push([x, y])
  }

  if (pts.length >= 2) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop()
  }

  return pts.length >= 3 ? pts : null
}

async function detectLocalSegmenter(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null

  type CacheEntry = { t: number; base: string | null }
  const CACHE_OK_TTL_MS = 60_000
  const CACHE_FAIL_TTL_MS = 4_000
  const g = globalThis as unknown as { __sunnyviewLocalSegmenterCache?: CacheEntry }
  const cached = g.__sunnyviewLocalSegmenterCache
  if (cached) {
    const age = Date.now() - cached.t
    const ttl = cached.base ? CACHE_OK_TTL_MS : CACHE_FAIL_TTL_MS
    if (age >= 0 && age < ttl) return cached.base
  }

  const bases = ["http://127.0.0.1:8000", "http://localhost:8000"]
  for (const base of bases) {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 1200)
    try {
      const res = await fetch(`${base}/healthz`, { signal: ac.signal, headers: { accept: "application/json" } })
      if (res.ok) {
        g.__sunnyviewLocalSegmenterCache = { t: Date.now(), base }
        return base
      }
    } catch {
      // ignore
    } finally {
      clearTimeout(t)
    }
  }
  g.__sunnyviewLocalSegmenterCache = { t: Date.now(), base: null }
  return null
}

function fallbackRectRoofPolygon(params: { widthPx: number; heightPx: number; zoom: number; scale?: number | null }) {
  // Pick a conservative residential roof rectangle (~14m x ~9m) centered in the image.
  // This is only used when neither CV nor OSM footprints are available.
  const R = 6378137
  const resMPerPx = (2 * Math.PI * R) / (256 * Math.pow(2, Math.round(clamp(params.zoom, 0, 22))))
  const s = typeof params.scale === "number" && Number.isFinite(params.scale) ? Math.max(1, Math.min(2, Math.round(params.scale))) : 2
  const mPerPxOut = resMPerPx / s
  const roofWm = 14
  const roofHm = 9
  const wPx = Math.min(params.widthPx * 0.45, Math.max(30, roofWm / mPerPxOut))
  const hPx = Math.min(params.heightPx * 0.45, Math.max(30, roofHm / mPerPxOut))
  const cx = params.widthPx / 2
  const cy = params.heightPx / 2
  const x0 = clamp(cx - wPx / 2, 0, params.widthPx)
  const x1 = clamp(cx + wPx / 2, 0, params.widthPx)
  const y0 = clamp(cy - hPx / 2, 0, params.heightPx)
  const y1 = clamp(cy + hPx / 2, 0, params.heightPx)
  const toN = (x: number, y: number) => [x / params.widthPx, y / params.heightPx]
  return {
    type: "Polygon",
    coordinates: [[toN(x0, y0), toN(x1, y0), toN(x1, y1), toN(x0, y1)]],
  }
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

  let svc = process.env.SEGMENT_SERVICE_URL?.trim() || null
  if (!svc) svc = await detectLocalSegmenter()
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

      const lockedFootprint = (meta as any)?.osmFootprint
      if (extractGeojsonRingNorm(lockedFootprint)) {
        return NextResponse.json(
          {
            roofPolygon: lockedFootprint,
            source: "osm_footprint_user",
            confidence: 0.7,
          },
          { status: 200 }
        )
      }

      try {
        // 1) Try to resolve a likely building element via Nominatim reverse.
        let elements = [] as any[]
        let reverseElements = [] as any[]
        try {
          const rev = await nominatimReverse({ lat: focusLatLng.lat, lng: focusLatLng.lng, signal: upstreamSignal })
          if (looksLikeBuildingHit(rev) && (rev.osmType === "way" || rev.osmType === "relation") && rev.osmId) {
            reverseElements = await fetchOverpassByOsmId({ osmType: rev.osmType, osmId: rev.osmId, signal: upstreamSignal })
          }
        } catch {
          // ignore reverse failures
        }

        // 2) Always also fetch nearby buildings (reverse can be wrong in dense areas).
        let nearbyElements = [] as any[]
        try {
          nearbyElements = await fetchOverpassBuildings({ lat: focusLatLng.lat, lng: focusLatLng.lng, radiusM: 200, signal: upstreamSignal })
        } catch {
          // ignore
        }
        elements = reverseElements.concat(nearbyElements)

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

          const includeCandidates = scored.length > 1
          return NextResponse.json(
            {
              roofPolygon: poly,
              source: "osm_building",
              ...(includeCandidates
                ? {
                    candidates: scored.slice(0, 5).map((c) => ({
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
                    note: "Multiple buildings found. Click Edit to choose.",
                  }
                : {}),
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
              note: "Multiple buildings found. Click Edit to choose.",
            },
            { status: 200 }
          )
        }
      } catch (e) {
        // Overpass is an external dependency; don't hard-fail the UX.
        const timedOut = upstreamSignal.aborted || (e instanceof Error && e.name === "AbortError")
        const poly = fallbackRectRoofPolygon({
          widthPx: metaW,
          heightPx: metaH,
          zoom: metaZoom,
          scale: num((meta as any)?.staticMap?.scale),
        })
        return NextResponse.json(
          {
            roofPolygon: poly,
            source: "fallback_rect",
            confidence: 0.15,
            note:
              (e instanceof Error ? e.message : "Overpass failed") +
              (timedOut ? " (timed out)." : ".") +
              " Using a rough rectangle. For reliable auto-outline, run the Python segmenter and set SEGMENT_SERVICE_URL.",
          },
          { status: 200 }
        )
      }

      const poly = fallbackRectRoofPolygon({
        widthPx: metaW,
        heightPx: metaH,
        zoom: metaZoom,
        scale: num((meta as any)?.staticMap?.scale),
      })
      return NextResponse.json(
        {
          roofPolygon: poly,
          source: "fallback_rect",
          confidence: 0.15,
          note: "No building footprint found near this address. Using a rough rectangle; trace manually or run the Python segmenter (SEGMENT_SERVICE_URL).",
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      {
        roofPolygon: {
          type: "Polygon",
          coordinates: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]],
        },
        source: "fallback_rect",
        confidence: 0.1,
        note: "Auto-outline fallback: SEGMENT_SERVICE_URL not configured and no map metadata available. Using a small rectangle; trace manually or run the Python segmenter.",
      },
      { status: 200 }
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
    // If we have map metadata, use OSM to guide the segmenter to the correct building.
    // If the client already supplied an `osmFootprint`, treat it as locked and do not override.
    let guidedClicks = clicks
    let guidedRoi = roi
    let guidedMeta = meta

    let osmCandidates: Array<Record<string, unknown>> | null = null
    let osmNote: string | null = null

    const clientRing = extractGeojsonRingNorm((guidedMeta as any)?.osmFootprint)

    // Derive default prompts/ROI from a client-provided footprint.
    if (clientRing && metaW !== null && metaH !== null) {
      if (!guidedClicks || guidedClicks.length === 0) {
        const cx = (clientRing.reduce((s, p) => s + p[0], 0) / clientRing.length) * metaW
        const cy = (clientRing.reduce((s, p) => s + p[1], 0) / clientRing.length) * metaH
        guidedClicks = [{ x: cx, y: cy, type: "pos" as const }]
      }

      if (!guidedRoi) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const [nx, ny] of clientRing) {
          const px = nx * metaW
          const py = ny * metaH
          minX = Math.min(minX, px)
          minY = Math.min(minY, py)
          maxX = Math.max(maxX, px)
          maxY = Math.max(maxY, py)
        }
        const pad = 24
        const x = clamp(Math.floor(minX - pad), 0, metaW)
        const y = clamp(Math.floor(minY - pad), 0, metaH)
        const w = clamp(Math.ceil(maxX - minX + pad * 2), 1, metaW - x)
        const h = clamp(Math.ceil(maxY - minY + pad * 2), 1, metaH - y)
        guidedRoi = { x, y, w, h }
      }
    }

    // If we don't have a locked footprint, attempt address-matched OSM guidance.
    if (!clientRing && metaLat !== null && metaLng !== null && metaZoom !== null && metaW !== null && metaH !== null) {
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
        let reverseElements = [] as any[]
        try {
          const rev = await nominatimReverse({ lat: focusLatLng.lat, lng: focusLatLng.lng, signal: upstreamSignal })
          if (looksLikeBuildingHit(rev) && (rev.osmType === "way" || rev.osmType === "relation") && rev.osmId) {
            reverseElements = await fetchOverpassByOsmId({ osmType: rev.osmType, osmId: rev.osmId, signal: upstreamSignal })
          }
        } catch {
          // ignore reverse failures
        }

        let nearbyElements = [] as any[]
        try {
          nearbyElements = await fetchOverpassBuildings({ lat: focusLatLng.lat, lng: focusLatLng.lng, radiusM: 200, signal: upstreamSignal })
        } catch {
          // ignore
        }
        elements = reverseElements.concat(nearbyElements)

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
        const pick = pickTopOrCandidates(scored)

        // Always compute a few candidate footprints for disambiguation.
        osmCandidates = scored.slice(0, 5).map((c) => ({
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
        }))

        if (pick.kind === "candidates") {
          osmNote = "Multiple buildings found. Click Edit to choose."
        }

        // Only lock the footprint when the best candidate actually contains the focus point.
        // In dense areas, addr-tags can be wrong; locking the wrong footprint prevents CV from recovering.
        if (pick.kind === "single" && pick.best.containsFocus) {
          const best = pick.best
          const footprint = normalizeCandidatePolygon(best, tf)

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
            guidedMeta = {
              ...(guidedMeta as any),
              osmBestId: best.id,
              osmSource: "guided",
              // Normalized GeoJSON polygon for the building footprint we believe matches the address.
              // CV services can use this to keep only the roof attached to the requested address.
              osmFootprint: footprint,
            }
          }
        }
      } catch {
        // ignore guidance failures
      }
    }

    // Default ROI: focus segmentation around the interaction point.
    // This helps in dense scenes where a center click might land on a courtyard/pool.
    if (!guidedRoi && metaW !== null && metaH !== null) {
      const posClick = Array.isArray(guidedClicks) ? guidedClicks.find((c) => c.type === "pos") : null
      const fx = posClick ? posClick.x : metaW / 2
      const fy = posClick ? posClick.y : metaH / 2
      const size = Math.round(Math.min(metaW, metaH) * 0.72)
      const x = clamp(Math.floor(fx - size / 2), 0, metaW)
      const y = clamp(Math.floor(fy - size / 2), 0, metaH)
      const w = clamp(size, 1, metaW - x)
      const h = clamp(size, 1, metaH - y)
      guidedRoi = { x, y, w, h }
    }

    // Ensure we always have a default click for SAM-like services.
    if (!guidedRoi && (!guidedClicks || guidedClicks.length === 0) && metaW !== null && metaH !== null) {
      guidedClicks = [{ x: metaW / 2, y: metaH / 2, type: "pos" as const }]
    }

    // Try the most common payloads.
    const base = {
      mode,
      ...(guidedClicks ? { clicks: guidedClicks } : {}),
      ...(guidedRoi ? { roi: guidedRoi } : {}),
      ...(guidedMeta ? { meta: guidedMeta } : {}),
    }

    const attempt1 = await callService({ imageDataUrl, ...base })
    if (attempt1.res.ok) {
      const out = attempt1.json && typeof attempt1.json === "object" ? attempt1.json : {}
      if (osmCandidates && osmCandidates.length) {
        const existing = Array.isArray((out as any).candidates) ? ((out as any).candidates as any[]) : []
        const merged = new Map<string, any>()
        for (const it of existing) {
          const id = typeof it?.id === "string" ? it.id : null
          if (id) merged.set(id, it)
        }
        for (const it of osmCandidates) {
          const id = typeof (it as any)?.id === "string" ? String((it as any).id) : null
          if (id && !merged.has(id)) merged.set(id, it)
        }
        ;(out as any).candidates = Array.from(merged.values())
        if (!(out as any).note && osmNote) (out as any).note = osmNote
      }
      return NextResponse.json(out, { status: 200 })
    }

    // Some services expect `imageRef` instead of `imageDataUrl`.
    const attempt2 = await callService({ imageRef: imageDataUrl, ...base })
    if (attempt2.res.ok) {
      const out = attempt2.json && typeof attempt2.json === "object" ? attempt2.json : {}
      if (osmCandidates && osmCandidates.length) {
        const existing = Array.isArray((out as any).candidates) ? ((out as any).candidates as any[]) : []
        const merged = new Map<string, any>()
        for (const it of existing) {
          const id = typeof it?.id === "string" ? it.id : null
          if (id) merged.set(id, it)
        }
        for (const it of osmCandidates) {
          const id = typeof (it as any)?.id === "string" ? String((it as any).id) : null
          if (id && !merged.has(id)) merged.set(id, it)
        }
        ;(out as any).candidates = Array.from(merged.values())
        if (!(out as any).note && osmNote) (out as any).note = osmNote
      }
      return NextResponse.json(out, { status: 200 })
    }

    // Compatibility: some upstreams require a click even when a box/ROI is provided.
    if ((!guidedClicks || guidedClicks.length === 0) && guidedRoi) {
      const roiClick = { x: guidedRoi.x + guidedRoi.w / 2, y: guidedRoi.y + guidedRoi.h / 2, type: "pos" as const }
      const baseWithClick = { ...base, clicks: [roiClick] }
      const attempt3 = await callService({ imageDataUrl, ...baseWithClick })
      if (attempt3.res.ok) {
        const out = attempt3.json && typeof attempt3.json === "object" ? attempt3.json : {}
        if (osmCandidates && osmCandidates.length) {
          const existing = Array.isArray((out as any).candidates) ? ((out as any).candidates as any[]) : []
          const merged = new Map<string, any>()
          for (const it of existing) {
            const id = typeof it?.id === "string" ? it.id : null
            if (id) merged.set(id, it)
          }
          for (const it of osmCandidates) {
            const id = typeof (it as any)?.id === "string" ? String((it as any).id) : null
            if (id && !merged.has(id)) merged.set(id, it)
          }
          ;(out as any).candidates = Array.from(merged.values())
          if (!(out as any).note && osmNote) (out as any).note = osmNote
        }
        return NextResponse.json(out, { status: 200 })
      }
    }

    const lockedFootprint = (guidedMeta as any)?.osmFootprint
    if (lockedFootprint) {
      return NextResponse.json(
        {
          roofPolygon: lockedFootprint,
          source: "osm_footprint_after_segmenter_error",
          confidence: 0.45,
          note: "CV failed; using OSM outline.",
          ...(osmCandidates && osmCandidates.length ? { candidates: osmCandidates, ...(osmNote ? { note: osmNote } : {}) } : {}),
          debug: { status: attempt2.res.status, details: attempt2.json },
        },
        { status: 200 }
      )
    }

    if (metaZoom !== null && metaW !== null && metaH !== null) {
      const poly = fallbackRectRoofPolygon({
        widthPx: metaW,
        heightPx: metaH,
        zoom: metaZoom,
        scale: num((meta as any)?.staticMap?.scale),
      })
      return NextResponse.json(
        {
          roofPolygon: poly,
          source: "fallback_rect",
          confidence: 0.15,
          note: "CV failed; using rectangle.",
          ...(osmCandidates && osmCandidates.length ? { candidates: osmCandidates, ...(osmNote ? { note: osmNote } : {}) } : {}),
          debug: { status: attempt2.res.status, details: attempt2.json },
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      {
        roofPolygon: {
          type: "Polygon",
          coordinates: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]],
        },
        source: "fallback_rect",
        confidence: 0.1,
        note: "CV failed; using rectangle.",
        ...(osmCandidates && osmCandidates.length ? { candidates: osmCandidates, ...(osmNote ? { note: osmNote } : {}) } : {}),
        debug: { status: attempt2.res.status, details: attempt2.json },
      },
      { status: 200 }
    )
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError"
    const lockedFootprint = (meta as any)?.osmFootprint
    if (lockedFootprint) {
      return NextResponse.json(
        {
          roofPolygon: lockedFootprint,
          source: "osm_footprint_after_segmenter_exception",
          confidence: 0.45,
          note: timedOut ? "Timeout; using OSM outline." : "CV failed; using OSM outline.",
        },
        { status: 200 }
      )
    }
    if (metaZoom !== null && metaW !== null && metaH !== null) {
      const poly = fallbackRectRoofPolygon({
        widthPx: metaW,
        heightPx: metaH,
        zoom: metaZoom,
        scale: num((meta as any)?.staticMap?.scale),
      })
      return NextResponse.json(
        {
          roofPolygon: poly,
          source: "fallback_rect",
          confidence: 0.15,
          note: timedOut ? "Timeout; using rectangle." : "CV failed; using rectangle.",
        },
        { status: 200 }
      )
    }
    return NextResponse.json(
      {
        roofPolygon: {
          type: "Polygon",
          coordinates: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]],
        },
        source: "fallback_rect",
        confidence: 0.1,
        note: timedOut ? "Timeout; using rectangle." : "CV failed; using rectangle.",
      },
      { status: 200 }
    )
  }
}
