"use client"

import dynamic from "next/dynamic"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { GlobeView } from "@/components/GlobeView"
import { RoofCanvas } from "@/components/RoofCanvas"
import type { PanelSpec, Point } from "@/components/PanelPacking"
import { packPanelsDeterministic } from "@/components/PanelPacking"
import { apiUrl } from "@/lib/api"

const Globe = dynamic(() => Promise.resolve(GlobeView), { ssr: false })

type Snapshot = {
  siteSpec?: { lat?: number; lng?: number }
  panelSpec?: Partial<PanelSpec>
  layoutSummary?: { orientationDeg?: number }
  geometry?: {
    vertices?: Array<{ x: number; y: number }> | Array<[number, number]>
    closed?: boolean
    mPerPx?: number
    background?: "address" | "image"
    zoom?: number
  }
  estimate?: { annualKwh?: number; annualCo2Kg?: number; monthlyKwh?: number[] }
}

function coerceNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? n : null
}

function normalizeVertices(v: unknown): Point[] | null {
  if (!Array.isArray(v)) return null
  const pts: Point[] = []
  for (const item of v) {
    if (Array.isArray(item) && item.length >= 2) {
      const x = coerceNumber(item[0])
      const y = coerceNumber(item[1])
      if (x === null || y === null) return null
      pts.push({ x, y })
      continue
    }
    if (item && typeof item === "object") {
      const x = coerceNumber((item as any).x)
      const y = coerceNumber((item as any).y)
      if (x === null || y === null) return null
      pts.push({ x, y })
      continue
    }
    return null
  }
  return pts.length >= 3 ? pts : null
}

export default function SharePage() {
  const params = useParams<{ shareSlug: string }>()
  const shareSlug = String(params?.shareSlug ?? "")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(apiUrl(`/s/${encodeURIComponent(shareSlug)}`), {
          method: "GET",
          headers: { accept: "application/json" },
        })
        const ct = res.headers.get("content-type") ?? ""
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        if (!ct.includes("application/json")) {
          throw new Error("Share endpoint did not return JSON. Set NEXT_PUBLIC_API_ORIGIN to your backend host.")
        }
        const data = (await res.json().catch(() => null)) as any
        if (cancelled) return
        setSnapshot((data?.project ?? data) as Snapshot)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Failed to load share snapshot.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [shareSlug])

  const lat = snapshot?.siteSpec?.lat ?? null
  const lng = snapshot?.siteSpec?.lng ?? null
  const orientationDeg = snapshot?.layoutSummary?.orientationDeg ?? 0

  const panelSpec: PanelSpec = useMemo(
    () => ({
      widthM: snapshot?.panelSpec?.widthM ?? 1.1,
      heightM: snapshot?.panelSpec?.heightM ?? 1.7,
      wattW: snapshot?.panelSpec?.wattW ?? 400,
      gapM: snapshot?.panelSpec?.gapM ?? 0.02,
    }),
    [snapshot]
  )

  const vertices = useMemo(() => normalizeVertices(snapshot?.geometry?.vertices) ?? [], [snapshot])
  const closed = snapshot?.geometry?.closed ?? true
  const mPerPx = snapshot?.geometry?.mPerPx ?? null
  const zoom = snapshot?.geometry?.zoom ?? 19

  const background = useMemo(() => {
    if (snapshot?.geometry?.background === "address" && lat !== null && lng !== null) {
      return { kind: "osm" as const, lat, lng, zoom }
    }
    return { kind: "none" as const }
  }, [lat, lng, snapshot?.geometry?.background, zoom])

  const panels = useMemo(() => {
    if (!closed || vertices.length < 3 || !mPerPx) return []
    return packPanelsDeterministic({
      usablePolygon: vertices,
      mPerPx,
      panel: { widthM: panelSpec.widthM, heightM: panelSpec.heightM, gapM: panelSpec.gapM },
      orientationDeg,
    })
  }, [closed, vertices, mPerPx, panelSpec.widthM, panelSpec.heightM, panelSpec.gapM, orientationDeg])

  const panelCount = panels.length
  const dcKw = (panelCount * panelSpec.wattW) / 1000
  const annualKwh = snapshot?.estimate?.annualKwh ?? dcKw * 1400
  const annualCo2Kg = snapshot?.estimate?.annualCo2Kg ?? annualKwh * 0.4

  return (
    <div className="flex min-h-screen w-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border/50 bg-background/80 px-5 backdrop-blur">
        <div className="text-sm font-semibold text-foreground">sunnyview</div>
        <div className="text-xs text-muted-foreground">Share: /s/{shareSlug}</div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-5">
        {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Couldn’t load share snapshot</div>
            <div className="mt-1">{error}</div>
          </div>
        )}

        {!loading && !error && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Panels</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{panelCount}</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">DC kW</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{dcKw.toFixed(1)}</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Annual kWh</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{Math.round(annualKwh).toLocaleString()}</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 md:col-span-2">
                  <div className="text-xs text-muted-foreground">Annual CO₂ (kg)</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {Math.round(annualCo2Kg).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Location</div>
                  <div className="mt-1 text-sm text-foreground">
                    {lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "—"}
                  </div>
                </div>
              </div>

              <RoofCanvas
                background={background}
                mPerPx={mPerPx}
                orientationDeg={orientationDeg}
                panelSpec={panelSpec}
                vertices={vertices}
                closed={closed}
                panels={panels}
                mode="view"
              />
            </div>

            <div className="h-[620px]">
              <Globe lat={lat} lng={lng} className="h-full" />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
