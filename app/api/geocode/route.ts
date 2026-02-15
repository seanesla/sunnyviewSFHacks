import { NextRequest } from "next/server"
import { requestClientKey, takeRateLimitToken } from "@/lib/rate-limit"

export const runtime = "nodejs"

type NominatimHit = {
  place_id?: number
  osm_type?: string
  osm_id?: number
  lat?: string
  lon?: string
  display_name?: string
  importance?: number
  class?: string
  type?: string
  address?: Record<string, unknown>
}

type EsriSuggest = {
  text?: string
  magicKey?: string
  isCollection?: boolean
}

type EsriCandidate = {
  address?: string
  location?: { x?: number; y?: number }
  score?: number
}

type GeocodeResult = {
  id: string
  lat: number | null
  lng: number | null
  displayName: string
  score: number
  magicKey?: string | null
  address: {
    houseNumber: string | null
    road: string | null
    city: string | null
    town: string | null
    village: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
    country: string | null
  } | null
  meta: { class: string | null; type: string | null; importance: number | null }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function parseNum(value: string | null) {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseStr(value: string | null) {
  const s = (value ?? "").trim()
  return s.length ? s : null
}

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function normStreet(s: string) {
  const tokens = norm(s).split(" ")
  const expanded = tokens.map((t) => {
    switch (t) {
      case "st":
        return "street"
      case "rd":
        return "road"
      case "dr":
        return "drive"
      case "ave":
        return "avenue"
      case "blvd":
        return "boulevard"
      case "hwy":
        return "highway"
      case "pkwy":
        return "parkway"
      case "ln":
        return "lane"
      case "ct":
        return "court"
      case "pl":
        return "place"
      case "trl":
        return "trail"
      case "cir":
        return "circle"
      default:
        return t
    }
  })
  return expanded.join(" ").trim()
}

function parseHouseNumber(query: string) {
  const m = query.trim().match(/^(\d{1,8})\b/)
  return m ? m[1] : null
}

function parseStreetPart(query: string) {
  const s = query.trim().replace(/^\d{1,8}\s+/, "")
  return s.length ? s : null
}

function stableId(hit: NominatimHit) {
  if (typeof hit.place_id === "number") return `place:${hit.place_id}`
  const osmType = typeof hit.osm_type === "string" ? hit.osm_type : null
  const osmId = typeof hit.osm_id === "number" ? hit.osm_id : null
  if (osmType && osmId !== null) return `osm:${osmType}:${osmId}`
  return `coord:${hit.lat ?? "?"},${hit.lon ?? "?"}`
}

function scoreHit(query: string, hit: NominatimHit) {
  const qNorm = norm(query)
  const qHouse = parseHouseNumber(query)
  const qStreet = parseStreetPart(query)
  const qStreetNorm = qStreet ? normStreet(qStreet) : null

  const display = typeof hit.display_name === "string" ? hit.display_name : ""
  const displayNorm = norm(display)

  const address = hit.address ?? {}
  const road =
    typeof address.road === "string"
      ? address.road
      : typeof address.pedestrian === "string"
        ? address.pedestrian
        : typeof address.footway === "string"
          ? address.footway
          : ""
  const roadNorm = road ? normStreet(road) : null

  const house =
    typeof address.house_number === "string"
      ? address.house_number
      : typeof address.housenumber === "string"
        ? address.housenumber
        : null

  let score = 0
  const importance = typeof hit.importance === "number" ? hit.importance : 0
  score += importance * 10

  if (qHouse && house && norm(house) === norm(qHouse)) score += 80
  if (qStreetNorm && roadNorm) {
    if (roadNorm === qStreetNorm) score += 35
    else if (roadNorm.includes(qStreetNorm) || qStreetNorm.includes(roadNorm)) score += 20
  }

  if (qNorm && displayNorm.includes(qNorm)) score += 10

  const cls = typeof hit.class === "string" ? hit.class : ""
  const type = typeof hit.type === "string" ? hit.type : ""
  if (type === "house" || type === "building" || type === "residential") score += 20
  if (cls === "highway" && (type === "motorway" || type === "trunk")) score -= 30

  // Prefer results with locality context when user doesn't provide it.
  const hasLocality =
    typeof address.city === "string" ||
    typeof address.town === "string" ||
    typeof address.village === "string" ||
    typeof address.suburb === "string"
  if (hasLocality) score += 5

  return score
}

async function fetchEsri({
  q,
  limit,
  biasLat,
  biasLng,
  magicKey,
  signal,
}: {
  q: string
  limit: number
  biasLat: number | null
  biasLng: number | null
  magicKey: string | null
  signal: AbortSignal
}) {
  const url = new URL(
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
  )
  url.searchParams.set("f", "json")
  url.searchParams.set("singleLine", q)
  url.searchParams.set("maxLocations", String(limit))
  url.searchParams.set("category", "Address")
  url.searchParams.set("countryCode", "USA")
  if (biasLat !== null && biasLng !== null) {
    url.searchParams.set("location", `${biasLng},${biasLat}`)
  }
  if (magicKey) {
    url.searchParams.set("magicKey", magicKey)
  }

  const res = await fetch(url.toString(), {
    signal,
    headers: { accept: "application/json", "accept-language": "en" },
  })
  if (!res.ok) throw new Error(`Geocoder error (${res.status})`)
  const data = (await res.json().catch(() => null)) as any
  const candidates = Array.isArray(data?.candidates) ? (data.candidates as EsriCandidate[]) : []
  return candidates
}

async function fetchEsriSuggest({
  q,
  limit,
  biasLat,
  biasLng,
  signal,
}: {
  q: string
  limit: number
  biasLat: number | null
  biasLng: number | null
  signal: AbortSignal
}) {
  const url = new URL("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest")
  url.searchParams.set("f", "json")
  url.searchParams.set("text", q)
  url.searchParams.set("maxSuggestions", String(limit))
  url.searchParams.set("category", "Address")
  url.searchParams.set("countryCode", "USA")
  if (biasLat !== null && biasLng !== null) {
    url.searchParams.set("location", `${biasLng},${biasLat}`)
  }

  const res = await fetch(url.toString(), { signal, headers: { accept: "application/json", "accept-language": "en" } })
  if (!res.ok) throw new Error(`Geocoder error (${res.status})`)
  const data = (await res.json().catch(() => null)) as any
  const suggestions = Array.isArray(data?.suggestions) ? (data.suggestions as EsriSuggest[]) : []
  return suggestions
}

async function fetchNominatim({
  q,
  limit,
  biasLat,
  biasLng,
  signal,
}: {
  q: string
  limit: number
  biasLat: number | null
  biasLng: number | null
  signal: AbortSignal
}) {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("dedupe", "1")
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("q", q)

  if (biasLat !== null && biasLng !== null) {
    const delta = 0.5
    const left = clamp(biasLng - delta, -180, 180)
    const right = clamp(biasLng + delta, -180, 180)
    const bottom = clamp(biasLat - delta, -90, 90)
    const top = clamp(biasLat + delta, -90, 90)
    url.searchParams.set("viewbox", `${left},${top},${right},${bottom}`)
  }

  const res = await fetch(url.toString(), {
    signal,
    headers: {
      accept: "application/json",
      "accept-language": "en",
      "user-agent": "sunnyviewSFHacks/1.0 (geocode proxy)",
    },
  })
  if (!res.ok) throw new Error(`Geocoder error (${res.status})`)
  const data = (await res.json().catch(() => null)) as unknown
  return Array.isArray(data) ? (data as NominatimHit[]) : []
}

type CacheEntry = { t: number; payload: { results: GeocodeResult[]; warning: string | null } }
const CACHE_TTL_MS = 30_000
const CACHE_MAX_ENTRIES = 300
const ROUTE_TIMEOUT_MS = 11_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 90

function cacheMap() {
  const g = globalThis as unknown as { __sunnyviewGeocodeCache?: Map<string, CacheEntry> }
  if (!g.__sunnyviewGeocodeCache) g.__sunnyviewGeocodeCache = new Map()
  return g.__sunnyviewGeocodeCache
}

function cacheSet(key: string, payload: { results: GeocodeResult[]; warning: string | null }) {
  const map = cacheMap()
  map.set(key, { t: Date.now(), payload })
  if (map.size > CACHE_MAX_ENTRIES) {
    const oldestKey = map.keys().next().value
    if (oldestKey) map.delete(oldestKey)
  }
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export async function GET(req: NextRequest) {
  const clientKey = requestClientKey(req.headers)
  const rate = takeRateLimitToken({
    key: `geocode:${clientKey}`,
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!rate.ok) {
    return Response.json(
      { error: "Too many geocode requests. Please slow down." },
      {
        status: 429,
        headers: { "retry-after": String(rate.retryAfterSec) },
      }
    )
  }

  const { searchParams } = new URL(req.url)
  const mode = (searchParams.get("mode") ?? "lookup").trim()

  const q = (searchParams.get("q") ?? "").trim()
  if (!q) return Response.json({ error: "Missing q" }, { status: 400 })

  const limit = clamp(Math.round(parseNum(searchParams.get("limit")) ?? 8), 1, 15)
  const biasLat = parseNum(searchParams.get("biasLat"))
  const biasLng = parseNum(searchParams.get("biasLng"))

  const ambiguous = !q.includes(",")

  const ac = new AbortController()
  const signal = ac.signal
  const timeoutId = setTimeout(() => ac.abort(), ROUTE_TIMEOUT_MS)

  try {
    const biasKey =
      biasLat !== null && biasLng !== null ? `${Math.round(biasLat * 1000) / 1000},${Math.round(biasLng * 1000) / 1000}` : "-"

    if (mode === "suggest") {
      const cacheKey = `suggest::${q}::${limit}::${biasKey}`
      const cached = cacheMap().get(cacheKey)
      if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
        return Response.json(cached.payload, { status: 200 })
      }

      const suggestions = await fetchEsriSuggest({ q, limit, biasLat, biasLng, signal })
      const results: GeocodeResult[] = suggestions
        .map((s) => {
          const displayName = typeof s.text === "string" ? s.text.trim() : null
          const magicKey = typeof s.magicKey === "string" ? s.magicKey.trim() : null
          if (!displayName || !magicKey) return null
          return {
            id: `esri_suggest:${magicKey}`,
            lat: null,
            lng: null,
            displayName,
            score: 0,
            magicKey,
            address: null,
            meta: { class: "esri", type: "suggest", importance: null },
          }
        })
        .filter(Boolean) as GeocodeResult[]

      const payload = { results, warning: null }
      cacheSet(cacheKey, payload)
      return Response.json(payload, { status: 200 })
    }

    if (mode === "resolve") {
      const magicKey = parseStr(searchParams.get("magicKey"))
      if (!magicKey) return Response.json({ error: "Missing magicKey" }, { status: 400 })

      const cacheKey = `resolve::${q}::${magicKey}::${biasKey}`
      const cached = cacheMap().get(cacheKey)
      if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
        return Response.json(cached.payload, { status: 200 })
      }

      const candidates = await fetchEsri({ q, limit: 1, biasLat, biasLng, magicKey, signal })
      const c = candidates[0]
      const displayName = typeof c?.address === "string" ? c.address : null
      const lat = typeof c?.location?.y === "number" ? c.location.y : NaN
      const lng = typeof c?.location?.x === "number" ? c.location.x : NaN
      const score = typeof c?.score === "number" ? c.score : NaN
      if (!displayName || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(score)) {
        return Response.json({ results: [], warning: "No results. Try a more specific address." }, { status: 200 })
      }

      const payload = {
        results: [
          {
            id: `esri:${encodeURIComponent(displayName)}:${lng.toFixed(6)},${lat.toFixed(6)}`,
            lat,
            lng,
            displayName,
            score,
            address: null,
            meta: { class: "esri", type: "candidate", importance: null },
          } satisfies GeocodeResult,
        ],
        warning: null,
      }
      cacheSet(cacheKey, payload)
      return Response.json(payload, { status: 200 })
    }

    const cacheKey = `lookup::${q}::${limit}::${biasKey}`
    const cached = cacheMap().get(cacheKey)
    if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
      return Response.json(cached.payload, { status: 200 })
    }

    const results: GeocodeResult[] = []

    // 1) Esri first (often provides rooftop-level matches for US addresses).
    try {
      const candidates = await fetchEsri({ q, limit, biasLat, biasLng, magicKey: null, signal })
      for (const c of candidates) {
        const displayName = typeof c.address === "string" ? c.address : null
        const lat = typeof c.location?.y === "number" ? c.location.y : NaN
        const lng = typeof c.location?.x === "number" ? c.location.x : NaN
        const score = typeof c.score === "number" ? c.score : NaN
        if (!displayName || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(score)) continue
        results.push({
          id: `esri:${encodeURIComponent(displayName)}:${lng.toFixed(6)},${lat.toFixed(6)}`,
          lat,
          lng,
          displayName,
          score,
          address: null,
          meta: { class: "esri", type: "candidate", importance: null },
        })
      }
    } catch {
      // ignore Esri failures; we'll fall back to Nominatim
    }

    // 2) Nominatim fallback (and additional candidates if Esri yields none).
    if (results.length === 0) {
      const hits = await fetchNominatim({ q, limit, biasLat, biasLng, signal })
      const nomResults = hits
        .map((hit) => {
        const lat = hit.lat ? Number(hit.lat) : NaN
        const lng = hit.lon ? Number(hit.lon) : NaN
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
        const displayName = typeof hit.display_name === "string" ? hit.display_name : `${lat}, ${lng}`
        const score = scoreHit(q, hit)
        const addr = hit.address ?? {}
        const getStr = (k: string) => (typeof (addr as any)[k] === "string" ? String((addr as any)[k]) : null)
        return {
          id: stableId(hit),
          lat,
          lng,
          displayName,
          score,
          address: hit.address
            ? {
                houseNumber: getStr("house_number") ?? getStr("housenumber"),
                road: getStr("road") ?? getStr("pedestrian") ?? getStr("footway"),
                city: getStr("city"),
                town: getStr("town"),
                village: getStr("village"),
                suburb: getStr("suburb"),
                state: getStr("state"),
                postcode: getStr("postcode"),
                country: getStr("country"),
              }
            : null,
          meta: {
            class: typeof hit.class === "string" ? hit.class : null,
            type: typeof hit.type === "string" ? hit.type : null,
            importance: typeof hit.importance === "number" ? hit.importance : null,
          },
        } satisfies GeocodeResult
      })
      .filter(Boolean) as GeocodeResult[]

      results.push(...nomResults)
    }

    const bias = biasLat !== null && biasLng !== null ? { lat: biasLat, lng: biasLng } : null
    results.sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0)
      if (scoreDiff !== 0) return scoreDiff
      if (bias) {
        const da =
          a.lat !== null && a.lng !== null ? haversineKm({ lat: a.lat, lng: a.lng }, bias) : Infinity
        const db =
          b.lat !== null && b.lng !== null ? haversineKm({ lat: b.lat, lng: b.lng }, bias) : Infinity
        const dDiff = da - db
        if (Number.isFinite(dDiff) && dDiff !== 0) return dDiff
      }
      return a.displayName.localeCompare(b.displayName)
    })

    const qHouse = parseHouseNumber(q)

    let warning: string | null =
      ambiguous && results.length > 1
        ? "This address looks ambiguous. Add city/state (e.g., “..., Los Angeles, CA”) or pick a match below."
        : null

    if (qHouse && results.length > 0) {
      const rx = new RegExp(`\\b${qHouse}\\b`)
      const hasHouse = results.some((r) => rx.test(r.displayName))
      if (!hasHouse) {
        warning = "House number not found. Results are street-level; zoom in and use Rectangle -> Auto-line."
      }
    }

    const payload = { results, warning }
    cacheSet(cacheKey, payload)
    return Response.json(payload, { status: 200 })
  } catch (e) {
    // Upstream providers (Esri / Nominatim) can rate-limit or transiently fail.
    // Return a non-fatal payload so the UI can prompt the user to retry.
    const msg = e instanceof Error ? e.message : "Geocoding failed."
    const warning = signal.aborted
      ? "Geocoding timed out. Please try again."
      : "Geocoding is temporarily unavailable. Please try again in a moment."
    return Response.json(
      {
        results: [],
        warning,
        error: msg,
      },
      { status: 200 }
    )
  } finally {
    clearTimeout(timeoutId)
    ac.abort()
  }
}
