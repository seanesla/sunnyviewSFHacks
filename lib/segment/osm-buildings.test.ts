import { describe, expect, it } from "vitest"

import { staticMapTransformFromCenter } from "@/lib/segment/mercator"
import { pickTopOrCandidates, rankBuildingCandidates } from "@/lib/segment/osm-buildings"

function squareGeom(lat0: number, lon0: number, d: number) {
  return [
    { lat: lat0 - d, lon: lon0 - d },
    { lat: lat0 - d, lon: lon0 + d },
    { lat: lat0 + d, lon: lon0 + d },
    { lat: lat0 + d, lon: lon0 - d },
    { lat: lat0 - d, lon: lon0 - d },
  ]
}

describe("OSM building ranking", () => {
  it("prefers polygon containing focus point", () => {
    const tf = staticMapTransformFromCenter({
      lat: 0,
      lng: 0,
      zoom: 18,
      baseW: 520,
      baseH: 360,
      scale: 2,
      widthPx: 1040,
      heightPx: 720,
    })

    const elements: any[] = [
      { type: "way", id: 1, tags: { building: "house" }, geometry: squareGeom(0, 0, 0.00005) },
      { type: "way", id: 2, tags: { building: "house" }, geometry: squareGeom(0, 0.0003, 0.00005) },
    ]

    const scored = rankBuildingCandidates({
      elements,
      tf,
      focusPx: { x: 520, y: 360 },
      address: "123 Main St",
    })

    expect(scored[0]?.id).toBe("way:1")
    expect(scored[0]?.containsFocus).toBe(true)
  })

  it("prefers address-tag match even if not containing focus", () => {
    const tf = staticMapTransformFromCenter({
      lat: 0,
      lng: 0,
      zoom: 18,
      baseW: 520,
      baseH: 360,
      scale: 2,
      widthPx: 1040,
      heightPx: 720,
    })

    const elements: any[] = [
      { type: "way", id: 1, tags: { building: "house" }, geometry: squareGeom(0, 0, 0.00005) },
      {
        type: "way",
        id: 2,
        tags: { building: "house", "addr:housenumber": "123", "addr:street": "Main Street" },
        geometry: squareGeom(0, 0.0003, 0.00005),
      },
    ]

    const scored = rankBuildingCandidates({
      elements,
      tf,
      focusPx: { x: 520, y: 360 },
      address: "123 Main St",
    })

    expect(scored[0]?.id).toBe("way:2")
    expect(scored[0]?.addrScore).toBeGreaterThan(0)
  })

  it("returns candidates when uncertain", () => {
    const tf = staticMapTransformFromCenter({
      lat: 0,
      lng: 0,
      zoom: 18,
      baseW: 520,
      baseH: 360,
      scale: 2,
      widthPx: 1040,
      heightPx: 720,
    })

    const elements: any[] = [
      { type: "way", id: 1, tags: { building: "house" }, geometry: squareGeom(0, 0.0006, 0.00005) },
      { type: "way", id: 2, tags: { building: "house" }, geometry: squareGeom(0, -0.0006, 0.00005) },
    ]

    const scored = rankBuildingCandidates({
      elements,
      tf,
      focusPx: { x: 520, y: 360 },
      address: "123 Main St",
    })
    const pick = pickTopOrCandidates(scored)
    expect(pick.kind).toBe("candidates")
  })

  it("does not let distant addr-tags beat containment", () => {
    const tf = staticMapTransformFromCenter({
      lat: 0,
      lng: 0,
      zoom: 18,
      baseW: 520,
      baseH: 360,
      scale: 2,
      widthPx: 1040,
      heightPx: 720,
    })

    const elements: any[] = [
      // Near building contains focus.
      { type: "way", id: 1, tags: { building: "apartments" }, geometry: squareGeom(0, 0, 0.00005) },
      // Far building has perfect address tags but is hundreds of meters away.
      {
        type: "way",
        id: 2,
        tags: { building: "house", "addr:housenumber": "123", "addr:street": "Main Street" },
        geometry: squareGeom(0, 0.004, 0.00005),
      },
    ]

    const scored = rankBuildingCandidates({
      elements,
      tf,
      focusPx: { x: 520, y: 360 },
      address: "123 Main St",
    })

    expect(scored[0]?.id).toBe("way:1")
    expect(scored[0]?.containsFocus).toBe(true)
  })
})
