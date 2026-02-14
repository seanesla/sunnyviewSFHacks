import { NextRequest } from "next/server"

import { requestClientKey, takeRateLimitToken } from "@/lib/rate-limit"

export const runtime = "nodejs"

const ROUTE_TIMEOUT_MS = 10_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 90

type ReverseOut = {
  lat: number
  lng: number
  displayName: string
  provider: "esri" | "nominatim" | "none"
}

type CacheEntry = { t: number; payload: ReverseOut }
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 500

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function parseNum(value: string | null) {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function cacheMap() {
  const g = globalThis as unknown as { __sunnyviewReverseGeocodeCache?: Map<string, CacheEntry> }
  if (!g.__sunnyviewReverseGeocodeCache) g.__sunnyviewReverseGeocodeCache = new Map()
  return g.__sunnyviewReverseGeocodeCache
}

function cacheGet(key: string) {
  const hit = cacheMap().get(key)
  if (!hit) return null
  if (Date.now() - hit.t > CACHE_TTL_MS) return null
  return hit.payload
}

function cacheSet(key: string, payload: ReverseOut) {
  const map = cacheMap()
  map.set(key, { t: Date.now(), payload })
  if (map.size > CACHE_MAX_ENTRIES) {
    const oldestKey = map.keys().next().value
    if (oldestKey) map.delete(oldestKey)
  }
}

async function fetchEsriReverse(lat: number, lng: number, signal: AbortSignal): Promise<string | null> {
  const url = new URL("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode")
  url.searchParams.set("f", "json")
  url.searchParams.set("location", `${lng},${lat}`)
  url.searchParams.set("outSR", "4326")
  url.searchParams.set("langCode", "EN")

  const res = await fetch(url.toString(), {
    signal,
    headers: { accept: "application/json", "accept-language": "en" },
  })
  if (!res.ok) return null
  const json = (await res.json().catch(() => null)) as any
  const longLabel = typeof json?.address?.LongLabel === "string" ? json.address.LongLabel : null
  const match = typeof json?.address?.Match_addr === "string" ? json.address.Match_addr : null
  return (longLabel ?? match ?? null)?.trim() || null
}

async function fetchNominatimReverse(lat: number, lng: number, signal: AbortSignal): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("lat", String(lat))
  url.searchParams.set("lon", String(lng))
  url.searchParams.set("zoom", "18")
  url.searchParams.set("addressdetails", "1")

  const res = await fetch(url.toString(), {
    signal,
    headers: {
      accept: "application/json",
      "accept-language": "en",
      "user-agent": "sunnyviewSFHacks/1.0 (reverse geocode proxy)",
    },
  })
  if (!res.ok) return null
  const json = (await res.json().catch(() => null)) as any
  const displayName = typeof json?.display_name === "string" ? json.display_name : null
  return displayName?.trim() || null
}

export async function GET(req: NextRequest) {
  const clientKey = requestClientKey(req.headers)
  const rate = takeRateLimitToken({
    key: `reverse-geocode:${clientKey}`,
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!rate.ok) {
    return Response.json(
      { error: "Too many reverse-geocode requests. Please slow down." },
      {
        status: 429,
        headers: { "retry-after": String(rate.retryAfterSec) },
      }
    )
  }

  const { searchParams } = new URL(req.url)
  const latRaw = parseNum(searchParams.get("lat"))
  const lngRaw = parseNum(searchParams.get("lng"))
  if (latRaw === null || lngRaw === null) {
    return Response.json({ error: "Missing lat/lng" }, { status: 400 })
  }

  const lat = clamp(latRaw, -85.05112878, 85.05112878)
  const lng = clamp(lngRaw, -180, 180)

  const key = `rev:${lat.toFixed(5)}:${lng.toFixed(5)}`
  const cached = cacheGet(key)
  if (cached) return Response.json(cached, { status: 200 })

  const ac = new AbortController()
  const timeoutId = setTimeout(() => ac.abort(), ROUTE_TIMEOUT_MS)

  try {
    const esri = await fetchEsriReverse(lat, lng, ac.signal)
    if (esri) {
      const out: ReverseOut = { lat, lng, displayName: esri, provider: "esri" }
      cacheSet(key, out)
      return Response.json(out, { status: 200 })
    }

    const nom = await fetchNominatimReverse(lat, lng, ac.signal)
    if (nom) {
      const out: ReverseOut = { lat, lng, displayName: nom, provider: "nominatim" }
      cacheSet(key, out)
      return Response.json(out, { status: 200 })
    }

    const out: ReverseOut = {
      lat,
      lng,
      displayName: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      provider: "none",
    }
    cacheSet(key, out)
    return Response.json(out, { status: 200 })
  } finally {
    clearTimeout(timeoutId)
    ac.abort()
  }
}
