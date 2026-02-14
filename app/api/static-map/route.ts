import { NextRequest } from "next/server"
import { requestClientKey, takeRateLimitToken } from "@/lib/rate-limit"

export const runtime = "nodejs"

const ROUTE_TIMEOUT_MS = 12_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 45
const LOG_PREFIX = "[static-map]"

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function parseNum(value: string | null) {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mercatorProject(lat: number, lng: number) {
  const R = 6378137
  const clampedLat = clamp(lat, -85.05112878, 85.05112878)
  const x = (lng * Math.PI * R) / 180
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))
  return { x, y }
}

function mercatorResolutionMetersPerPx(zoom: number) {
  const R = 6378137
  const z = Math.round(clamp(zoom, 0, 22))
  return (2 * Math.PI * R) / (256 * Math.pow(2, z))
}

async function geocodeAddressViaNominatim(address: string, signal: AbortSignal) {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("format", "json")
  url.searchParams.set("limit", "1")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("q", address)

  const res = await fetch(url.toString(), {
    signal,
    headers: {
      accept: "application/json",
      "user-agent": "sunnyviewSFHacks/1.0 (static-map proxy)",
    },
  })
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const data = (await res.json().catch(() => null)) as any
  const hit = Array.isArray(data) ? data[0] : null
  const lat = hit ? Number(hit.lat) : NaN
  const lng = hit ? Number(hit.lon) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("No geocoding results")
  return { lat, lng }
}

async function geocodeAddressViaEsri(address: string, signal: AbortSignal) {
  const url = new URL(
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
  )
  url.searchParams.set("f", "json")
  url.searchParams.set("singleLine", address)
  url.searchParams.set("maxLocations", "1")
  url.searchParams.set("category", "Address")
  url.searchParams.set("countryCode", "USA")

  const res = await fetch(url.toString(), { signal, headers: { accept: "application/json", "accept-language": "en" } })
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const data = (await res.json().catch(() => null)) as any
  const cand = Array.isArray(data?.candidates) ? data.candidates[0] : null
  const lat = Number(cand?.location?.y)
  const lng = Number(cand?.location?.x)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("No geocoding results")
  return { lat, lng }
}

async function geocodeAddress(address: string, signal: AbortSignal) {
  try {
    const out = await geocodeAddressViaEsri(address, signal)
    console.info(`${LOG_PREFIX} geocode`, { provider: "esri", lat: Number(out.lat.toFixed(6)), lng: Number(out.lng.toFixed(6)) })
    return out
  } catch (e) {
    const message = e instanceof Error ? e.message : "Esri geocoder failed"
    console.warn(`${LOG_PREFIX} geocode provider failed`, { provider: "esri", message })
  }

  const out = await geocodeAddressViaNominatim(address, signal)
  console.info(`${LOG_PREFIX} geocode`, { provider: "nominatim", lat: Number(out.lat.toFixed(6)), lng: Number(out.lng.toFixed(6)) })
  return out
}

type ImageFetchResult =
  | { ok: true; body: ArrayBuffer; contentType: string; durationMs: number }
  | {
      ok: false
      durationMs: number
      status: number
      kind: "fetch" | "http" | "non-image" | "empty"
      details: string
      contentType?: string
    }

async function fetchUpstreamImage(url: URL, signal: AbortSignal): Promise<ImageFetchResult> {
  const startedAt = Date.now()
  let res: Response

  try {
    res = await fetch(url.toString(), {
      signal,
      headers: { accept: "image/*" },
      cache: "no-store",
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fetch failed"
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      status: 0,
      kind: "fetch",
      details: message,
    }
  }

  const durationMs = Date.now() - startedAt
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return {
      ok: false,
      durationMs,
      status: res.status,
      kind: "http",
      details: text.slice(0, 500),
      contentType: res.headers.get("content-type") ?? "",
    }
  }

  const contentTypeRaw = res.headers.get("content-type") ?? ""
  const contentType = contentTypeRaw.toLowerCase()
  if (!contentType.startsWith("image/")) {
    const text = await res.text().catch(() => "")
    return {
      ok: false,
      durationMs,
      status: 502,
      kind: "non-image",
      details: text.slice(0, 500),
      contentType: contentTypeRaw,
    }
  }

  const body = await res.arrayBuffer()
  if (!body.byteLength) {
    return {
      ok: false,
      durationMs,
      status: 502,
      kind: "empty",
      details: "Provider returned an empty image body",
      contentType: contentTypeRaw,
    }
  }

  return {
    ok: true,
    body,
    contentType: contentTypeRaw || "image/png",
    durationMs,
  }
}

function buildArcgisStaticUrl(params: { bbox: string; outW: number; outH: number }) {
  const url = new URL("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export")
  url.searchParams.set("bbox", params.bbox)
  url.searchParams.set("bboxSR", "3857")
  url.searchParams.set("imageSR", "3857")
  url.searchParams.set("size", `${params.outW},${params.outH}`)
  url.searchParams.set("format", "png32")
  url.searchParams.set("f", "image")
  return url
}

function buildMapboxStaticUrl(params: {
  lat: number
  lng: number
  zoom: number
  outW: number
  outH: number
  token: string
}) {
  const center = `${params.lng.toFixed(6)},${params.lat.toFixed(6)},${Math.round(params.zoom)},0`
  const size = `${Math.round(params.outW)}x${Math.round(params.outH)}`
  return new URL(
    `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center}/${size}?access_token=${encodeURIComponent(params.token)}`
  )
}

export async function GET(req: NextRequest) {
  const clientKey = requestClientKey(req.headers)
  const rate = takeRateLimitToken({
    key: `static-map:${clientKey}`,
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!rate.ok) {
    return Response.json(
      { error: "Too many static-map requests. Please slow down." },
      {
        status: 429,
        headers: { "retry-after": String(rate.retryAfterSec) },
      }
    )
  }

  const { searchParams } = new URL(req.url)

  const address = (searchParams.get("address") ?? "").trim()
  const latParam = parseNum(searchParams.get("lat"))
  const lngParam = parseNum(searchParams.get("lng"))

  const zoom = clamp(parseNum(searchParams.get("zoom")) ?? 19, 0, 22)
  const w = clamp(Math.round(parseNum(searchParams.get("w")) ?? 520), 64, 2048)
  const h = clamp(Math.round(parseNum(searchParams.get("h")) ?? 360), 64, 2048)
  const scale = clamp(Math.round(parseNum(searchParams.get("scale")) ?? 2), 1, 2)

  const ac = new AbortController()
  const signal = ac.signal
  const timeout = setTimeout(() => ac.abort(), ROUTE_TIMEOUT_MS)

  let lat = latParam
  let lng = lngParam

  console.info(`${LOG_PREFIX} request`, {
    hasAddress: !!address,
    hasCoords: lat !== null && lng !== null,
    zoom,
    w,
    h,
    scale,
  })

  try {
    if (lat === null || lng === null) {
      if (!address) {
        return Response.json({ error: "Provide either (lat,lng) or address." }, { status: 400 })
      }
      const hit = await geocodeAddress(address, signal)
      lat = hit.lat
      lng = hit.lng
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ error: "Invalid coordinates." }, { status: 400 })
    }

    lat = clamp(lat, -85.05112878, 85.05112878)
    lng = clamp(lng, -180, 180)

    const outW = clamp(w * scale, 64, 2048)
    const outH = clamp(h * scale, 64, 2048)

    const { x, y } = mercatorProject(lat, lng)
    const resMPerPx = mercatorResolutionMetersPerPx(zoom)
    const halfWm = (resMPerPx * w) / 2
    const halfHm = (resMPerPx * h) / 2
    const bbox = `${(x - halfWm).toFixed(6)},${(y - halfHm).toFixed(6)},${(x + halfWm).toFixed(6)},${(y + halfHm).toFixed(6)}`

    let lastFailure: ImageFetchResult | null = null
    const arcgisAttempts = [
      { outW, outH, label: `scale-${scale}` },
      ...(scale > 1 ? [{ outW: w, outH: h, label: "scale-1-fallback" }] : []),
    ]

    for (const attempt of arcgisAttempts) {
      const url = buildArcgisStaticUrl({ bbox, outW: attempt.outW, outH: attempt.outH })
      const img = await fetchUpstreamImage(url, signal)
      if (img.ok) {
        console.info(`${LOG_PREFIX} success`, {
          provider: "arcgis",
          attempt: attempt.label,
          durationMs: img.durationMs,
          bytes: img.body.byteLength,
          contentType: img.contentType,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          zoom,
        })
        return new Response(img.body, {
          status: 200,
          headers: {
            "content-type": img.contentType,
            "cache-control": "public, max-age=86400, s-maxage=86400",
            "x-static-map-provider": "arcgis",
            "x-static-map-attempt": attempt.label,
          },
        })
      }

      lastFailure = img
      console.warn(`${LOG_PREFIX} arcgis failed`, {
        attempt: attempt.label,
        kind: img.kind,
        status: img.status,
        durationMs: img.durationMs,
        contentType: img.contentType ?? "",
        details: img.details.slice(0, 220),
      })
    }

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ?? ""
    if (mapboxToken) {
      const mapboxUrl = buildMapboxStaticUrl({ lat, lng, zoom, outW, outH, token: mapboxToken })
      const mapboxImage = await fetchUpstreamImage(mapboxUrl, signal)
      if (mapboxImage.ok) {
        console.info(`${LOG_PREFIX} success`, {
          provider: "mapbox",
          durationMs: mapboxImage.durationMs,
          bytes: mapboxImage.body.byteLength,
          contentType: mapboxImage.contentType,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          zoom,
        })
        return new Response(mapboxImage.body, {
          status: 200,
          headers: {
            "content-type": mapboxImage.contentType,
            "cache-control": "public, max-age=86400, s-maxage=86400",
            "x-static-map-provider": "mapbox",
          },
        })
      }

      lastFailure = mapboxImage
      console.warn(`${LOG_PREFIX} mapbox fallback failed`, {
        kind: mapboxImage.kind,
        status: mapboxImage.status,
        durationMs: mapboxImage.durationMs,
        contentType: mapboxImage.contentType ?? "",
        details: mapboxImage.details.slice(0, 220),
      })
    }

    const status = lastFailure && lastFailure.status > 0 ? 502 : 500
    return Response.json(
      {
        error: "Static map providers unavailable.",
        details: lastFailure?.details ?? "No provider response",
      },
      { status }
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "Static map failed."
    const timedOut = signal.aborted
    console.error(`${LOG_PREFIX} failed`, {
      timedOut,
      message,
    })
    return Response.json(
      { error: timedOut ? "Static map request timed out. Please try again." : message },
      { status: timedOut ? 504 : 500 }
    )
  } finally {
    clearTimeout(timeout)
    ac.abort()
  }
}
