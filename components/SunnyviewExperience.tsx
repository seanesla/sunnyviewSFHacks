"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { QRCodeCanvas } from "qrcode.react"
import { HeroSection } from "@/components/hero-section"
import { GlobeView } from "@/components/GlobeView"
import { MapInput, type MapInputResult } from "@/components/MapInput"
import type { PanelSpec, PlacedPanel, Point } from "@/components/PanelPacking"
import { packPanelsDeterministic } from "@/components/PanelPacking"
import { RoofCanvas } from "@/components/RoofCanvas"
import { apiOrigin, apiUrl } from "@/lib/api"
import { cn } from "@/lib/utils"

type Phase = "landing" | "opening" | "app"

type Estimate = {
  annualKwh: number
  monthlyKwh: number[]
  annualCo2Kg: number
  source: "fallback" | "server"
  assumptions?: unknown
}

function coerceNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? n : null
}

function normalizePolygon(data: unknown, w: number, h: number): Point[] | null {
  if (!Array.isArray(data)) return null
  const pts: Point[] = []
  for (const item of data) {
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
  if (pts.length < 3) return null

  const normalized = pts.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
  if (normalized) return pts.map((p) => ({ x: p.x * w, y: p.y * h }))
  return pts
}

export function SunnyviewExperience() {
  const hasBackend = apiOrigin().length > 0
  const [phase, setPhase] = useState<Phase>("landing")
  const [entered, setEntered] = useState(false)
  const opened = phase !== "landing"
  const opening = phase === "opening"
  const globeInteractive = phase === "app"
  const [panelsMounted, setPanelsMounted] = useState(false)

  const globeCardRef = useRef<HTMLDivElement | null>(null)
  const globeFlipFromRef = useRef<DOMRect | null>(null)
  const globeFlipPlayedRef = useRef(false)

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 30)
    return () => window.clearTimeout(t)
  }, [])

  function openApp() {
    if (phase !== "landing") return
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false

    globeFlipFromRef.current = globeCardRef.current?.getBoundingClientRect() ?? null
    globeFlipPlayedRef.current = false

    setPhase("opening")
    window.setTimeout(() => setPanelsMounted(true), reduceMotion ? 0 : 320)
    window.setTimeout(() => setPhase("app"), reduceMotion ? 0 : 1220)
  }

  useLayoutEffect(() => {
    if (phase !== "opening") return
    if (globeFlipPlayedRef.current) return

    const from = globeFlipFromRef.current
    const el = globeCardRef.current
    if (!from || !el) return

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (reduceMotion) return

    const to = el.getBoundingClientRect()
    if (!to.width || !to.height) return

    const dx = from.left - to.left
    const dy = from.top - to.top
    const sx = from.width / to.width
    const sy = from.height / to.height
    const uniformScale = Math.max(0.25, Math.min(3.5, Math.max(sx, sy)))
    const travel = Math.hypot(dx, dy)

    // If the delta is tiny, don't bother animating.
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(1 - uniformScale) < 0.01) {
      globeFlipPlayedRef.current = true
      return
    }

    globeFlipPlayedRef.current = true
    const anim = el.animate(
      [
        {
          transformOrigin: "50% 50%",
          transform: `translate3d(${dx}px, ${dy}px, 0px) scale(${uniformScale})`,
          filter: "brightness(1.08) saturate(1.08)",
          opacity: 0.98,
        },
        {
          offset: 0.64,
          transform: `translate3d(${dx * 0.08}px, ${dy * 0.08}px, 0px) scale(${1 + (uniformScale - 1) * 0.06})`,
          filter: "brightness(1.02) saturate(1.03)",
          opacity: 1,
        },
        {
          transformOrigin: "50% 50%",
          transform: "translate3d(0px, 0px, 0px) scale(1)",
          filter: "brightness(1) saturate(1)",
          opacity: 1,
        },
      ],
      {
        duration: Math.min(1320, Math.max(920, 860 + travel * 0.3)),
        easing: "cubic-bezier(0.16,0.88,0.2,1)",
        fill: "both",
      }
    )
    anim.onfinish = () => {
      try {
        el.style.transform = ""
        el.style.filter = ""
        el.style.opacity = ""
      } catch {
        // ignore
      }
    }
  }, [phase])

  const [mapInput, setMapInput] = useState<MapInputResult>({
    kind: "address",
    address: "",
    lat: null,
    lng: null,
    zoom: 19,
    mPerPx: null,
  })

  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [zoom, setZoom] = useState<number>(19)

  useEffect(() => {
    if (!panelsMounted) return
    if (mapInput.kind !== "address") return
    if (mapInput.lat === null || mapInput.lng === null) return
    setLat(mapInput.lat)
    setLng(mapInput.lng)
    setZoom(mapInput.zoom ?? 19)
  }, [mapInput, panelsMounted])

  useEffect(() => {
    if (!panelsMounted) return
    if (mapInput.kind !== "address") return
    if (mapInput.zoom === null) return
    setZoom(mapInput.zoom)
  }, [mapInput.kind, mapInput.zoom, panelsMounted])

  const mPerPx = mapInput.mPerPx

  const [panelSpec, setPanelSpec] = useState<PanelSpec>({
    widthM: 1.1,
    heightM: 1.7,
    wattW: 400,
    gapM: 0.02,
  })
  const [orientationDeg, setOrientationDeg] = useState<number>(0)
  const [tiltDeg, setTiltDeg] = useState<number>(20)
  const [azimuthDeg, setAzimuthDeg] = useState<number>(180)
  const [lossesPct, setLossesPct] = useState<number>(14)

  const [vertices, setVertices] = useState<Point[]>([])
  const [closed, setClosed] = useState<boolean>(false)
  const [panels, setPanels] = useState<PlacedPanel[]>([])

  const [estimate, setEstimate] = useState<Estimate>({
    annualKwh: 0,
    monthlyKwh: Array.from({ length: 12 }, () => 0),
    annualCo2Kg: 0,
    source: "fallback",
  })

  const panelCount = panels.length
  const dcKw = useMemo(() => (panelCount * panelSpec.wattW) / 1000, [panelCount, panelSpec.wattW])

  const fallbackEstimate = useMemo((): Estimate => {
    const annualKwh = Math.max(0, dcKw) * 1400
    const monthly = Array.from({ length: 12 }, () => annualKwh / 12)
    const annualCo2Kg = annualKwh * 0.4
    return { annualKwh, monthlyKwh: monthly, annualCo2Kg, source: "fallback" }
  }, [dcKw])

  useEffect(() => {
    if (!panelsMounted) return
    setEstimate((prev) => (prev.source === "server" ? prev : fallbackEstimate))
  }, [fallbackEstimate, panelsMounted])

  useEffect(() => {
    if (!panelsMounted) return
    const t = window.setTimeout(() => {
      if (!closed || vertices.length < 3 || !mPerPx) {
        setPanels([])
        return
      }
      setPanels(
        packPanelsDeterministic({
          usablePolygon: vertices,
          mPerPx,
          panel: { widthM: panelSpec.widthM, heightM: panelSpec.heightM, gapM: panelSpec.gapM },
          orientationDeg,
        })
      )
    }, 80)
    return () => window.clearTimeout(t)
  }, [panelsMounted, closed, vertices, mPerPx, panelSpec.widthM, panelSpec.heightM, panelSpec.gapM, orientationDeg])

  const estimateAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!panelsMounted) return
    const hasSite = Number.isFinite(lat ?? NaN) && Number.isFinite(lng ?? NaN)
    if (!hasSite || dcKw <= 0) return
    const t = window.setTimeout(async () => {
      estimateAbortRef.current?.abort()
      const ac = new AbortController()
      estimateAbortRef.current = ac
      try {
        const res = await fetch(apiUrl("/api/estimate"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            siteSpec: { lat, lng, tiltDeg, azimuthDeg, lossesPct },
            layoutSummary: { dcKw, panelCount, orientationDeg },
            panelSpec,
          }),
        })
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as any
        const annualKwh = coerceNumber(data?.annualKwh) ?? coerceNumber(data?.estimate?.annualKwh)
        const annualCo2Kg = coerceNumber(data?.annualCo2Kg) ?? coerceNumber(data?.estimate?.annualCo2Kg)
        const monthlyKwh = Array.isArray(data?.monthlyKwh) ? data.monthlyKwh.map((v: any) => Number(v) || 0) : null
        if (annualKwh === null || annualCo2Kg === null) return
        setEstimate({
          annualKwh,
          annualCo2Kg,
          monthlyKwh: monthlyKwh && monthlyKwh.length === 12 ? monthlyKwh : Array.from({ length: 12 }, () => annualKwh / 12),
          source: "server",
          assumptions: data?.assumptions ?? data?.estimate?.assumptions,
        })
      } catch {
        // keep fallback
      }
    }, 320)
    return () => window.clearTimeout(t)
  }, [panelsMounted, lat, lng, tiltDeg, azimuthDeg, lossesPct, dcKw, panelCount, orientationDeg, panelSpec])

  const background = useMemo(() => {
    if (mapInput.kind === "image" && mapInput.image) {
      return {
        kind: "image" as const,
        dataUrl: mapInput.image.dataUrl,
        widthPx: mapInput.image.widthPx,
        heightPx: mapInput.image.heightPx,
      }
    }
    if (mapInput.kind === "address" && lat !== null && lng !== null) {
      return { kind: "osm" as const, lat, lng, zoom }
    }
    return { kind: "none" as const }
  }, [lat, lng, mapInput.kind, mapInput.image, zoom])

  const [projectId, setProjectId] = useState<string | null>(null)
  const [shareSlug, setShareSlug] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const creatingProjectRef = useRef(false)
  const projectCreateFailedRef = useRef(false)

  useEffect(() => {
    if (!panelsMounted) return
    if (!hasBackend) return
    if (projectCreateFailedRef.current) return
    const hasSeed =
      (mapInput.kind === "address" && Number.isFinite(lat ?? NaN) && Number.isFinite(lng ?? NaN)) ||
      (mapInput.kind === "image" && !!mapInput.image?.dataUrl)
    if (!hasSeed) return
    if (projectId) return
    if (creatingProjectRef.current) return

    let cancelled = false
    ;(async () => {
      creatingProjectRef.current = true
      try {
        const res = await fetch(apiUrl("/api/projects"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Untitled",
            siteSpec: lat !== null && lng !== null ? { lat, lng, tiltDeg, azimuthDeg, lossesPct } : undefined,
            panelSpec,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json().catch(() => null)) as any
        if (cancelled) return
        const id = String(data?.projectId ?? data?.id ?? data?.project?.id ?? "")
        const slug = String(data?.shareSlug ?? data?.project?.shareSlug ?? "")
        if (id) setProjectId(id)
        if (slug) setShareSlug(slug)
      } catch {
        projectCreateFailedRef.current = true
        // ignore
      } finally {
        creatingProjectRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [panelsMounted, hasBackend, azimuthDeg, lat, lng, lossesPct, mapInput, panelSpec, projectId, tiltDeg])

  useEffect(() => {
    if (!panelsMounted) return
    if (!projectId) return
    const t = window.setTimeout(async () => {
      try {
        await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteSpec: lat !== null && lng !== null ? { lat, lng, tiltDeg, azimuthDeg, lossesPct } : undefined,
            panelSpec,
            layoutSummary: { dcKw, panelCount, orientationDeg },
            geometry: { vertices, closed, mPerPx, background: mapInput.kind, zoom },
            estimate,
          }),
        })
      } catch {
        // ignore
      }
    }, 900)
    return () => window.clearTimeout(t)
  }, [
    panelsMounted,
    azimuthDeg,
    closed,
    dcKw,
    estimate,
    lat,
    lng,
    lossesPct,
    mPerPx,
    mapInput.kind,
    orientationDeg,
    panelCount,
    panelSpec,
    projectId,
    tiltDeg,
    vertices,
    zoom,
  ])

  const [explainLoading, setExplainLoading] = useState(false)
  const [explainText, setExplainText] = useState<{ bullets: string[]; caveat: string } | null>(null)
  const [ttsLoading, setTtsLoading] = useState(false)

  async function runExplain() {
    setExplainLoading(true)
    try {
      const res = await fetch(apiUrl("/api/explain"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          estimate,
          assumptions: { siteSpec: { lat, lng, tiltDeg, azimuthDeg, lossesPct }, panelSpec, orientationDeg, panelCount, dcKw },
        }),
      })
      const data = (await res.json().catch(() => null)) as any
      const bullets = Array.isArray(data?.bullets) ? data.bullets.map((b: any) => String(b)) : null
      const caveat = data?.caveat ? String(data.caveat) : "Solar output is an estimate; shading, tilt, and local conditions can change results."
      if (bullets && bullets.length) {
        setExplainText({ bullets: bullets.slice(0, 3), caveat })
      } else {
        setExplainText({
          bullets: [
            `This layout fits ${panelCount} panels (${dcKw.toFixed(1)} kW DC).`,
            `Estimated annual energy: ${Math.round(estimate.annualKwh).toLocaleString()} kWh.`,
            `Estimated annual CO₂ avoided: ${Math.round(estimate.annualCo2Kg).toLocaleString()} kg.`,
          ],
          caveat,
        })
      }
    } catch {
      setExplainText({
        bullets: [
          `This layout fits ${panelCount} panels (${dcKw.toFixed(1)} kW DC).`,
          `Estimated annual energy: ${Math.round(estimate.annualKwh).toLocaleString()} kWh.`,
          `Estimated annual CO₂ avoided: ${Math.round(estimate.annualCo2Kg).toLocaleString()} kg.`,
        ],
        caveat: "Solar output is an estimate; shading, tilt, and local conditions can change results.",
      })
    } finally {
      setExplainLoading(false)
    }
  }

  async function runTalk() {
    const text =
      explainText?.bullets?.join(" ") ??
      `This layout fits ${panelCount} panels (${dcKw.toFixed(1)} kilowatts DC) and produces about ${Math.round(estimate.annualKwh).toLocaleString()} kilowatt-hours per year.`
    setTtsLoading(true)
    try {
      const res = await fetch(apiUrl("/api/tts"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })
      const data = (await res.json().catch(() => null)) as any
      const audioUrl = typeof data?.audioUrl === "string" ? data.audioUrl : null
      if (!audioUrl) return
      const audio = new Audio(audioUrl)
      await audio.play()
    } catch {
      // ignore
    } finally {
      setTtsLoading(false)
    }
  }

  async function runAutoOutline() {
    if (mapInput.kind !== "image" || !mapInput.image?.dataUrl) return
    try {
      const res = await fetch(apiUrl("/api/segment"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: mapInput.image.dataUrl,
          mode: "roof",
        }),
      })
      if (!res.ok) return
      const data = (await res.json().catch(() => null)) as any
      const polyRaw =
        data?.roofPolygon ??
        data?.polygon ??
        data?.usablePolygon ??
        data?.result?.roofPolygon ??
        data?.result?.polygon
      const w = mapInput.image.widthPx
      const h = mapInput.image.heightPx
      const poly = normalizePolygon(polyRaw, w, h)
      if (!poly) return
      setVertices(poly)
      setClosed(true)
    } catch {
      // ignore
    }
  }

  const shareUrl = useMemo(() => {
    if (!shareSlug) return null
    if (typeof window === "undefined") return null
    return `${window.location.origin}/s/${shareSlug}`
  }, [shareSlug])

  const leftPanel = (
    <div className="space-y-4">
      <MapInput value={mapInput} onChange={setMapInput} />

      <div className="rounded-xl border border-border bg-card/40 p-4 backdrop-blur-sm">
        <div className="text-sm font-semibold text-foreground">Site + assumptions</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Latitude</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={lat ?? ""}
              onChange={(e) => setLat(coerceNumber(e.target.value))}
              placeholder="34.0522"
              inputMode="decimal"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Longitude</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={lng ?? ""}
              onChange={(e) => setLng(coerceNumber(e.target.value))}
              placeholder="-118.2437"
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Tilt (deg)</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={tiltDeg}
              onChange={(e) => setTiltDeg(Number(e.target.value) || 0)}
              inputMode="decimal"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Azimuth (deg)</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={azimuthDeg}
              onChange={(e) => setAzimuthDeg(Number(e.target.value) || 0)}
              inputMode="decimal"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Losses (%)</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={lossesPct}
              onChange={(e) => setLossesPct(Number(e.target.value) || 0)}
              inputMode="decimal"
            />
          </label>
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
        onVerticesChange={(v) => {
          setVertices(v)
          if (v.length < 3) setClosed(false)
        }}
        onClosedChange={setClosed}
        onAutoOutline={runAutoOutline}
      />
    </div>
  )

  const rightPanel = (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/40 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">Results</div>
          <div className="text-xs text-muted-foreground">{estimate.source === "server" ? "Server estimate" : "Fallback"}</div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Panels</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{panelCount}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">DC kW</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{dcKw.toFixed(1)}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Annual kWh</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{Math.round(estimate.annualKwh).toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Annual CO₂ (kg)</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{Math.round(estimate.annualCo2Kg).toLocaleString()}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={runExplain}
            disabled={explainLoading || panelCount === 0}
          >
            {explainLoading ? "Explaining…" : "Explain"}
          </button>
          <button
            type="button"
            className="rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            onClick={runTalk}
            disabled={ttsLoading || panelCount === 0}
          >
            {ttsLoading ? "Talking…" : "Talk"}
          </button>
          <button
            type="button"
            className="rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            onClick={() => setShowShare((s) => !s)}
            disabled={!shareSlug}
            title={!shareSlug ? "Create a project to enable sharing." : "Share"}
          >
            Share
          </button>
        </div>

        {explainText && (
          <div className="mt-3 rounded-lg border border-border bg-background/40 p-3 text-sm text-foreground">
            <ul className="list-disc space-y-1 pl-5">
              {explainText.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-muted-foreground">{explainText.caveat}</div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card/40 p-4 backdrop-blur-sm">
        <div className="text-sm font-semibold text-foreground">Panel packing</div>
        <div className="mt-3 grid gap-3">
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Orientation (deg)</div>
            <input
              type="range"
              min={-90}
              max={90}
              step={1}
              value={orientationDeg}
              onChange={(e) => setOrientationDeg(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-xs text-muted-foreground">{orientationDeg}°</div>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <div className="text-xs text-muted-foreground">Panel W (m)</div>
              <input
                className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
                value={panelSpec.widthM}
                onChange={(e) => setPanelSpec((p) => ({ ...p, widthM: Number(e.target.value) || p.widthM }))}
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs text-muted-foreground">Panel H (m)</div>
              <input
                className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
                value={panelSpec.heightM}
                onChange={(e) => setPanelSpec((p) => ({ ...p, heightM: Number(e.target.value) || p.heightM }))}
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs text-muted-foreground">Watt (W)</div>
              <input
                className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
                value={panelSpec.wattW}
                onChange={(e) => setPanelSpec((p) => ({ ...p, wattW: Number(e.target.value) || p.wattW }))}
                inputMode="numeric"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs text-muted-foreground">Gap (m)</div>
              <input
                className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
                value={panelSpec.gapM}
                onChange={(e) => setPanelSpec((p) => ({ ...p, gapM: Number(e.target.value) || p.gapM }))}
                inputMode="decimal"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1000px_700px_at_12%_18%,oklch(0.72_0.18_var(--accent-hue)_/_0.16),transparent_60%),radial-gradient(900px_650px_at_84%_26%,oklch(0.68_0.16_calc(var(--accent-hue)+50)_/_0.12),transparent_62%),radial-gradient(800px_520px_at_55%_88%,oklch(0.6_0.14_calc(var(--accent-hue)-70)_/_0.10),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-black/10 to-black/55" />

      <div className="relative mx-auto h-full max-w-screen-2xl px-5 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="grid h-full grid-rows-[1fr]">
          <div
            className={cn(
              "grid h-full grid-cols-1 gap-6",
              opened
                ? "lg:grid-cols-[minmax(360px,440px)_minmax(520px,1fr)_minmax(360px,440px)]"
                : "lg:grid-cols-[minmax(380px,520px)_minmax(560px,1fr)]"
            )}
          >
            <aside
              className={cn(
                "relative min-h-0",
                "transition-[opacity,transform,filter] duration-[1100ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                opened ? "opacity-100 blur-0" : "opacity-100 blur-0"
              )}
            >
              <div className="absolute inset-0 h-full min-h-0 overflow-auto pr-1">
                <div
                  className={cn(
                    "transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                    entered && !opened ? "opacity-100 translate-x-0 blur-0" : "opacity-0 -translate-x-8 blur-md pointer-events-none"
                  )}
                >
                  <HeroSection onStart={openApp} visible={entered && !opened} />
                </div>
              </div>

              <div
                className={cn(
                  "absolute inset-0 h-full min-h-0 overflow-auto pr-1",
                  "transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                  opened
                    ? opening
                      ? "opacity-100 translate-x-0 blur-0 delay-[420ms]"
                      : "opacity-100 translate-x-0 blur-0 delay-0"
                    : "opacity-0 -translate-x-10 blur-md pointer-events-none delay-0"
                )}
              >
                {panelsMounted ? leftPanel : null}
              </div>
            </aside>

            <section className="min-h-0">
              <div
                ref={globeCardRef}
                className={cn(
                  "relative h-[min(560px,62vh)] w-full rounded-2xl border border-border/60 bg-card/10 backdrop-blur-sm lg:h-[min(820px,84vh)]",
                  "transition-[opacity,filter,box-shadow] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                  entered ? "opacity-100" : "opacity-0",
                  opened ? "blur-0" : "blur-0",
                  opening ? "shadow-[0_38px_110px_-42px_rgba(0,0,0,0.82)]" : "shadow-[0_24px_72px_-40px_rgba(0,0,0,0.68)]"
                )}
                style={{ willChange: "transform" }}
              >
                <GlobeView
                  lat={lat}
                  lng={lng}
                  showUi={false}
                  interactive={globeInteractive}
                  onPrimaryClick={opened ? undefined : openApp}
                  frame={false}
                  variant="hero"
                  className="h-full w-full"
                />

                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-0 z-10 rounded-2xl transition-opacity duration-[720ms] ease-[cubic-bezier(0.2,0.85,0.2,1)]",
                    opening ? "opacity-100" : "opacity-0"
                  )}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(62%_54%_at_50%_46%,oklch(0.84_0.16_var(--accent-hue)_/_0.22),transparent_74%)]" />
                  <div
                    className={cn(
                      "absolute -left-1/3 top-[-22%] h-[150%] w-[66%] rotate-[14deg] bg-[linear-gradient(90deg,transparent_0%,oklch(0.95_0.03_var(--accent-hue)_/_0.36)_52%,transparent_100%)] blur-2xl transition-transform duration-[1100ms] ease-[cubic-bezier(0.18,0.9,0.2,1)]",
                      opening ? "translate-x-[245%]" : "translate-x-0"
                    )}
                  />
                </div>

                <div
                  className={cn(
                    "pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur transition-[opacity,transform,filter] duration-700 ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                    opened ? "translate-y-2 opacity-0 blur-sm" : "translate-y-0 opacity-100 blur-0"
                  )}
                >
                  Click the Earth
                </div>
              </div>
            </section>

            {opened ? (
              <aside className="min-h-0">
                <div className="h-full min-h-0 overflow-auto pl-1">
                  <div
                    className={cn(
                      "transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                      opened
                        ? opening
                          ? "opacity-100 translate-x-0 blur-0 delay-[480ms]"
                          : "opacity-100 translate-x-0 blur-0 delay-0"
                        : "opacity-0 translate-x-10 blur-md pointer-events-none delay-0"
                    )}
                  >
                    {panelsMounted ? rightPanel : null}
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>

      {showShare && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">Share</div>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => setShowShare(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-3 rounded-lg border border-border bg-card p-4">
              {shareUrl ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid place-items-center">
                    <QRCodeCanvas value={shareUrl} size={156} includeMargin />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Public link</div>
                    <div className="break-all rounded-md border border-border bg-background/40 p-2 text-xs text-foreground">
                      {shareUrl}
                    </div>
                    <button
                      type="button"
                      className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(shareUrl)
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Share link not available yet.</div>
              )}
            </div>
            {shareSlug && (
              <div className="mt-3 text-xs text-muted-foreground">
                Share slug: <span className="text-foreground">{shareSlug}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
