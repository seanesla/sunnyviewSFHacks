import { describe, expect, it } from "vitest"

import type { Point, PanelSpec } from "@/components/PanelPacking"
import { packPanelsDeterministic } from "@/components/PanelPacking"
import { polygonAreaPx2, splitFootprintIntoPlanes } from "@/lib/roof-plane"

describe("splitFootprintIntoPlanes", () => {
  it("splits a footprint into two planes and reduces packing count", () => {
    // Normalized OSM footprint example (then scaled to pixels)
    const ring: Array<[number, number]> = [
      [0.5568327632751129, 0.5016689677303461],
      [0.5072897878137024, 0.4563228408162607],
      [0.5242820963249659, 0.41710103019020506],
      [0.49933136484720986, 0.3942976446873676],
      [0.5298745016696317, 0.32419348908344586],
      [0.6184926169393111, 0.405243270380632],
      [0.5873759001095314, 0.47691102749441344],
      [0.573251491755025, 0.4640108350766538],
    ]

    const w = 1040
    const h = 720
    const footprint: Point[] = ring.map(([x, y]) => ({ x: x * w, y: y * h }))
    const focusPx: Point = { x: w / 2, y: h / 2 }

    const split = splitFootprintIntoPlanes({ footprint, focusPx })
    expect(split).not.toBeNull()
    if (!split) return

    const areaOrig = polygonAreaPx2(footprint)
    const areaChosen = polygonAreaPx2(split.chosen)
    expect(areaOrig).toBeGreaterThan(1)
    expect(areaChosen).toBeGreaterThan(1)
    expect(areaChosen).toBeLessThan(areaOrig)

    const panelSpec: PanelSpec = { widthM: 1.1, heightM: 1.7, wattW: 400, gapM: 0.02 }
    const mPerPx = 0.11865276218267448

    const fullCount = packPanelsDeterministic({
      usablePolygon: footprint,
      mPerPx,
      panel: { widthM: panelSpec.widthM, heightM: panelSpec.heightM, gapM: panelSpec.gapM },
      orientationDeg: 0,
    }).length
    const chosenCount = packPanelsDeterministic({
      usablePolygon: split.chosen,
      mPerPx,
      panel: { widthM: panelSpec.widthM, heightM: panelSpec.heightM, gapM: panelSpec.gapM },
      orientationDeg: 0,
    }).length

    expect(fullCount).toBeGreaterThan(chosenCount)
  })
})
