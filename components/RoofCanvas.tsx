"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PanelSpec, PlacedPanel, Point } from "@/components/PanelPacking"

type BackgroundSpec =
  | { kind: "none" }
  | { kind: "image"; dataUrl: string; widthPx: number; heightPx: number }
  | { kind: "osm"; lat: number; lng: number; zoom: number }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function latLngToWorldPx(lat: number, lng: number, zoom: number) {
  const z = Math.round(clamp(zoom, 1, 22))
  const worldSize = 256 * Math.pow(2, z)
  const x = ((lng + 180) / 360) * worldSize
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  return { x, y, z, worldSize }
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function nearestVertexIdx(p: Point, vertices: Point[], radius: number) {
  let bestIdx: number | null = null
  let best = Infinity
  for (let i = 0; i < vertices.length; i++) {
    const d = dist(p, vertices[i])
    if (d <= radius && d < best) {
      best = d
      bestIdx = i
    }
  }
  return bestIdx
}

export function RoofCanvas({
  background,
  mPerPx,
  orientationDeg,
  panelSpec,
  vertices,
  closed,
  panels,
  mode = "edit",
  onVerticesChange,
  onClosedChange,
  onAutoOutline,
}: {
  background: BackgroundSpec
  mPerPx: number | null
  orientationDeg: number
  panelSpec: PanelSpec
  vertices: Point[]
  closed: boolean
  panels: PlacedPanel[]
  mode?: "edit" | "view"
  onVerticesChange?: (next: Point[]) => void
  onClosedChange?: (next: boolean) => void
  onAutoOutline?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const tileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const internalSize = useMemo(() => {
    if (background.kind === "image") return { w: background.widthPx, h: background.heightPx }
    if (background.kind === "osm") return { w: 1024, h: 640 }
    return { w: 1024, h: 640 }
  }, [
    background.kind,
    background.kind === "image" ? background.widthPx : 0,
    background.kind === "image" ? background.heightPx : 0,
  ])

  const toScreen = useCallback(
    (p: Point, rect: DOMRect) => {
      const scale = Math.min(rect.width / internalSize.w, rect.height / internalSize.h)
      const offX = (rect.width - internalSize.w * scale) / 2
      const offY = (rect.height - internalSize.h * scale) / 2
      return { x: offX + p.x * scale, y: offY + p.y * scale, scale, offX, offY }
    },
    [internalSize.h, internalSize.w]
  )

  const toInternal = useCallback(
    (x: number, y: number, rect: DOMRect) => {
      const scale = Math.min(rect.width / internalSize.w, rect.height / internalSize.h)
      const offX = (rect.width - internalSize.w * scale) / 2
      const offY = (rect.height - internalSize.h * scale) / 2
      const ix = (x - offX) / scale
      const iy = (y - offY) / scale
      return { x: clamp(ix, 0, internalSize.w), y: clamp(iy, 0, internalSize.h), scale, offX, offY }
    },
    [internalSize.h, internalSize.w]
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, rect.width, rect.height)

    const scale = Math.min(rect.width / internalSize.w, rect.height / internalSize.h)
    const offX = (rect.width - internalSize.w * scale) / 2
    const offY = (rect.height - internalSize.h * scale) / 2

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.35)"
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.save()
    ctx.translate(offX, offY)
    ctx.scale(scale, scale)

    if (background.kind === "image") {
      const img = imgRef.current
      if (img) {
        ctx.drawImage(img, 0, 0, internalSize.w, internalSize.h)
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.05)"
        ctx.fillRect(0, 0, internalSize.w, internalSize.h)
      }
    } else if (background.kind === "osm") {
      ctx.fillStyle = "rgba(255,255,255,0.04)"
      ctx.fillRect(0, 0, internalSize.w, internalSize.h)

      const { x: cx, y: cy, z, worldSize } = latLngToWorldPx(background.lat, background.lng, background.zoom)
      const topLeftWorldX = cx - internalSize.w / 2
      const topLeftWorldY = cy - internalSize.h / 2

      const tileX0 = Math.floor(topLeftWorldX / 256)
      const tileY0 = Math.floor(topLeftWorldY / 256)
      const tileX1 = Math.floor((topLeftWorldX + internalSize.w) / 256)
      const tileY1 = Math.floor((topLeftWorldY + internalSize.h) / 256)

      for (let ty = tileY0; ty <= tileY1; ty++) {
        for (let tx = tileX0; tx <= tileX1; tx++) {
          const wrappedX = ((tx % (worldSize / 256)) + (worldSize / 256)) % (worldSize / 256)
          const clampedY = clamp(ty, 0, worldSize / 256 - 1)
          const key = `${z}/${wrappedX}/${clampedY}`

          let img = tileCacheRef.current.get(key)
          if (!img) {
            img = new Image()
            img.crossOrigin = "anonymous"
            img.src = `https://tile.openstreetmap.org/${z}/${wrappedX}/${clampedY}.png`
            img.onload = () => draw()
            tileCacheRef.current.set(key, img)
          }

          const tileWorldX = tx * 256
          const tileWorldY = ty * 256
          const dx = tileWorldX - topLeftWorldX
          const dy = tileWorldY - topLeftWorldY

          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, dx, dy, 256, 256)
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.02)"
            ctx.fillRect(dx, dy, 256, 256)
          }
        }
      }

      ctx.fillStyle = "rgba(0,0,0,0.35)"
      ctx.fillRect(0, internalSize.h - 18, internalSize.w, 18)
      ctx.fillStyle = "rgba(255,255,255,0.8)"
      ctx.font = "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
      ctx.fillText("© OpenStreetMap contributors", 8, internalSize.h - 6)
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.04)"
      ctx.fillRect(0, 0, internalSize.w, internalSize.h)
    }

    // subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)"
    ctx.lineWidth = 1
    for (let x = 0; x <= internalSize.w; x += 64) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, internalSize.h)
      ctx.stroke()
    }
    for (let y = 0; y <= internalSize.h; y += 64) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(internalSize.w, y)
      ctx.stroke()
    }

    // Panels
    if (panels.length > 0) {
      ctx.save()
      ctx.globalAlpha = 0.85
      for (const p of panels) {
        ctx.save()
        ctx.translate(p.cx, p.cy)
        ctx.rotate((p.rotationDeg * Math.PI) / 180)
        ctx.translate(-p.widthPx / 2, -p.heightPx / 2)
        ctx.fillStyle = "rgba(245, 158, 11, 0.22)"
        ctx.strokeStyle = "rgba(245, 158, 11, 0.7)"
        ctx.lineWidth = 1
        ctx.fillRect(0, 0, p.widthPx, p.heightPx)
        ctx.strokeRect(0, 0, p.widthPx, p.heightPx)
        ctx.restore()
      }
      ctx.restore()
    }

    // Usable polygon
    if (vertices.length > 0) {
      ctx.beginPath()
      ctx.moveTo(vertices[0].x, vertices[0].y)
      for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y)
      if (closed) ctx.closePath()

      ctx.strokeStyle = "rgba(59, 130, 246, 0.95)"
      ctx.lineWidth = 2
      ctx.stroke()
      if (closed) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.08)"
        ctx.fill()
      }

      if (mode === "edit") {
        for (let i = 0; i < vertices.length; i++) {
          const v = vertices[i]
          ctx.beginPath()
          ctx.arc(v.x, v.y, hoverIdx === i ? 7 : 5, 0, Math.PI * 2)
          ctx.fillStyle = hoverIdx === i ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.8)"
          ctx.fill()
          ctx.strokeStyle = "rgba(0,0,0,0.65)"
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
    } else if (mode === "edit") {
      ctx.fillStyle = "rgba(255,255,255,0.88)"
      ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
      ctx.textAlign = "center"
      ctx.fillText(
        "Click to trace the usable roof area. Double-click (or press Finish) to close.",
        internalSize.w / 2,
        internalSize.h / 2
      )
    }

    // Orientation hint
    if (closed && vertices.length >= 3) {
      const cx = internalSize.w / 2
      const cy = internalSize.h / 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate((orientationDeg * Math.PI) / 180)
      ctx.strokeStyle = "rgba(255,255,255,0.25)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-60, 0)
      ctx.lineTo(60, 0)
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()

    // Overlay pill
    ctx.fillStyle = "rgba(0,0,0,0.55)"
    ctx.fillRect(12, 12, 282, 54)
    ctx.fillStyle = "rgba(255,255,255,0.9)"
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
    ctx.fillText(`Panels: ${panels.length}`, 22, 32)
    const dcKw = (panels.length * panelSpec.wattW) / 1000
    ctx.fillText(`DC: ${dcKw.toFixed(1)} kW`, 22, 50)
    ctx.fillStyle = "rgba(255,255,255,0.65)"
    ctx.fillText(`Scale: ${mPerPx ? `${mPerPx.toExponential(2)} m/px` : "—"}`, 132, 32)
    ctx.fillText(`Orient: ${orientationDeg.toFixed(0)}°`, 132, 50)
  }, [
    background,
    closed,
    hoverIdx,
    internalSize.h,
    internalSize.w,
    mPerPx,
    orientationDeg,
    panelSpec.wattW,
    panels,
    vertices,
    mode,
  ])

  useEffect(() => {
    if (background.kind !== "image") {
      imgRef.current = null
      return
    }
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      draw()
    }
    img.src = background.dataUrl
  }, [background.kind, background.kind === "image" ? background.dataUrl : null, draw])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(el)
    return () => ro.disconnect()
  }, [draw])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (mode !== "edit") return
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      canvas.setPointerCapture(e.pointerId)
      const rect = container.getBoundingClientRect()
      const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)

      if (closed) {
        const idx = nearestVertexIdx(internal, vertices, 12 / internal.scale)
        if (idx !== null) setDraggingIdx(idx)
        return
      }

      onVerticesChange?.([...vertices, { x: internal.x, y: internal.y }])
    },
    [closed, mode, onVerticesChange, toInternal, vertices]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)

      if (mode === "edit" && closed) {
        const idx = nearestVertexIdx(internal, vertices, 12 / internal.scale)
        setHoverIdx(idx)
      } else {
        setHoverIdx(null)
      }

      if (mode !== "edit") return
      if (draggingIdx === null) return

      const next = vertices.slice()
      next[draggingIdx] = { x: internal.x, y: internal.y }
      onVerticesChange?.(next)
    },
    [closed, draggingIdx, mode, onVerticesChange, toInternal, vertices]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current
      if (canvas) canvas.releasePointerCapture(e.pointerId)
      setDraggingIdx(null)
    },
    []
  )

  const onDoubleClick = useCallback(() => {
    if (mode !== "edit") return
    if (closed) return
    if (vertices.length < 3) return
    onClosedChange?.(true)
  }, [closed, mode, onClosedChange, vertices.length])

  return (
    <div className="space-y-2">
      {mode === "edit" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {background.kind === "image"
              ? "Image mode: trace on your screenshot."
              : background.kind === "osm"
                ? "Link mode: OSM background (no satellite)."
                : "Trace the usable roof polygon."}
          </div>
          <div className="flex flex-wrap gap-2">
            {onAutoOutline && (
              <button
                type="button"
                className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={onAutoOutline}
                disabled={background.kind !== "image"}
                title={background.kind !== "image" ? "Auto-outline requires a screenshot upload." : "Auto-outline"}
              >
                Auto-outline
              </button>
            )}
            {!closed && (
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                onClick={() => onClosedChange?.(true)}
                disabled={vertices.length < 3}
              >
                Finish
              </button>
            )}
            <button
              type="button"
              className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
              onClick={() => {
                onVerticesChange?.([])
                onClosedChange?.(false)
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} className="glass-surface relative h-[340px] w-full overflow-hidden rounded-xl sm:h-[440px] lg:h-[520px]">
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full ${mode === "edit" ? "cursor-crosshair" : "cursor-default"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
        />
      </div>
    </div>
  )
}
