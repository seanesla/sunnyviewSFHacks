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

function num(x: unknown) {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

function isLikelyUrl(s: string) {
  return /^https?:\/\//i.test(s) || s.startsWith("/")
}

async function imageUrlToDataUrl(imageUrl: string, reqUrl: string) {
  const abs = new URL(imageUrl, reqUrl)
  const res = await fetch(abs.toString(), { cache: "no-store", headers: { accept: "image/*" } })
  if (!res.ok) throw new Error(`Image fetch failed (${res.status})`)
  const ct = res.headers.get("content-type") ?? "image/png"
  const ab = await res.arrayBuffer()
  const base64 = Buffer.from(ab).toString("base64")
  return `data:${ct};base64,${base64}`
}

export async function POST(req: Request) {
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
          const rev = await nominatimReverse({ lat: focusLatLng.lat, lng: focusLatLng.lng })
          if (looksLikeBuildingHit(rev) && (rev.osmType === "way" || rev.osmType === "relation") && rev.osmId) {
            elements = await fetchOverpassByOsmId({ osmType: rev.osmType, osmId: rev.osmId })
          }
        } catch {
          // ignore reverse failures
        }

        // 2) Fallback: nearby buildings.
        if (!elements.length) {
          elements = await fetchOverpassBuildings({ lat: focusLatLng.lat, lng: focusLatLng.lng, radiusM: 160 })
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
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Overpass failed", source: "osm_error" },
          { status: 502 }
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
      imageDataUrl = await imageUrlToDataUrl(imageUrl, req.url)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to fetch image" }, { status: 502 })
    }
  }

  if (!imageDataUrl) {
    return NextResponse.json({ error: "Provide imageDataUrl or imageUrl" }, { status: 400 })
  }

  const svcUrl = `${svc.replace(/\/$/, "")}/segment`

  async function callService(payload: Record<string, unknown>) {
    const res = await fetch(svcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    })
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
          const rev = await nominatimReverse({ lat: focusLatLng.lat, lng: focusLatLng.lng })
          if (looksLikeBuildingHit(rev) && (rev.osmType === "way" || rev.osmType === "relation") && rev.osmId) {
            elements = await fetchOverpassByOsmId({ osmType: rev.osmType, osmId: rev.osmId })
          }
        } catch {
          // ignore reverse failures
        }
        if (!elements.length) {
          elements = await fetchOverpassBuildings({ lat: focusLatLng.lat, lng: focusLatLng.lng, radiusM: 160 })
        }

        const hints = parseAddressHints(metaAddress)
        if (hints?.houseNumber) {
          try {
            const tagged = await fetchOverpassByHouseNumber({
              lat: focusLatLng.lat,
              lng: focusLatLng.lng,
              radiusM: 260,
              houseNumber: hints.houseNumber,
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
    return NextResponse.json({ error: e instanceof Error ? e.message : "Segmentation exception" }, { status: 502 })
  }
}
