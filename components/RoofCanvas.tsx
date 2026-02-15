"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PanelSpec, PlacedPanel, Point } from "@/components/PanelPacking"

type BackgroundSpec =
  | { kind: "none" }
  | { kind: "image"; src: string; widthPx: number; heightPx: number }
  | { kind: "osm"; lat: number; lng: number; zoom: number }

type SegmentRoi = { x: number; y: number; w: number; h: number }

const MAX_TILE_CACHE_SIZE = 220

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

function bboxOf(points: Point[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
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
  containerClassName,
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
  onAutoOutline?: (opts?: { roi?: SegmentRoi | null }) => void
  autoOutlineBusy?: boolean
  autoOutlineError?: string | null
  autoOutlineHint?: string | null
  candidatePolygons?: Array<{ id: string; polygon: Point[]; score?: number }> | null
  onPickCandidate?: (id: string) => void
  centerPin?: Point | null
  containerClassName?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const invalidateRef = useRef<() => void>(() => {})
  const drawRafRef = useRef<number | null>(null)
  const viewRef = useRef<{ zoom: number; panX: number; panY: number }>({ zoom: 1, panX: 0, panY: 0 })
  const [viewUi, setViewUi] = useState<{ zoom: number }>({ zoom: 1 })
  const panDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null)
  const polyDragRef = useRef<{ pointerId: number; start: Point; startVertices: Point[] } | null>(null)
  const edgeDragRef = useRef<{
    pointerId: number
    edgeIdx: number
    start: Point
    startVertices: Point[]
    normal: { x: number; y: number }
  } | null>(null)
  const candidateDownRef = useRef<string | null>(null)
  const canvasMetricsRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: 0,
  })
  const tileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverEdgeIdx, setHoverEdgeIdx] = useState<number | null>(null)
  const [dragEdgeIdx, setDragEdgeIdx] = useState<number | null>(null)
  const [imageError, setImageError] = useState<{ src: string; message: string } | null>(null)

  const downVertexIdxRef = useRef<number | null>(null)
  const downPosRef = useRef<Point | null>(null)
  const movedRef = useRef(false)
  const tripleClickRef = useRef<{ idx: number; count: number; t: number } | null>(null)

  const [tool, setTool] = useState<"polygon" | "rectangle">("polygon")
  const [rectStart, setRectStart] = useState<Point | null>(null)
  const [rectEnd, setRectEnd] = useState<Point | null>(null)
  const [drawingRect, setDrawingRect] = useState(false)
  const [showNearby, setShowNearby] = useState(false)

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

  const rectangleRoi = useMemo(() => {
    if (background.kind !== "image") return null
    if (tool !== "rectangle") return null
    if (!closed) return null
    if (vertices.length < 4) return null
    const { minX, minY, maxX, maxY } = bboxOf(vertices)
    const pad = 14
    const x = clamp(Math.floor(minX - pad), 0, Math.max(0, internalSize.w - 1))
    const y = clamp(Math.floor(minY - pad), 0, Math.max(0, internalSize.h - 1))
    const w = clamp(Math.ceil(maxX - minX + pad * 2), 1, internalSize.w - x)
    const h = clamp(Math.ceil(maxY - minY + pad * 2), 1, internalSize.h - y)
    return { x, y, w, h } satisfies SegmentRoi
  }, [background.kind, closed, internalSize.h, internalSize.w, tool, vertices])

  const edgeCursor = useMemo(() => {
    if (mode !== "edit") return null
    const idx = dragEdgeIdx ?? hoverEdgeIdx
    if (idx === null) return null
    if (vertices.length < 2) return null
    const a = vertices[idx]
    const b = vertices[(idx + 1) % vertices.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)

    // Drag is along the edge normal.
    if (adx > ady * 1.4) return "ns-resize"
    if (ady > adx * 1.4) return "ew-resize"

    const nx = dy
    const ny = -dx
    return nx * ny >= 0 ? "nwse-resize" : "nesw-resize"
  }, [dragEdgeIdx, hoverEdgeIdx, mode, vertices])

  const canvasCursor = mode === "edit" ? (edgeCursor ?? "crosshair") : "default"

  const clampViewToBounds = useCallback(
    (next: { zoom: number; panX: number; panY: number }) => {
      const container = containerRef.current
      if (!container) return next

      const rect = container.getBoundingClientRect()
      const baseScale = Math.min(rect.width / internalSize.w, rect.height / internalSize.h)
      const z = Math.max(1, next.zoom)
      const viewportW = rect.width / (baseScale * z)
      const viewportH = rect.height / (baseScale * z)

      const cx = internalSize.w / 2
      const cy = internalSize.h / 2

      let panX = next.panX
      let panY = next.panY

      if (viewportW >= internalSize.w) {
        panX = 0
      } else {
        const minCenterX = viewportW / 2
        const maxCenterX = internalSize.w - viewportW / 2
        const viewCenterX = cx - panX
        const clampedCenterX = clamp(viewCenterX, minCenterX, maxCenterX)
        panX = cx - clampedCenterX
      }

      if (viewportH >= internalSize.h) {
        panY = 0
      } else {
        const minCenterY = viewportH / 2
        const maxCenterY = internalSize.h - viewportH / 2
        const viewCenterY = cy - panY
        const clampedCenterY = clamp(viewCenterY, minCenterY, maxCenterY)
        panY = cy - clampedCenterY
      }

      return { zoom: z, panX, panY }
    },
    [internalSize.h, internalSize.w]
  )

  const toInternal = useCallback(
    (x: number, y: number, rect: DOMRect) => {
      const scale = Math.min(rect.width / internalSize.w, rect.height / internalSize.h)
      const offX = (rect.width - internalSize.w * scale) / 2
      const offY = (rect.height - internalSize.h * scale) / 2
      const qx = (x - offX) / scale
      const qy = (y - offY) / scale

      const { zoom, panX, panY } = viewRef.current
      const cx = internalSize.w / 2
      const cy = internalSize.h / 2
      const ix = cx + (qx - cx) / zoom - panX
      const iy = cy + (qy - cy) / zoom - panY
      return {
        x: clamp(ix, 0, internalSize.w),
        y: clamp(iy, 0, internalSize.h),
        scale: scale * zoom,
        offX,
        offY,
        baseScale: scale,
      }
    },
    [internalSize.h, internalSize.w]
  )

  const invalidate = useCallback(() => {
    if (drawRafRef.current !== null) return
    drawRafRef.current = window.requestAnimationFrame(() => {
      drawRafRef.current = null
      drawRef.current()
    })
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const nextWidth = Math.max(1, Math.floor(rect.width * dpr))
    const nextHeight = Math.max(1, Math.floor(rect.height * dpr))
    const lastMetrics = canvasMetricsRef.current
    if (
      lastMetrics.width !== nextWidth ||
      lastMetrics.height !== nextHeight ||
      lastMetrics.dpr !== dpr
    ) {
      canvas.width = nextWidth
      canvas.height = nextHeight
      canvasMetricsRef.current = { width: nextWidth, height: nextHeight, dpr }
    }

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, rect.width, rect.height)

    const scale = Math.min(rect.width / internalSize.w, rect.height / internalSize.h)
    const offX = (rect.width - internalSize.w * scale) / 2
    const offY = (rect.height - internalSize.h * scale) / 2
    const { zoom: viewZoom, panX: viewPanX, panY: viewPanY } = viewRef.current
    const uiScale = 1 / Math.max(1, viewZoom)

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.35)"
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.save()
    ctx.translate(offX, offY)
    ctx.scale(scale, scale)
    // View transform (zoom/pan) in internal coordinates.
    const vCx = internalSize.w / 2
    const vCy = internalSize.h / 2
    ctx.translate(vCx, vCy)
    ctx.scale(viewZoom, viewZoom)
    ctx.translate(viewPanX - vCx, viewPanY - vCy)

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
            img.onload = () => invalidateRef.current()
            if (tileCacheRef.current.size >= MAX_TILE_CACHE_SIZE) {
              const oldestKey = tileCacheRef.current.keys().next().value
              if (oldestKey) tileCacheRef.current.delete(oldestKey)
            }
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
    ctx.lineWidth = 1 * uiScale
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
        ctx.lineWidth = 1 * uiScale
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
      ctx.lineWidth = 2 * uiScale
      ctx.stroke()
      if (closed) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.08)"
        ctx.fill()
      }

      if (mode === "edit") {
        for (let i = 0; i < vertices.length; i++) {
          const v = vertices[i]
          ctx.beginPath()
          ctx.arc(v.x, v.y, (hoverIdx === i ? 7 : 5) * uiScale, 0, Math.PI * 2)
          ctx.fillStyle = hoverIdx === i ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.8)"
          ctx.fill()
          ctx.strokeStyle = "rgba(0,0,0,0.65)"
          ctx.lineWidth = 2 * uiScale
          ctx.stroke()
        }
      }
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
        ctx.setLineDash([8 * uiScale, 6 * uiScale])
        ctx.strokeStyle = "rgba(59, 130, 246, 0.95)"
        ctx.lineWidth = 2 * uiScale
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
      ctx.lineWidth = 2 * uiScale
      ctx.beginPath()
      ctx.moveTo(-60, 0)
      ctx.lineTo(60, 0)
      ctx.stroke()
      ctx.restore()
    }

    // Center pin (address point)
    if (centerPin) {
      ctx.save()
      ctx.strokeStyle = "rgba(255,255,255,0.85)"
      ctx.lineWidth = 2 * uiScale
      ctx.beginPath()
      ctx.moveTo(centerPin.x - 10 * uiScale, centerPin.y)
      ctx.lineTo(centerPin.x + 10 * uiScale, centerPin.y)
      ctx.moveTo(centerPin.x, centerPin.y - 10 * uiScale)
      ctx.lineTo(centerPin.x, centerPin.y + 10 * uiScale)
      ctx.stroke()
      ctx.restore()
    }

    // Candidate outlines (disambiguation)
    if (mode === "edit" && showNearby && candidatePolygons && candidatePolygons.length > 0) {
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
        ctx.lineWidth = 2 * uiScale
        ctx.stroke()
        ctx.fillStyle = "rgba(0,0,0,0.14)"
        ctx.fill()

        // Label near first vertex (keep readable under zoom).
        const p0 = poly[0]
        const pad = 6 * uiScale
        const boxW = 92 * uiScale
        const boxH = 18 * uiScale
        ctx.fillStyle = "rgba(0,0,0,0.65)"
        ctx.fillRect(p0.x + pad, p0.y + pad, boxW, boxH)
        ctx.fillStyle = "rgba(255,255,255,0.92)"
        ctx.font = `${11 * uiScale}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`
        ctx.textAlign = "left"
        ctx.fillText(`Option ${idx + 1}`, p0.x + pad + 6 * uiScale, p0.y + pad + 13 * uiScale)
        ctx.restore()
      })
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
    showNearby,
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
    invalidateRef.current = invalidate
  }, [invalidate])

  useEffect(() => {
    if (background.kind !== "image" || !imageSrc) {
      imgRef.current = null
      invalidate()
      return
    }

    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      imgRef.current = img
      setImageError(null)
      console.info("[roof-canvas] satellite image loaded", {
        src: imageSrc,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })
      invalidate()
    }
    img.onerror = () => {
      if (cancelled) return
      imgRef.current = null
      setImageError({
        src: imageSrc,
        message: "Satellite image failed to load. Check API/network and try again.",
      })
      console.error("[roof-canvas] satellite image failed", { src: imageSrc })
      invalidate()
    }
    img.src = imageSrc

    return () => {
      cancelled = true
    }
  }, [background.kind, imageSrc, invalidate])

  useEffect(() => {
    if (background.kind !== "osm") {
      tileCacheRef.current.clear()
    }
  }, [background.kind])

  useEffect(() => {
    invalidate()
  }, [draw, invalidate])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => invalidate())
    ro.observe(el)
    return () => ro.disconnect()
  }, [invalidate])

  useEffect(() => {
    return () => {
      if (drawRafRef.current !== null) {
        window.cancelAnimationFrame(drawRafRef.current)
        drawRafRef.current = null
      }
    }
  }, [])

  const setView = useCallback(
    (next: { zoom: number; panX: number; panY: number }) => {
      const clamped = clampViewToBounds({
        zoom: clamp(next.zoom, 1, 8),
        panX: next.panX,
        panY: next.panY,
      })
      viewRef.current = clamped
      setViewUi((prev) => (prev.zoom === clamped.zoom ? prev : { zoom: clamped.zoom }))
      invalidate()
    },
    [clampViewToBounds, invalidate]
  )

  const zoomBy = useCallback(
    (factor: number, focus: Point | null) => {
      const { zoom, panX, panY } = viewRef.current
      const nextZoom = clamp(zoom * factor, 1, 8)
      if (Math.abs(nextZoom - zoom) < 1e-6) return

      if (!focus) {
        setView({ zoom: nextZoom, panX, panY })
        return
      }

      const cx = internalSize.w / 2
      const cy = internalSize.h / 2
      const fx = focus.x
      const fy = focus.y

      // Keep focus point fixed in screen space.
      const ratio = zoom / nextZoom
      const nextPanX = cx + ratio * (fx + panX - cx) - fx
      const nextPanY = cy + ratio * (fy + panY - cy) - fy
      setView({ zoom: nextZoom, panX: nextPanX, panY: nextPanY })
    },
    [internalSize.h, internalSize.w, setView]
  )

  const handleWheelNative = useCallback(
    (e: WheelEvent) => {
      const container = containerRef.current
      if (!container) return

      // React may attach wheel listeners as passive in some environments.
      // Use a native non-passive handler to prevent parent scrolling.
      if (e.cancelable) e.preventDefault()
      e.stopPropagation()

      const rect = container.getBoundingClientRect()
      const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)

      const delta = e.deltaY
      const factor = Math.exp(-delta * 0.0014)
      zoomBy(factor, { x: internal.x, y: internal.y })
    },
    [toInternal, zoomBy]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const opts: AddEventListenerOptions = { passive: false, capture: true }

    const handler = (e: WheelEvent) => {
      // Stop scroll chaining and any parent capture handlers.
      if (typeof (e as any).stopImmediatePropagation === "function") {
        ;(e as any).stopImmediatePropagation()
      }
      handleWheelNative(e)
    }

    canvas.addEventListener("wheel", handler, opts)
    container.addEventListener("wheel", handler, opts)
    return () => {
      canvas.removeEventListener("wheel", handler as EventListener, opts)
      container.removeEventListener("wheel", handler as EventListener, opts)
    }
  }, [handleWheelNative])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      canvas.setPointerCapture(e.pointerId)

      if (mode !== "edit") {
        const { panX, panY } = viewRef.current
        panDragRef.current = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: panX,
          startPanY: panY,
        }
        return
      }

      const rect = container.getBoundingClientRect()
      const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)

      movedRef.current = false
      downPosRef.current = { x: internal.x, y: internal.y }
      downVertexIdxRef.current = null
      candidateDownRef.current = null
      edgeDragRef.current = null
      setDragEdgeIdx(null)

      if (tool === "rectangle") {
        setDrawingRect(true)
        setRectStart({ x: internal.x, y: internal.y })
        setRectEnd({ x: internal.x, y: internal.y })
        onVerticesChange?.([])
        onClosedChange?.(false)
        return
      }

      const idx = vertices.length > 0 ? nearestVertexIdx(internal, vertices, 12 / internal.scale) : null
      if (idx !== null) {
        downVertexIdxRef.current = idx
        setDraggingIdx(idx)
        setHoverEdgeIdx(null)
        return
      }

      // Drag an edge (line) to expand/shrink the mask on that side.
      if (tool === "polygon" && closed && vertices.length >= 3) {
        let bestI = 0
        let bestD = Infinity
        const n = vertices.length
        for (let i = 0; i < n; i++) {
          const a = vertices[i]
          const b = vertices[(i + 1) % n]
          const hit = distPointToSegment(internal, a, b)
          if (hit.d < bestD) {
            bestD = hit.d
            bestI = i
          }
        }

        const hitRadius = 10 / internal.scale
        if (bestD <= hitRadius) {
          const startVertices = vertices.map((v) => ({ x: v.x, y: v.y }))
          const a = startVertices[bestI]
          const b = startVertices[(bestI + 1) % startVertices.length]
          const ex = b.x - a.x
          const ey = b.y - a.y
          const len = Math.hypot(ex, ey)
          if (len > 1e-6) {
            // Outward normal depends on winding. In our screen coord space (y increases down),
            // polygons with positive signed area have their interior to the left of each edge.
            let signed = 0
            for (let i = 0; i < startVertices.length; i++) {
              const p = startVertices[i]
              const q = startVertices[(i + 1) % startVertices.length]
              signed += p.x * q.y - q.x * p.y
            }
            const interiorIsLeft = signed > 0
            // Outward is opposite the interior side.
            const nx = interiorIsLeft ? ey / len : -ey / len
            const ny = interiorIsLeft ? -ex / len : ex / len

            edgeDragRef.current = {
              pointerId: e.pointerId,
              edgeIdx: bestI,
              start: { x: internal.x, y: internal.y },
              startVertices,
              normal: { x: nx, y: ny },
            }
            setDragEdgeIdx(bestI)
            setHoverEdgeIdx(bestI)
            return
          }
        }
      }

      if (showNearby && candidatePolygons && candidatePolygons.length > 0 && onPickCandidate) {
        for (const c of candidatePolygons) {
          if (pointInPolygon(internal, c.polygon)) {
            candidateDownRef.current = c.id
            return
          }
        }
      }

      if (tool === "polygon" && closed && vertices.length >= 3 && pointInPolygon(internal, vertices)) {
        polyDragRef.current = {
          pointerId: e.pointerId,
          start: { x: internal.x, y: internal.y },
          startVertices: vertices.map((v) => ({ x: v.x, y: v.y })),
        }
        return
      }

      // Default interaction: drag to pan the view (mask does not change).
      const { panX, panY } = viewRef.current
      panDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: panX,
        startPanY: panY,
      }
    },
    [candidatePolygons, closed, mode, onClosedChange, onPickCandidate, onVerticesChange, showNearby, toInternal, tool, vertices]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current
      if (!container) return

      const panDrag = panDragRef.current
      if (panDrag && panDrag.pointerId === e.pointerId) {
        const rect = container.getBoundingClientRect()
        const baseScale = Math.min(rect.width / internalSize.w, rect.height / internalSize.h)
        const z = Math.max(1, viewRef.current.zoom)
        const dx = e.clientX - panDrag.startClientX
        const dy = e.clientY - panDrag.startClientY
        if (!movedRef.current && dx * dx + dy * dy > 9) movedRef.current = true
        const nextPanX = panDrag.startPanX + dx / (baseScale * z)
        const nextPanY = panDrag.startPanY + dy / (baseScale * z)
        setView({ zoom: z, panX: nextPanX, panY: nextPanY })
        return
      }

      const polyDrag = polyDragRef.current
      if (polyDrag && polyDrag.pointerId === e.pointerId) {
        const rect = container.getBoundingClientRect()
        const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)
        const dxRaw = internal.x - polyDrag.start.x
        const dyRaw = internal.y - polyDrag.start.y
        if (!movedRef.current && dxRaw * dxRaw + dyRaw * dyRaw > 9) movedRef.current = true

        const bb = bboxOf(polyDrag.startVertices)
        const dx = clamp(dxRaw, -bb.minX, internalSize.w - bb.maxX)
        const dy = clamp(dyRaw, -bb.minY, internalSize.h - bb.maxY)
        const next = polyDrag.startVertices.map((v) => ({ x: v.x + dx, y: v.y + dy }))
        onVerticesChange?.(next)
        return
      }

      const edgeDrag = edgeDragRef.current
      if (edgeDrag && edgeDrag.pointerId === e.pointerId) {
        const rect = container.getBoundingClientRect()
        const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)
        const dxRaw = internal.x - edgeDrag.start.x
        const dyRaw = internal.y - edgeDrag.start.y
        if (!movedRef.current && dxRaw * dxRaw + dyRaw * dyRaw > 9) movedRef.current = true

        const { edgeIdx, startVertices, normal } = edgeDrag
        const n = startVertices.length
        const j = (edgeIdx + 1) % n
        const a0 = startVertices[edgeIdx]
        const b0 = startVertices[j]
        let delta = dxRaw * normal.x + dyRaw * normal.y

        // Clamp delta so both endpoints stay within bounds.
        const clampDeltaForPoint = (p: Point) => {
          let lo = -Infinity
          let hi = Infinity

          if (Math.abs(normal.x) > 1e-9) {
            const t1 = (0 - p.x) / normal.x
            const t2 = (internalSize.w - p.x) / normal.x
            lo = Math.max(lo, Math.min(t1, t2))
            hi = Math.min(hi, Math.max(t1, t2))
          } else {
            if (p.x < 0 || p.x > internalSize.w) return { lo: 1, hi: 0 }
          }

          if (Math.abs(normal.y) > 1e-9) {
            const t1 = (0 - p.y) / normal.y
            const t2 = (internalSize.h - p.y) / normal.y
            lo = Math.max(lo, Math.min(t1, t2))
            hi = Math.min(hi, Math.max(t1, t2))
          } else {
            if (p.y < 0 || p.y > internalSize.h) return { lo: 1, hi: 0 }
          }

          return { lo, hi }
        }

        const aClamp = clampDeltaForPoint(a0)
        const bClamp = clampDeltaForPoint(b0)
        const lo = Math.max(aClamp.lo, bClamp.lo)
        const hi = Math.min(aClamp.hi, bClamp.hi)
        if (lo <= hi) delta = clamp(delta, lo, hi)

        const next = startVertices.map((v) => ({ x: v.x, y: v.y }))
        next[edgeIdx] = { x: a0.x + normal.x * delta, y: a0.y + normal.y * delta }
        next[j] = { x: b0.x + normal.x * delta, y: b0.y + normal.y * delta }
        onVerticesChange?.(next)
        return
      }

      const rect = container.getBoundingClientRect()
      const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)

      if (!movedRef.current && downPosRef.current) {
        const dx = internal.x - downPosRef.current.x
        const dy = internal.y - downPosRef.current.y
        if (dx * dx + dy * dy > 9) movedRef.current = true
      }

      let nextHoverVertex: number | null = null
      if (mode === "edit" && vertices.length > 0) {
        nextHoverVertex = nearestVertexIdx(internal, vertices, 12 / internal.scale)
        setHoverIdx((prev) => (prev === nextHoverVertex ? prev : nextHoverVertex))
      } else {
        setHoverIdx((prev) => (prev === null ? prev : null))
      }

      if (mode === "edit" && tool === "polygon" && closed && vertices.length >= 3 && draggingIdx === null) {
        if (nextHoverVertex !== null) {
          setHoverEdgeIdx((prev) => (prev === null ? prev : null))
        } else {
          let bestI = 0
          let bestD = Infinity
          const n = vertices.length
          for (let i = 0; i < n; i++) {
            const a = vertices[i]
            const b = vertices[(i + 1) % n]
            const hit = distPointToSegment(internal, a, b)
            if (hit.d < bestD) {
              bestD = hit.d
              bestI = i
            }
          }

          const hitRadius = 10 / internal.scale
          const nextEdge = bestD <= hitRadius ? bestI : null
          setHoverEdgeIdx((prev) => (prev === nextEdge ? prev : nextEdge))
        }
      } else {
        setHoverEdgeIdx((prev) => (prev === null ? prev : null))
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
    [draggingIdx, drawingRect, internalSize.h, internalSize.w, mode, onVerticesChange, setView, toInternal, tool, vertices]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current
      if (canvas) canvas.releasePointerCapture(e.pointerId)

      if (panDragRef.current?.pointerId === e.pointerId) {
        panDragRef.current = null
      }

      if (polyDragRef.current?.pointerId === e.pointerId) {
        polyDragRef.current = null
      }

      if (edgeDragRef.current?.pointerId === e.pointerId) {
        edgeDragRef.current = null
        setDragEdgeIdx(null)
      }

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
      setDragEdgeIdx(null)

      if (showNearby && mode === "edit" && candidateDownRef.current && !movedRef.current && onPickCandidate) {
        onPickCandidate(candidateDownRef.current)
      }
      candidateDownRef.current = null

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
    [closed, drawingRect, mode, onClosedChange, onPickCandidate, onVerticesChange, rectEnd, rectStart, showNearby, tool, vertices]
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== "edit") return
      if (tool === "rectangle") return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const internal = toInternal(e.clientX - rect.left, e.clientY - rect.top, rect)

      // Double-click adds points; double-click the first vertex to finish.
      // Ignore other vertex hits (triple-click delete uses vertex clicks).
      const hitVertex = vertices.length > 0 ? nearestVertexIdx(internal, vertices, 14 / internal.scale) : null
      if (hitVertex !== null) {
        if (!closed && hitVertex === 0 && vertices.length >= 3) {
          onClosedChange?.(true)
        }
        return
      }

      if (showNearby && candidatePolygons && candidatePolygons.length > 0 && onPickCandidate) {
        for (const c of candidatePolygons) {
          if (pointInPolygon(internal, c.polygon)) {
            onPickCandidate(c.id)
            return
          }
        }
      }

      if (closed && vertices.length >= 2) {
        // Insert into the nearest edge to keep ordering stable.
        let bestI = 0
        let bestD = Infinity
        const n = vertices.length
        for (let i = 0; i < n; i++) {
          const a = vertices[i]
          const b = vertices[(i + 1) % n]
          const hit = distPointToSegment(internal, a, b)
          if (hit.d < bestD) {
            bestD = hit.d
            bestI = i
          }
        }
        const insertIdx = (bestI + 1) % n
        const next = vertices.slice()
        next.splice(insertIdx === 0 ? n : insertIdx, 0, { x: internal.x, y: internal.y })
        onVerticesChange?.(next)
        return
      }

      // Unclosed polygon: double-click adds a new point.
      onVerticesChange?.([...vertices, { x: internal.x, y: internal.y }])
    },
    [candidatePolygons, closed, mode, onClosedChange, onPickCandidate, onVerticesChange, showNearby, toInternal, tool, vertices]
  )

  return (
    <div className="space-y-2">
      {mode === "edit" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {background.kind === "image"
                ? "Tip: drag inside the roof to move it; drag outside to pan; scroll/trackpad to zoom. Double-click to add a point. Double-click the first point to finish. Drag a point to reshape. Triple-click to delete."
                : background.kind === "osm"
                  ? "Map mode: OSM background."
                  : "Trace the usable roof polygon."}
            </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                showNearby
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
              onClick={() => {
                const next = !showNearby
                setShowNearby(next)
                if (!next && tool === "rectangle") {
                  setTool("polygon")
                  setRectStart(null)
                  setRectEnd(null)
                  setDrawingRect(false)
                }
              }}
              title={showNearby ? "Hide nearby roofs" : "Edit: show nearby roofs"}
            >
              {showNearby ? "Edit: On" : "Edit"}
            </button>

            {onAutoOutline && (
              <button
                type="button"
                className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={() => {
                  if (tool === "rectangle") onAutoOutline?.({ roi: rectangleRoi })
                  else onAutoOutline?.()
                }}
                disabled={
                  background.kind !== "image" ||
                  autoOutlineBusy ||
                  (tool === "rectangle" && rectangleRoi === null)
                }
                title={
                  background.kind !== "image"
                    ? "Auto-outline requires an image."
                    : tool === "rectangle"
                      ? rectangleRoi
                        ? "Auto-line from rectangle"
                        : "Draw a rectangle first"
                      : "Auto-outline"
                }
              >
                {tool === "rectangle"
                  ? autoOutlineBusy
                    ? "Auto-lining…"
                    : "Auto-line"
                  : autoOutlineBusy
                    ? "Auto-outlining…"
                    : "Auto-outline"}
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

            <div className="flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-1">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-secondary-foreground hover:bg-secondary/80"
                onClick={() => zoomBy(1 / 1.18, null)}
                title="Zoom out"
              >
                −
              </button>
              <div className="min-w-[54px] text-center text-[11px] font-medium text-secondary-foreground">
                {Math.round(viewUi.zoom * 100)}%
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-secondary-foreground hover:bg-secondary/80"
                onClick={() => zoomBy(1.18, null)}
                title="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}
                title="Reset view"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={`glass-surface relative w-full overflow-hidden rounded-xl ${containerClassName ?? "h-[340px] sm:h-[440px] lg:h-[520px]"}`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor: canvasCursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        />
        {background.kind === "image" && imageError?.src === imageSrc && (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md border border-rose-300/35 bg-rose-500/15 px-3 py-2 text-[11px] text-rose-100 backdrop-blur">
            {imageError.message}
          </div>
        )}
      </div>
    </div>
  )
}
