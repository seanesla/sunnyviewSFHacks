export type Pt = { x: number; y: number }

export function polygonArea(points: Pt[]) {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    a += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(a) / 2
}

export function polygonCentroid(points: Pt[]) {
  if (points.length === 0) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / points.length, y: sy / points.length }
}

export function pointInPolygon(p: Pt, polygon: Pt[]) {
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

export function distPointToSeg2(p: Pt, a: Pt, b: Pt) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const wx = p.x - a.x
  const wy = p.y - a.y
  const c1 = vx * wx + vy * wy
  if (c1 <= 0) {
    const dx = p.x - a.x
    const dy = p.y - a.y
    return dx * dx + dy * dy
  }
  const c2 = vx * vx + vy * vy
  if (c2 <= c1) {
    const dx = p.x - b.x
    const dy = p.y - b.y
    return dx * dx + dy * dy
  }
  const t = c1 / c2
  const proj = { x: a.x + t * vx, y: a.y + t * vy }
  const dx = p.x - proj.x
  const dy = p.y - proj.y
  return dx * dx + dy * dy
}

export function distPointToPolygonBoundary2(p: Pt, poly: Pt[]) {
  if (poly.length < 2) return Infinity
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    best = Math.min(best, distPointToSeg2(p, poly[i], poly[j]))
  }
  return best
}
