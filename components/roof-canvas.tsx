"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import mapboxgl from "mapbox-gl"
import { useAccent } from "@/lib/accent-context"

interface Point {
  x: number
  y: number
}

interface Panel {
  x: number
  y: number
  w: number
  h: number
}

const PANEL_W = 28
const PANEL_H = 16
const PANEL_GAP = 3

function isPointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function packPanels(polygon: Point[]): Panel[] {
  if (polygon.length < 3) return []
  const panels: Panel[] = []
  const minX = Math.min(...polygon.map(p => p.x))
  const maxX = Math.max(...polygon.map(p => p.x))
  const minY = Math.min(...polygon.map(p => p.y))
  const maxY = Math.max(...polygon.map(p => p.y))

  for (let y = minY + 4; y + PANEL_H < maxY - 4; y += PANEL_H + PANEL_GAP) {
    for (let x = minX + 4; x + PANEL_W < maxX - 4; x += PANEL_W + PANEL_GAP) {
      const corners = [
        { x, y },
        { x: x + PANEL_W, y },
        { x: x + PANEL_W, y: y + PANEL_H },
        { x, y: y + PANEL_H },
      ]
      if (corners.every(c => isPointInPolygon(c, polygon))) {
        panels.push({ x, y, w: PANEL_W, h: PANEL_H })
      }
    }
  }
  return panels
}

interface RoofCanvasProps {
  onMetricsChange?: (metrics: { panels: number; kw: number; kwh: number; co2: number }) => void
  addressQuery?: string
  searchRequestId?: number
}

const DEFAULT_CENTER: [number, number] = [-118.2437, 34.0522]

export function RoofCanvas({ onMetricsChange, addressQuery, searchRequestId }: RoofCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [polygon, setPolygon] = useState<Point[]>([])
  const [panels, setPanels] = useState<Panel[]>([])
  const [isDrawing, setIsDrawing] = useState(true)
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null)
  const [mapMessage, setMapMessage] = useState("")
  const { hue } = useAccent()
  const mapToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ?? ""

  useEffect(() => {
    if (!mapContainerRef.current) return

    if (!mapToken) {
      setMapMessage("Mapbox token missing. Add NEXT_PUBLIC_MAPBOX_TOKEN in .env.local.")
      return
    }

    mapboxgl.accessToken = mapToken
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: DEFAULT_CENTER,
      zoom: 17,
      pitch: 0,
      bearing: 0,
      interactive: false,
      attributionControl: false,
    })

    mapRef.current = map

    const handleLoad = () => {
      setMapMessage("Search an address to load roof imagery.")
    }

    const handleError = () => {
      setMapMessage("Map imagery failed to load. Check your Mapbox token.")
    }

    map.on("load", handleLoad)
    map.on("error", handleError)

    return () => {
      map.off("load", handleLoad)
      map.off("error", handleError)
      map.remove()
      mapRef.current = null
    }
  }, [mapToken])

  const focusAddressOnMap = useCallback(async (query: string) => {
    const map = mapRef.current
    if (!map || !mapToken) return

    setMapMessage("Finding roof imagery...")

    try {
      const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapToken}&limit=1&types=address,postcode,place`
      const response = await fetch(endpoint)

      if (!response.ok) {
        throw new Error(`Geocode failed (${response.status})`)
      }

      const data = (await response.json()) as {
        features?: Array<{
          center?: [number, number]
          place_name?: string
        }>
      }

      const hit = data.features?.[0]

      if (!hit?.center) {
        setMapMessage("Address not found. Try a full street address.")
        return
      }

      map.flyTo({
        center: hit.center,
        zoom: 19.2,
        duration: 1400,
        essential: true,
      })

      setMapMessage(`Loaded: ${hit.place_name ?? "selected location"}`)
    } catch {
      setMapMessage("Address lookup failed. Check token or try another address.")
    }
  }, [mapToken])

  useEffect(() => {
    if (!searchRequestId) return
    const query = addressQuery?.trim()
    if (!query) return

    void focusAddressOnMap(query)
  }, [addressQuery, searchRequestId, focusAddressOnMap])

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.clearRect(0, 0, w, h)

    const shadow = ctx.createLinearGradient(0, 0, 0, h)
    shadow.addColorStop(0, "rgba(2, 6, 12, 0.14)")
    shadow.addColorStop(1, "rgba(2, 6, 12, 0.36)")
    ctx.fillStyle = shadow
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = "rgba(255,255,255,0.06)"
    ctx.lineWidth = 1
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    if (panels.length > 0) {
      panels.forEach((p, i) => {
        const delay = i * 0.02
        const alpha = Math.min(1, 0.9)
        const hueValue = hue
        ctx.fillStyle = `oklch(0.55 0.15 ${hueValue} / ${alpha * 0.7})`
        ctx.fillRect(p.x, p.y, p.w, p.h)
        ctx.strokeStyle = `oklch(0.7 0.18 ${hueValue} / ${alpha * 0.9})`
        ctx.lineWidth = 0.5
        ctx.strokeRect(p.x, p.y, p.w, p.h)
        ctx.strokeStyle = `oklch(0.6 0.12 ${hueValue} / ${alpha * 0.3})`
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x + p.w, p.y + p.h)
        ctx.stroke()
        void delay
      })
    }

    if (polygon.length > 0) {
      ctx.beginPath()
      ctx.moveTo(polygon[0].x, polygon[0].y)
      for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i].x, polygon[i].y)
      }
      if (!isDrawing) ctx.closePath()

      ctx.strokeStyle = `oklch(0.75 0.2 ${hue})`
      ctx.lineWidth = 2
      ctx.stroke()

      if (!isDrawing) {
        ctx.fillStyle = `oklch(0.7 0.18 ${hue} / 0.08)`
        ctx.fill()
      }

      polygon.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, hoveredVertex === i ? 7 : 5, 0, Math.PI * 2)
        ctx.fillStyle = hoveredVertex === i
          ? `oklch(0.85 0.2 ${hue})`
          : `oklch(0.7 0.18 ${hue})`
        ctx.fill()
        ctx.strokeStyle = "rgba(0,0,0,0.5)"
        ctx.lineWidth = 1.5
        ctx.stroke()
      })
    }

    if (polygon.length === 0 && isDrawing) {
      ctx.font = "14px var(--font-sans, 'Geist', sans-serif)"
      ctx.fillStyle = "rgba(255,255,255,0.86)"
      ctx.shadowColor = "rgba(0,0,0,0.5)"
      ctx.shadowBlur = 4
      ctx.textAlign = "center"
      ctx.fillText("Click to place roof vertices. Double-click to close.", w / 2, h / 2)
      ctx.shadowBlur = 0
    }
  }, [polygon, panels, isDrawing, hue, hoveredVertex])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, rect.width, rect.height)
  }, [draw])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setPolygon(prev => [...prev, { x, y }])
  }, [isDrawing])

  const handleDoubleClick = useCallback(() => {
    if (polygon.length < 3) return
    setIsDrawing(false)
    const packed = packPanels(polygon)
    setPanels(packed)
    if (onMetricsChange) {
      const count = packed.length
      const kw = count * 0.4
      const kwh = Math.round(kw * 1500)
      const co2 = Math.round(kwh * 0.42)
      onMetricsChange({ panels: count, kw: parseFloat(kw.toFixed(1)), kwh, co2 })
    }
  }, [polygon, onMetricsChange])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDrawing || polygon.length === 0) {
      setHoveredVertex(null)
      return
    }
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const idx = polygon.findIndex(p => Math.hypot(p.x - x, p.y - y) < 10)
    setHoveredVertex(idx >= 0 ? idx : null)
  }, [isDrawing, polygon])

  const handleClear = useCallback(() => {
    setPolygon([])
    setPanels([])
    setIsDrawing(true)
    setHoveredVertex(null)
    if (onMetricsChange) {
      onMetricsChange({ panels: 0, kw: 0, kwh: 0, co2: 0 })
    }
  }, [onMetricsChange])

  return (
    <div className="relative flex flex-col gap-2">
      <div className="relative h-[460px] w-full overflow-hidden rounded-xl border border-border">
        <div ref={mapContainerRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-background/20" />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onMouseMove={handleMouseMove}
        />

        {mapMessage && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border/80 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
            {mapMessage}
          </div>
        )}

        {!isDrawing && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-3 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            Clear & Redraw
          </button>
        )}
      </div>
    </div>
  )
}
