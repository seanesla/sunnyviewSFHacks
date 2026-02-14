import { NextRequest } from "next/server"

export const runtime = "nodejs"

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function parseNum(value: string | null) {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mercatorProject(lat: number, lng: number) {
  // EPSG:3857 spherical mercator (meters)
  const R = 6378137
  const clampedLat = clamp(lat, -85.05112878, 85.05112878)
  const x = (lng * Math.PI * R) / 180
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))
  return { x, y }
}

function mercatorResolutionMetersPerPx(zoom: number) {
  // Pixel resolution in EPSG:3857 at given zoom (slippy map scale).
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
      // Nominatim policy requests identifying UA; this is best-effort in a demo app.
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
    return await geocodeAddressViaEsri(address, signal)
  } catch {
    return await geocodeAddressViaNominatim(address, signal)
  }
}

export async function GET(req: NextRequest) {
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

  let lat = latParam
  let lng = lngParam

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
    const halfWm = (resMPerPx * outW) / 2
    const halfHm = (resMPerPx * outH) / 2
    const bbox = `${(x - halfWm).toFixed(6)},${(y - halfHm).toFixed(6)},${(x + halfWm).toFixed(6)},${(y + halfHm).toFixed(6)}`

    // No API key required for this public export endpoint (good for demos).
    // Imagery/terms are governed by Esri/ArcGIS Online.
    const staticUrl = new URL("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export")
    staticUrl.searchParams.set("bbox", bbox)
    staticUrl.searchParams.set("bboxSR", "3857")
    staticUrl.searchParams.set("imageSR", "3857")
    staticUrl.searchParams.set("size", `${outW},${outH}`)
    staticUrl.searchParams.set("format", "png32")
    staticUrl.searchParams.set("f", "image")

    const imgRes = await fetch(staticUrl.toString(), { signal, headers: { accept: "image/*" } })
    if (!imgRes.ok) {
      const text = await imgRes.text().catch(() => "")
      return Response.json(
        { error: `Static image failed (${imgRes.status})`, details: text.slice(0, 500) },
        { status: 502 }
      )
    }

    const contentType = imgRes.headers.get("content-type") ?? "image/png"
    const body = await imgRes.arrayBuffer()

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=86400",
      },
    })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Static map failed." }, { status: 500 })
  } finally {
    ac.abort()
  }
}
