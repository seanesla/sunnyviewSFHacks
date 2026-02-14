export const STATIC_MAP_W_PX = 520
export const STATIC_MAP_H_PX = 360
export const STATIC_MAP_SCALE = 2

export type StaticMapSpec = {
  src: string
  widthPx: number
  heightPx: number
  meta: {
    lat: number
    lng: number
    zoom: number
    widthPx: number
    heightPx: number
    staticMap: { w: number; h: number; scale: number }
  }
}

export function buildStaticMapSpec(opts: {
  lat: number
  lng: number
  zoom?: number | null
  w?: number
  h?: number
  scale?: number
}): StaticMapSpec {
  const zoom = Number.isFinite(opts.zoom ?? NaN) ? Math.round(opts.zoom as number) : 19
  const w = Number.isFinite(opts.w ?? NaN) ? Math.round(opts.w as number) : STATIC_MAP_W_PX
  const h = Number.isFinite(opts.h ?? NaN) ? Math.round(opts.h as number) : STATIC_MAP_H_PX
  const scale = Number.isFinite(opts.scale ?? NaN) ? Math.round(opts.scale as number) : STATIC_MAP_SCALE

  const widthPx = w * scale
  const heightPx = h * scale

  const qs = new URLSearchParams()
  qs.set("lat", String(opts.lat))
  qs.set("lng", String(opts.lng))
  qs.set("zoom", String(zoom))
  qs.set("w", String(w))
  qs.set("h", String(h))
  qs.set("scale", String(scale))

  const src = `/api/static-map?${qs.toString()}`
  return {
    src,
    widthPx,
    heightPx,
    meta: {
      lat: opts.lat,
      lng: opts.lng,
      zoom,
      widthPx,
      heightPx,
      staticMap: { w, h, scale },
    },
  }
}
