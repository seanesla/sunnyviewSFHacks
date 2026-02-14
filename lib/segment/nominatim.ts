import { clamp } from "@/lib/segment/mercator"

type ReverseHit = {
  osm_type?: unknown
  osm_id?: unknown
  category?: unknown
  type?: unknown
  address?: unknown
}

function str(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function num(v: unknown) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export type NominatimReverseResult = {
  osmType: "way" | "relation" | "node" | null
  osmId: number | null
  category: string | null
  type: string | null
  address: Record<string, unknown> | null
}

export async function nominatimReverse(opts: { lat: number; lng: number; signal?: AbortSignal }): Promise<NominatimReverseResult> {
  const lat = clamp(opts.lat, -85.05112878, 85.05112878)
  const lng = clamp(opts.lng, -180, 180)

  const url = new URL("https://nominatim.openstreetmap.org/reverse")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("lat", String(lat))
  url.searchParams.set("lon", String(lng))
  url.searchParams.set("zoom", "18")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("extratags", "1")

  const res = await fetch(url.toString(), {
    signal: opts.signal,
    headers: { accept: "application/json", "accept-language": "en", "user-agent": "sunnyviewSFHacks/1.0 (segment proxy)" },
  })
  if (!res.ok) throw new Error(`Nominatim reverse failed (${res.status})`)
  const json = (await res.json().catch(() => null)) as ReverseHit | null

  const osmTypeRaw = str(json?.osm_type)
  const osmType = osmTypeRaw === "way" || osmTypeRaw === "relation" || osmTypeRaw === "node" ? osmTypeRaw : null
  const osmId = num(json?.osm_id)
  const category = str(json?.category)
  const type = str(json?.type)
  const address = json?.address && typeof json.address === "object" ? (json.address as Record<string, unknown>) : null

  return {
    osmType,
    osmId: osmId !== null ? Math.round(osmId) : null,
    category,
    type,
    address,
  }
}

export function looksLikeBuildingHit(hit: NominatimReverseResult) {
  if (!hit.osmType || !hit.osmId) return false
  const cat = (hit.category ?? "").toLowerCase()
  const type = (hit.type ?? "").toLowerCase()
  if (cat === "building") return true
  if (type === "house" || type === "residential" || type === "building") return true
  return false
}
