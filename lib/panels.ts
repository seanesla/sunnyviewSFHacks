import type { PanelSpec } from "@/components/PanelPacking"

export type PanelOption = {
  id: string
  label: string
  brand: string
  model: string
  spec: PanelSpec
  sourceUrl: string
}

// Small, curated catalog so we can do deterministic packing math.
// Dimensions are representative for planning; real SKUs vary by revision.
export const PANEL_OPTIONS: PanelOption[] = [
  {
    id: "rec_alpha_pure_420",
    label: "REC Alpha Pure 420W",
    brand: "REC",
    model: "Alpha Pure (420W class)",
    spec: { widthM: 1.134, heightM: 1.730, wattW: 420, gapM: 0.02 },
    sourceUrl: "https://www.recgroup.com/en/rec-alpha-pure-series",
  },
  {
    id: "qcells_qtron_425",
    label: "Qcells Q.TRON 425W",
    brand: "Qcells",
    model: "Q.TRON (425W class)",
    spec: { widthM: 1.134, heightM: 1.762, wattW: 425, gapM: 0.02 },
    sourceUrl: "https://qcells.com/us/products/solar-panels/qtron",
  },
  {
    id: "sunpower_maxeon6_440",
    label: "SunPower Maxeon 6 440W",
    brand: "SunPower",
    model: "Maxeon 6 (440W class)",
    spec: { widthM: 1.134, heightM: 1.872, wattW: 440, gapM: 0.02 },
    sourceUrl: "https://us.sunpower.com/solar-panels/maxeon",
  },
  {
    id: "canadian_hiku6_500",
    label: "Canadian Solar HiKu6 500W",
    brand: "Canadian Solar",
    model: "HiKu6 (500W class)",
    spec: { widthM: 1.134, heightM: 2.100, wattW: 500, gapM: 0.02 },
    sourceUrl: "https://www.canadiansolar.com/solar-panels/",
  },
]
