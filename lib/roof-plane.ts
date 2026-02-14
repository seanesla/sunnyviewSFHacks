import type { Point } from "@/components/PanelPacking"
import { pointInPolygon, polygonCentroid } from "@/components/PanelPacking"

export function polygonAreaPx2(points: Point[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

function dist2(a: Point, b: Point) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function clipPolygonHalfPlane(opts: {
  polygon: Point[]
  origin: Point
  normal: Point
  keepSign: 1 | -1
}): Point[] | null {
  const eps = 1e-9
  const f = (p: Point) =>
    (opts.normal.x * (p.x - opts.origin.x) + opts.normal.y * (p.y - opts.origin.y)) * opts.keepSign

  const out: Point[] = []
  const poly = opts.polygon
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i + poly.length - 1) % poly.length]
    const b = poly[i]
    const fa = f(a)
    const fb = f(b)
    const inA = fa >= -eps
    const inB = fb >= -eps

    const intersect = () => {
      const denom = fa - fb
      if (Math.abs(denom) < 1e-12) return null
      const t = fa / denom
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
    }

    if (inA && inB) {
      out.push(b)
      continue
    }
    if (inA && !inB) {
      const p = intersect()
      if (p) out.push(p)
      continue
    }
    if (!inA && inB) {
      const p = intersect()
      if (p) out.push(p)
      out.push(b)
      continue
    }
  }

  const cleaned: Point[] = []
  for (const p of out) {
    const last = cleaned[cleaned.length - 1]
    if (!last || Math.abs(p.x - last.x) > 1e-6 || Math.abs(p.y - last.y) > 1e-6) {
      cleaned.push(p)
    }
  }
  const first = cleaned[0]
  const last = cleaned[cleaned.length - 1]
  if (first && last && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
    cleaned.pop()
  }

  return cleaned.length >= 3 ? cleaned : null
}

export function splitFootprintIntoPlanes(opts: {
  footprint: Point[]
  focusPx: Point
  minAreaRatio?: number
}) {
  const minAreaRatio = opts.minAreaRatio ?? 0.12
  const c = polygonCentroid(opts.footprint)

  // PCA-like major axis.
  let xx = 0
  let yy = 0
  let xy = 0
  for (const p of opts.footprint) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    xx += dx * dx
    yy += dy * dy
    xy += dx * dy
  }
  const n = Math.max(1, opts.footprint.length)
  xx /= n
  yy /= n
  xy /= n

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) }

  const a = clipPolygonHalfPlane({ polygon: opts.footprint, origin: c, normal, keepSign: 1 })
  const b = clipPolygonHalfPlane({ polygon: opts.footprint, origin: c, normal, keepSign: -1 })
  if (!a || !b) return null

  const areaOrig = polygonAreaPx2(opts.footprint)
  const areaA = polygonAreaPx2(a)
  const areaB = polygonAreaPx2(b)
  if (!(areaOrig > 1) || areaA < areaOrig * minAreaRatio || areaB < areaOrig * minAreaRatio) return null

  const focusInOrig = pointInPolygon(opts.focusPx, opts.footprint)
  let chosen: Point[] | null = null

  if (focusInOrig) {
    const inA = pointInPolygon(opts.focusPx, a)
    const inB = pointInPolygon(opts.focusPx, b)
    if (inA && !inB) chosen = a
    else if (inB && !inA) chosen = b
    else chosen = areaA >= areaB ? a : b
  } else {
    const ca = polygonCentroid(a)
    const cb = polygonCentroid(b)
    chosen = dist2(opts.focusPx, ca) <= dist2(opts.focusPx, cb) ? a : b
  }

  if (!chosen || chosen.length < 3) return null
  if (polygonAreaPx2(chosen) < areaOrig * 0.18) chosen = areaA >= areaB ? a : b

  return {
    chosen,
    planes: [
      { id: "plane_a", polygon: a },
      { id: "plane_b", polygon: b },
    ],
  }
}
