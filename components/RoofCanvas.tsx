"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PanelSpec, PlacedPanel, Point } from "@/components/PanelPacking"

type BackgroundSpec =
  | { kind: "none" }
  | { kind: "image"; src: string; widthPx: number; heightPx: number }
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

function distPointToSegment(p: Point, a: Point, b: Point) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const wx = p.x - a.x
  const wy = p.y - a.y
  const vv = vx * vx + vy * vy
  const t = vv > 1e-9 ? (wx * vx + wy * vy) / vv : 0
  const tt = Math.max(0, Math.min(1, t))
  const x = a.x + tt * vx
  const y = a.y + tt * vy
  const dx = p.x - x
  const dy = p.y - y
  return { x, y, t: tt, d: Math.hypot(dx, dy) }
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

function nearestEdgeInsertIdx(p: Point, vertices: Point[], radius: number) {
  if (vertices.length < 2) return null
  let bestIdx: number | null = null
  let bestP: Point | null = null
  let best = Infinity
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % n]
    const hit = distPointToSegment(p, a, b)
    if (hit.d <= radius && hit.d < best) {
      best = hit.d
      const insert = (i + 1) % n
      bestIdx = insert === 0 ? n : insert
      bestP = { x: hit.x, y: hit.y }
    }
  }
  return bestIdx !== null && bestP ? { insertIdx: bestIdx, point: bestP } : null
}

function pointInPolygon(p: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersects = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
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
  autoOutlineBusy = false,
  autoOutlineError = null,
  autoOutlineHint = null,
  candidatePolygons = null,
  onPickCandidate,
  centerPin = null,
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
  autoOutlineBusy?: boolean
  autoOutlineError?: string | null
  autoOutlineHint?: string | null
  candidatePolygons?: Array<{ id: string; polygon: Point[]; score?: number }> | null
  onPickCandidate?: (id: string) => void
  centerPin?: Point | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const tileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const downVertexIdxRef = useRef<number | null>(null)
  const downPosRef = useRef<Point | null>(null)
  const movedRef = useRef(false)
  const tripleClickRef = useRef<{ idx: number; count: number; t: number } | null>(null)

  const [tool, setTool] = useState<"polygon" | "rectangle">("polygon")
  const [rectStart, setRectStart] = useState<Point | null>(null)
  const [rectEnd, setRectEnd] = useState<Point | null>(null)
  const [drawingRect, setDrawingRect] = useState(false)

  const imageWidth = background.kind === "image" ? background.widthPx : null
  const imageHeight = background.kind === "image" ? background.heightPx : null
  const imageSrc = background.kind === "image" ? background.src : null

  const internalSize = useMemo(() => {
    if (background.kind === "image" && imageWidth !== null && imageHeight !== null) {
      return { w: imageWidth, h: imageHeight }
    }
    if (background.kind === "osm") return { w: 1024, h: 640 }
    return { w: 1024, h: 640 }
  }, [background.kind, imageHeight, imageWidth])

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
            img.onload = () => drawRef.current()
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
        tool === "rectangle"
          ? "Drag to draw a rectangle that bounds the usable roof area."
          : "Click to trace the usable roof area. Double-click (or press Finish) to close.",
        internalSize.w / 2,
        internalSize.h / 2
      )
    }

    // Rectangle draft (before commit)
    if (mode === "edit" && tool === "rectangle" && rectStart && rectEnd) {
      const minX = Math.min(rectStart.x, rectEnd.x)
      const minY = Math.min(rectStart.y, rectEnd.y)
      const maxX = Math.max(rectStart.x, rectEnd.x)
      const maxY = Math.max(rectStart.y, rectEnd.y)
      const w = Math.max(0, maxX - minX)
      const h = Math.max(0, maxY - minY)

      if (w > 1 && h > 1) {
        ctx.save()
        ctx.setLineDash([8, 6])
        ctx.strokeStyle = "rgba(59, 130, 246, 0.95)"
        ctx.lineWidth = 2
        ctx.strokeRect(minX, minY, w, h)
        ctx.restore()

        ctx.fillStyle = "rgba(59, 130, 246, 0.08)"
        ctx.fillRect(minX, minY, w, h)
      }
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

    // Center pin (address point)
    if (centerPin) {
      ctx.save()
      ctx.strokeStyle = "rgba(255,255,255,0.85)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(centerPin.x - 10, centerPin.y)
      ctx.lineTo(centerPin.x + 10, centerPin.y)
      ctx.moveTo(centerPin.x, centerPin.y - 10)
      ctx.lineTo(centerPin.x, centerPin.y + 10)
      ctx.stroke()
      ctx.restore()
    }

    // Candidate outlines (disambiguation)
    if (mode === "edit" && candidatePolygons && candidatePolygons.length > 0) {
      const colors = [
        "rgba(34,197,94,0.95)",
        "rgba(59,130,246,0.95)",
        "rgba(245,158,11,0.95)",
        "rgba(236,72,153,0.95)",
        "rgba(168,85,247,0.95)",
      ]
      candidatePolygons.forEach((c, idx) => {
        const poly = c.polygon
        if (!poly || poly.length < 3) return
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(poly[0].x, poly[0].y)
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
        ctx.closePath()
        ctx.strokeStyle = colors[idx % colors.length]
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = "rgba(0,0,0,0.16)"
        ctx.fill()

        // label near first vertex
        const p0 = poly[0]
        ctx.fillStyle = "rgba(0,0,0,0.65)"
        ctx.fillRect(p0.x + 6, p0.y + 6, 86, 18)
        ctx.fillStyle = "rgba(255,255,255,0.92)"
        ctx.font = "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
        ctx.fillText(`Roof ${idx + 1}`, p0.x + 12, p0.y + 19)
        ctx.restore()
      })
    }

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

    if (mode === "edit" && background.kind === "image") {
      const status = autoOutlineBusy
        ? { title: "Detecting roof…", tone: "info" as const }
        : autoOutlineError
          ? { title: "Auto-outline failed", tone: "error" as const, detail: autoOutlineError }
          : autoOutlineHint
            ? { title: autoOutlineHint, tone: "hint" as const }
            : null
      if (status) {
        ctx.fillStyle = "rgba(0,0,0,0.55)"
        const h = status.tone === "error" && status.detail ? 46 : 28
        ctx.fillRect(12, 74, 282, h)
        ctx.fillStyle =
          status.tone === "error"
            ? "rgba(248,113,113,0.95)"
            : status.tone === "hint"
              ? "rgba(245,158,11,0.95)"
              : "rgba(255,255,255,0.9)"
        ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
        ctx.fillText(status.title, 22, 93)

        if (status.tone === "error" && status.detail) {
          const msg = String(status.detail)
          const clipped = msg.length > 44 ? `${msg.slice(0, 41)}…` : msg
          ctx.fillStyle = "rgba(255,255,255,0.75)"
          ctx.fillText(clipped, 22, 111)
        }
      }
    }
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
    rectEnd,
    rectStart,
    tool,
    autoOutlineBusy,
    autoOutlineError,
    autoOutlineHint,
    candidatePolygons,
    centerPin,
    ])

  useEffect(() => {
    drawRef.current = draw
  }, [draw])

  useEffect(() => {
    if (background.kind !== "image" || !imageSrc) {
      imgRef.current = null
      return
    }
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      draw()
    }
    img.src = imageSrc
  }, [background.kind, draw, imageSrc])

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

      movedRef.current = false
      downPosRef.current = { x: internal.x, y: internal.y }
      downVertexIdxRef.current = null

      if (candidatePolygons && candidatePolygons.length > 0 && onPickCandidate) {
        for (const c of candidatePolygons) {
          if (pointInPolygon(internal, c.polygon)) {
            onPickCandidate(c.id)
            return
          }
        }
      }

      if (tool === "rectangle") {
        setDrawingRect(true)
        setRectStart({ x: internal.x, y: internal.y })
        setRectEnd({ x: internal.x, y: internal.y })
        onVerticesChange?.([])
        onClosedChange?.(false)
        return
      }

      if (closed) {
        const idx = nearestVertexIdx(internal, vertices, 12 / internal.scale)
        if (idx !== null) {
          downVertexIdxRef.current = idx
          setDraggingIdx(idx)
          return
        }

        // Add a "breakpoint" by inserting a new vertex on the nearest edge.
        if (tool === "polygon") {
          const edge = nearestEdgeInsertIdx(internal, vertices, 10 / internal.scale)
          if (edge) {
            const next = vertices.slice()
            next.splice(edge.insertIdx, 0, edge.point)
            onVerticesChange?.(next)
            setDraggingIdx(edge.insertIdx)
            return
          }
        }
        return
      }

      onVerticesChange?.([...vertices, { x: internal.x, y: internal.y }])
    },
    [candidatePolygons, closed, mode, onClosedChange, onPickCandidate, onVerticesChange, toInternal, tool, vertices]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)

      if (!movedRef.current && downPosRef.current) {
        const dx = internal.x - downPosRef.current.x
        const dy = internal.y - downPosRef.current.y
        if (dx * dx + dy * dy > 9) movedRef.current = true
      }

      if (mode === "edit" && closed) {
        const idx = nearestVertexIdx(internal, vertices, 12 / internal.scale)
        setHoverIdx(idx)
      } else {
        setHoverIdx(null)
      }

      if (mode !== "edit") return

      if (tool === "rectangle" && drawingRect) {
        setRectEnd({ x: internal.x, y: internal.y })
        return
      }
      if (draggingIdx === null) return

      const next = vertices.slice()
      next[draggingIdx] = { x: internal.x, y: internal.y }
      onVerticesChange?.(next)
    },
    [closed, draggingIdx, drawingRect, mode, onVerticesChange, toInternal, tool, vertices]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current
      if (canvas) canvas.releasePointerCapture(e.pointerId)

      if (mode === "edit" && tool === "rectangle" && drawingRect && rectStart && rectEnd) {
        const minX = Math.min(rectStart.x, rectEnd.x)
        const minY = Math.min(rectStart.y, rectEnd.y)
        const maxX = Math.max(rectStart.x, rectEnd.x)
        const maxY = Math.max(rectStart.y, rectEnd.y)

        const w = maxX - minX
        const h = maxY - minY
        if (w >= 3 && h >= 3) {
          onVerticesChange?.([
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
          ])
          onClosedChange?.(true)
        }
      }

      setDrawingRect(false)
      setRectStart(null)
      setRectEnd(null)
      setDraggingIdx(null)

      // Triple-click a vertex to delete it.
      if (mode === "edit" && closed && tool === "polygon") {
        const idx = downVertexIdxRef.current
        if (idx !== null && !movedRef.current) {
          const now = Date.now()
          const prev = tripleClickRef.current
          const nextCount = prev && prev.idx === idx && now - prev.t < 900 ? prev.count + 1 : 1
          tripleClickRef.current = { idx, count: nextCount, t: now }
          if (nextCount >= 3) {
            const next = vertices.slice()
            next.splice(idx, 1)
            tripleClickRef.current = null
            downVertexIdxRef.current = null
            downPosRef.current = null
            movedRef.current = false
            onVerticesChange?.(next)
            if (next.length < 3) onClosedChange?.(false)
            return
          }
        }
      }

      downVertexIdxRef.current = null
      downPosRef.current = null
      movedRef.current = false
    },
    [closed, drawingRect, mode, onClosedChange, onVerticesChange, rectEnd, rectStart, tool, vertices]
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
                ? "Satellite image: trace the usable roof area. Tip: triple-click a dot to delete it."
                : background.kind === "osm"
                  ? "Map mode: OSM background."
                  : "Trace the usable roof polygon."}
            </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                tool === "rectangle" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
              onClick={() => {
                setTool((t) => (t === "rectangle" ? "polygon" : "rectangle"))
                setRectStart(null)
                setRectEnd(null)
                setDrawingRect(false)
                onVerticesChange?.([])
                onClosedChange?.(false)
              }}
              title={tool === "rectangle" ? "Switch back to polygon trace" : "Draw a roof rectangle"}
            >
              {tool === "rectangle" ? "Rectangle: On" : "Rectangle"}
            </button>
            {onAutoOutline && (
              <button
                type="button"
                className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={onAutoOutline}
                disabled={background.kind !== "image" || autoOutlineBusy}
                title={background.kind !== "image" ? "Auto-outline requires an image." : "Auto-outline"}
              >
                {autoOutlineBusy ? "Auto-outlining…" : "Auto-outline"}
              </button>
            )}
            {!closed && (
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                onClick={() => onClosedChange?.(true)}
                disabled={tool === "rectangle" ? true : vertices.length < 3}
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
                setRectStart(null)
                setRectEnd(null)
                setDrawingRect(false)
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
