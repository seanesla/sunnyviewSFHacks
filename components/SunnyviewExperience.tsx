"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Settings2 } from "lucide-react"
import { QRCodeCanvas } from "qrcode.react"
import { HeroSection } from "@/components/hero-section"
import { GlobeStage } from "@/components/GlobeStage"
import { MapInput, type MapInputResult } from "@/components/MapInput"
import type { PanelSpec, PlacedPanel, Point } from "@/components/PanelPacking"
import { packPanelsDeterministic } from "@/components/PanelPacking"
import { RoofCanvas } from "@/components/RoofCanvas"
import { BackgroundScene } from "@/components/BackgroundScene"
import { AnimatedNumber } from "@/components/AnimatedNumber"
import { useIsMobile } from "@/hooks/use-mobile"
import { apiOrigin, apiUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

type Phase = "landing" | "opening" | "app"

type Estimate = {
  annualKwh: number
  monthlyKwh: number[]
  annualCo2Kg: number
  source: "fallback" | "server"
  assumptions?: unknown
}

function dist2(a: Point, b: Point) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function centroid(points: Point[]) {
  if (!points.length) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / points.length, y: sy / points.length }
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

function unwrapGeoPolygon(data: unknown): unknown {
  if (!data || typeof data !== "object") return data
  const t = (data as any).type
  const coords = (data as any).coordinates
  if (t === "Polygon" && Array.isArray(coords) && Array.isArray(coords[0])) return coords[0]
  if (t === "MultiPolygon" && Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
    return coords[0][0]
  }
  return data
}

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function convexHull(points: Point[]) {
  const pts = points
    .slice()
    .sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x))
  if (pts.length <= 1) return pts

  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }

  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }

  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

function rotate(p: Point, angleRad: number): Point {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

function normalizeDeg180(deg: number) {
  let d = ((deg % 180) + 180) % 180 // [0, 180)
  if (d > 90) d -= 180
  return d
}

function minimumAreaBoundingRect(points: Point[]) {
  if (points.length < 3) return null
  const hull = convexHull(points)
  if (hull.length < 3) return null

  let bestArea = Infinity
  let bestAngle = 0
  let best: { minX: number; maxX: number; minY: number; maxY: number } | null = null

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const rotAngle = -angle

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of hull) {
      const r = rotate(p, rotAngle)
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x)
      maxY = Math.max(maxY, r.y)
    }

    const area = (maxX - minX) * (maxY - minY)
    if (area < bestArea) {
      bestArea = area
      bestAngle = angle
      best = { minX, maxX, minY, maxY }
    }
  }

  if (!best) return null

  const rectRot: Point[] = [
    { x: best.minX, y: best.minY },
    { x: best.maxX, y: best.minY },
    { x: best.maxX, y: best.maxY },
    { x: best.minX, y: best.maxY },
  ]
  const rect = rectRot.map((p) => rotate(p, bestAngle))
  return { rect, angleDeg: (bestAngle * 180) / Math.PI }
}

export function SunnyviewExperience() {
  const hasBackend = apiOrigin().length > 0
  const isMobile = useIsMobile()
  const ADDRESS_IMAGE_SCALE = 2
  const [phase, setPhase] = useState<Phase>("landing")
  const [entered, setEntered] = useState(false)
  const opened = phase !== "landing"
  const opening = phase === "opening"
  const globeInteractive = phase === "app"
  const [panelsMounted, setPanelsMounted] = useState(false)
  const [mobilePane, setMobilePane] = useState<"setup" | "results">("setup")

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 30)
    return () => window.clearTimeout(t)
  }, [])

  function openApp() {
    if (phase !== "landing") return
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    setPhase("opening")
    window.setTimeout(() => setPanelsMounted(true), reduceMotion ? 0 : 220)
    window.setTimeout(() => setPhase("app"), reduceMotion ? 0 : 900)
  }

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
        src: mapInput.image.dataUrl,
        widthPx: mapInput.image.widthPx,
        heightPx: mapInput.image.heightPx,
      }
    }
    if (mapInput.kind === "address" && lat !== null && lng !== null) {
      const w = 520
      const h = 360
      const scale = ADDRESS_IMAGE_SCALE
      const qs = new URLSearchParams()
      qs.set("lat", String(lat))
      qs.set("lng", String(lng))
      qs.set("zoom", String(zoom))
      qs.set("w", String(w))
      qs.set("h", String(h))
      qs.set("scale", String(scale))
      return {
        kind: "image" as const,
        src: `/api/static-map?${qs.toString()}`,
        widthPx: w * scale,
        heightPx: h * scale,
      }
    }
    return { kind: "none" as const }
  }, [lat, lng, mapInput.kind, mapInput.image, zoom])

  const backgroundSrc = background.kind === "image" ? background.src : null

  const [projectId, setProjectId] = useState<string | null>(null)
  const [shareSlug, setShareSlug] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const creatingProjectRef = useRef(false)
  const projectCreateFailedRef = useRef(false)

  function returnToLanding() {
    setShowShare(false)
    setPhase("landing")
  }

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

  const [autoOutlineBusy, setAutoOutlineBusy] = useState(false)
  const [autoOutlineError, setAutoOutlineError] = useState<string | null>(null)
  const [autoOutlineHint, setAutoOutlineHint] = useState<string | null>(null)
  const autoOutlineAbortRef = useRef<AbortController | null>(null)
  const lastAutoOutlineKeyRef = useRef<string | null>(null)
  const [autoOutlineCandidates, setAutoOutlineCandidates] = useState<Array<{ id: string; polygon: Point[]; score?: number }> | null>(null)

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

  async function runAutoOutline(opts?: { imageUrl?: string }) {
    try {
      if (background.kind !== "image") return

      setAutoOutlineError(null)
      setAutoOutlineHint(null)
      setAutoOutlineBusy(true)
      setAutoOutlineCandidates(null)

      autoOutlineAbortRef.current?.abort()
      const ac = new AbortController()
      autoOutlineAbortRef.current = ac

      const payload =
        mapInput.kind === "image" && mapInput.image?.dataUrl
          ? { imageDataUrl: mapInput.image.dataUrl }
          : { imageUrl: opts?.imageUrl ?? background.src }

      // Encourage the segmenter to pick the roof at the map center (address-selected house).
      const cxPx = background.widthPx / 2
      const cyPx = background.heightPx / 2
      const clicks = [
        { x: cxPx, y: cyPx, type: "pos" as const },
        { x: cxPx + 14, y: cyPx, type: "pos" as const },
        { x: cxPx, y: cyPx + 14, type: "pos" as const },
      ]
      const roiSize = Math.round(Math.min(background.widthPx, background.heightPx) * 0.55)
      const roi = {
        x: Math.max(0, Math.round(cxPx - roiSize / 2)),
        y: Math.max(0, Math.round(cyPx - roiSize / 2)),
        w: roiSize,
        h: roiSize,
      }

      const res = await fetch(apiUrl("/api/segment"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          ...payload,
          mode: "roof",
          clicks,
          roi,
          meta:
            mapInput.kind === "address"
              ? {
                  lat,
                  lng,
                  zoom,
                  address: mapInput.address,
                  widthPx: background.widthPx,
                  heightPx: background.heightPx,
                  staticMap: { w: 520, h: 360, scale: 2 },
                }
              : undefined,
        }),
      })

      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : typeof data?.message === "string"
              ? data.message
              : `Auto-outline failed (HTTP ${res.status})`
        setAutoOutlineError(msg)
        setAutoOutlineHint(null)
        toast({ title: "Auto-outline failed", description: msg, variant: "destructive" })
        return
      }

      const w = background.widthPx
      const h = background.heightPx

      if (Array.isArray(data?.candidates)) {
        const parsedCandidates: Array<{ id: string; polygon: Point[]; score?: number }> = []
        for (const c of data.candidates as any[]) {
          const id = typeof c?.id === "string" ? c.id : null
          const polyRaw = c?.polygon ?? c?.roofPolygon ?? c?.poly
          if (!id || !polyRaw) continue
          const pts = normalizePolygon(unwrapGeoPolygon(polyRaw), w, h)
          if (!pts) continue
          parsedCandidates.push({ id, polygon: pts, score: typeof c?.score === "number" ? c.score : undefined })
        }
        if (parsedCandidates.length) {
          setAutoOutlineCandidates(parsedCandidates)
          setAutoOutlineHint("Click the correct roof")
          setAutoOutlineError(null)
          toast({ title: "Pick the correct roof", description: "Multiple nearby buildings matched this address. Click the correct roof outline." })
          return
        }
      }

      const polyRaw =
        data?.roofPolygon ??
        data?.polygon ??
        data?.usablePolygon ??
        data?.roofPolygons ??
        data?.polygons ??
        data?.result?.roofPolygon ??
        data?.result?.polygon ??
        data?.result?.roofPolygons ??
        data?.result?.polygons

      const focus = { x: cxPx, y: cyPx }

      let poly: Point[] | null = null
      if (Array.isArray(polyRaw) && polyRaw.length > 0 && Array.isArray(polyRaw[0]) && Array.isArray((polyRaw as any)[0][0])) {
        // array-of-polygons
        let best: { poly: Point[]; d2: number } | null = null
        for (const cand of polyRaw as any[]) {
          const candPoly = normalizePolygon(unwrapGeoPolygon(cand), w, h)
          if (!candPoly) continue
          const c = centroid(candPoly)
          const d2 = dist2(c, focus)
          if (!best || d2 < best.d2) best = { poly: candPoly, d2 }
        }
        poly = best?.poly ?? null
      } else {
        poly = normalizePolygon(unwrapGeoPolygon(polyRaw), w, h)
      }

      if (!poly) return

      const rectFit = minimumAreaBoundingRect(poly)
      setVertices(poly)
      setClosed(true)
      if (rectFit) setOrientationDeg(normalizeDeg180(rectFit.angleDeg))
    } catch {
      // ignore
    } finally {
      setAutoOutlineBusy(false)
    }
  }

  useEffect(() => {
    if (!panelsMounted) return
    if (mapInput.kind !== "address") return
    if (background.kind !== "image") return
    if (mapInput.lat === null || mapInput.lng === null) return

    const key = backgroundSrc
    if (!key || key === lastAutoOutlineKeyRef.current) return
    lastAutoOutlineKeyRef.current = key

    // New address/image => clear previous roof and auto-detect.
    setVertices([])
    setClosed(false)
    void runAutoOutline({ imageUrl: key })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background.kind, backgroundSrc, mapInput.kind, mapInput.lat, mapInput.lng, panelsMounted])

  const shareUrl = useMemo(() => {
    if (!shareSlug) return null
    if (typeof window === "undefined") return null
    return `${window.location.origin}/s/${shareSlug}`
  }, [shareSlug])

  const leftPanel = (
    <div className="space-y-4">
      <MapInput value={mapInput} onChange={setMapInput} />

      <div className="glass-card p-4">
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
          setAutoOutlineCandidates(null)
          setAutoOutlineError(null)
          setAutoOutlineHint(null)
          if (v.length < 3) setClosed(false)
        }}
        onClosedChange={setClosed}
        onAutoOutline={background.kind === "image" ? () => void runAutoOutline() : undefined}
        autoOutlineBusy={autoOutlineBusy}
        autoOutlineError={autoOutlineError}
        autoOutlineHint={autoOutlineHint}
        candidatePolygons={autoOutlineCandidates}
        onPickCandidate={(id) => {
          const hit = autoOutlineCandidates?.find((c) => c.id === id) ?? null
          if (!hit) return
          const rectFit = minimumAreaBoundingRect(hit.polygon)
          setVertices(hit.polygon)
          setClosed(true)
          if (rectFit) setOrientationDeg(normalizeDeg180(rectFit.angleDeg))
          setAutoOutlineCandidates(null)
          setAutoOutlineError(null)
          setAutoOutlineHint(null)
        }}
        centerPin={mapInput.kind === "address" && background.kind === "image" ? { x: background.widthPx / 2, y: background.heightPx / 2 } : null}
      />
    </div>
  )

  const rightPanel = (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">Results</div>
          <div className="text-xs text-muted-foreground">{estimate.source === "server" ? "Server estimate" : "Fallback"}</div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Panels</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={panelCount} />
            </div>
          </div>
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">DC kW</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={dcKw} formatFn={(n) => n.toFixed(1)} />
            </div>
          </div>
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Annual kWh</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={estimate.annualKwh} />
            </div>
          </div>
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Annual CO₂ (kg)</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={estimate.annualCo2Kg} />
            </div>
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
          <div className="glass-surface mt-3 rounded-lg p-3 text-sm text-foreground">
            <ul className="list-disc space-y-1 pl-5">
              {explainText.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-muted-foreground">{explainText.caveat}</div>
          </div>
        )}
      </div>

      <div className="glass-card p-4">
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
      <BackgroundScene />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,20,0.10)_0%,rgba(3,8,20,0.14)_42%,rgba(3,8,20,0.28)_100%)]" />

      <GlobeStage
        lat={lat}
        lng={lng}
        interactive={globeInteractive}
        onPrimaryClick={opened ? undefined : openApp}
        dim={opened}
        className="z-[2]"
      />

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-[3] transition-opacity duration-700 motion-reduce:duration-0",
          opened ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="dashboard-scrim dashboard-scrim-left absolute inset-y-0 left-0 hidden w-[38vw] lg:block" />
        <div className="dashboard-scrim dashboard-scrim-right absolute inset-y-0 right-0 hidden w-[38vw] lg:block" />
        <div className="dashboard-scrim dashboard-scrim-bottom absolute inset-x-0 bottom-0 h-[24vh] lg:hidden" />
      </div>

      {!opened && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
          Click the Earth
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3 sm:top-4">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-border/55 bg-background/25 p-1.5 shadow-[0_12px_28px_-20px_rgba(0,0,0,0.95)] backdrop-blur-md">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/45 bg-primary/12 px-3 py-1.5 shadow-[0_10px_30px_-22px_rgba(0,0,0,0.95)]">
            <span className="text-[10px] font-semibold tracking-[0.24em] text-foreground uppercase">Sunnywise</span>
          </div>

          {phase === "app" && (
            <button
              type="button"
              onClick={returnToLanding}
              className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/45 px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-background/65"
            >
              <ArrowLeft size={14} />
              Back to landing
            </button>
          )}

          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-full border border-primary/65 bg-primary/18 px-4 py-1.5 text-xs font-semibold text-foreground shadow-[0_12px_28px_-16px_rgba(0,0,0,0.95)] backdrop-blur-sm transition hover:bg-primary/28"
          >
            <Settings2 size={14} />
            Settings
          </Link>
        </div>
      </div>

      <div className="pointer-events-none relative z-20 h-full px-2 py-6 sm:px-3 sm:py-8 lg:px-4">
        {!isMobile ? (
          <div
            className={cn(
              "grid h-full min-h-0 grid-cols-1 gap-6",
              opened
                ? "lg:grid-cols-[minmax(350px,430px)_minmax(0,1fr)_minmax(350px,430px)]"
                : "lg:grid-cols-[minmax(380px,520px)_minmax(0,1fr)]"
            )}
          >
            <aside
              className="pointer-events-auto relative min-h-0 transition-[opacity,transform,filter] duration-[800ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0"
            >
              <div className="absolute inset-0 h-full min-h-0 overflow-auto pr-1">
                <div
                  className={cn(
                    "transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                    entered && !opened ? "translate-x-0 opacity-100 blur-0" : "pointer-events-none -translate-x-8 opacity-0 blur-md"
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
                      ? "translate-x-0 opacity-100 blur-0 delay-[220ms]"
                      : "translate-x-0 opacity-100 blur-0 delay-0"
                    : "pointer-events-none -translate-x-10 opacity-0 blur-md delay-0"
                )}
              >
                {panelsMounted ? leftPanel : null}
              </div>
            </aside>

            <div className="hidden min-h-0 lg:block" />

            {opened ? (
              <aside
                className="pointer-events-auto min-h-0 transition-[opacity,transform,filter] duration-[800ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0"
              >
                <div className="h-full min-h-0 overflow-auto pl-1">
                  <div
                    className={cn(
                      "transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                      opening ? "translate-x-0 opacity-100 blur-0 delay-[280ms]" : "translate-x-0 opacity-100 blur-0 delay-0"
                    )}
                  >
                    {panelsMounted ? rightPanel : null}
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="relative h-full pt-14">
            <div
              className={cn(
                "pointer-events-auto h-full overflow-auto pr-1 transition-opacity duration-500 motion-reduce:duration-0",
                opened ? "pointer-events-none opacity-0" : "opacity-100"
              )}
            >
              <HeroSection onStart={openApp} visible={entered && !opened} />
            </div>

            {opened ? (
              <div
                className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0"
              >
                <div className="glass-card mx-1 mb-2 overflow-hidden rounded-2xl">
                  <div className="flex items-center gap-2 border-b border-border/60 p-2">
                    <button
                      type="button"
                      onClick={() => setMobilePane("setup")}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition",
                        mobilePane === "setup"
                          ? "bg-primary/18 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Setup
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobilePane("results")}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition",
                        mobilePane === "results"
                          ? "bg-primary/18 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Results
                    </button>
                  </div>

                  <div className="max-h-[68vh] overflow-auto p-3">
                    {panelsMounted ? (mobilePane === "setup" ? leftPanel : rightPanel) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {showShare && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="glass-card w-full max-w-md p-4">
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
            <div className="glass-surface mt-3 rounded-lg p-4">
              {shareUrl ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid place-items-center">
                    <QRCodeCanvas value={shareUrl} size={156} includeMargin />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Public link</div>
                    <div className="glass-surface break-all rounded-md p-2 text-xs text-foreground">
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
