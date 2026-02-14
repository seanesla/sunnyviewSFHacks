export type Point = { x: number; y: number }

export type PanelSpec = {
  widthM: number
  heightM: number
  wattW: number
  gapM: number
}

export type PlacedPanel = {
  cx: number
  cy: number
  widthPx: number
  heightPx: number
  rotationDeg: number
}

export function degToRad(deg: number) {
  return (deg * Math.PI) / 180
}

export function rotatePoint(p: Point, origin: Point, deg: number): Point {
  const r = degToRad(deg)
  const s = Math.sin(r)
  const c = Math.cos(r)
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c }
}

export function rotatePolygon(points: Point[], origin: Point, deg: number): Point[] {
  return points.map((p) => rotatePoint(p, origin, deg))
}

export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  let signedArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    const a = points[i].x * points[j].y - points[j].x * points[i].y
    signedArea += a
    cx += (points[i].x + points[j].x) * a
    cy += (points[i].y + points[j].y) * a
  }
  signedArea *= 0.5
  if (Math.abs(signedArea) < 1e-8) {
    const avgX = points.reduce((acc, p) => acc + p.x, 0) / points.length
    const avgY = points.reduce((acc, p) => acc + p.y, 0) / points.length
    return { x: avgX, y: avgY }
  }
  return { x: cx / (6 * signedArea), y: cy / (6 * signedArea) }
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
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

export function bbox(points: Point[]) {
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

export type PackPanelsParams = {
  usablePolygon: Point[]
  mPerPx: number
  panel: Pick<PanelSpec, "widthM" | "heightM" | "gapM">
  orientationDeg: number
  noGoZones?: Point[][]
}

export function packPanelsDeterministic({
  usablePolygon,
  mPerPx,
  panel,
  orientationDeg,
  noGoZones = [],
}: PackPanelsParams): PlacedPanel[] {
  if (!Number.isFinite(mPerPx) || mPerPx <= 0) return []
  if (usablePolygon.length < 3) return []

  const origin = polygonCentroid(usablePolygon)
  const rotatedPoly = rotatePolygon(usablePolygon, origin, -orientationDeg)
  const rotatedNoGo = noGoZones.map((z) => rotatePolygon(z, origin, -orientationDeg))

  const { minX, minY, maxX, maxY } = bbox(rotatedPoly)

  const panelWpx = panel.widthM / mPerPx
  const panelHpx = panel.heightM / mPerPx
  const gapPx = panel.gapM / mPerPx

  if (!(panelWpx > 1 && panelHpx > 1)) return []

  const stepX = panelWpx + gapPx
  const stepY = panelHpx + gapPx

  const placed: PlacedPanel[] = []
  for (let y = minY; y + panelHpx <= maxY; y += stepY) {
    for (let x = minX; x + panelWpx <= maxX; x += stepX) {
      const corners: Point[] = [
        { x, y },
        { x: x + panelWpx, y },
        { x: x + panelWpx, y: y + panelHpx },
        { x, y: y + panelHpx },
      ]

      const insideUsable = corners.every((c) => pointInPolygon(c, rotatedPoly))
      if (!insideUsable) continue

      const insideNoGo = rotatedNoGo.some((zone) => corners.some((c) => pointInPolygon(c, zone)))
      if (insideNoGo) continue

      const centerRot: Point = { x: x + panelWpx / 2, y: y + panelHpx / 2 }
      const center = rotatePoint(centerRot, origin, orientationDeg)

      placed.push({
        cx: center.x,
        cy: center.y,
        widthPx: panelWpx,
        heightPx: panelHpx,
        rotationDeg: orientationDeg,
      })
    }
  }

  return placed
}

