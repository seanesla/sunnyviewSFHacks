export type HistoryPoint = {
  x: number
  y: number
}

export type HistorySnapshot = {
  mode: "address"
  address: string | null
  lat: number
  lng: number
  zoom: number
  mPerPx: number | null
  siteSpec: {
    tiltDeg: number
    azimuthDeg: number
    lossesPct: number
  }
  panelSpec: {
    widthM: number
    heightM: number
    wattW: number
    gapM: number
  }
  layoutSummary: {
    orientationDeg: number
    panelCount: number
    dcKw: number
  }
  geometry: {
    vertices: HistoryPoint[]
    closed: boolean
    mPerPx: number | null
    zoom: number
  }
  estimate: {
    annualKwh: number
    monthlyKwh: number[]
    annualCo2Kg: number
    assumptions?: unknown
  } | null
}

export type HistorySummary = {
  address: string | null
  panelCount: number
  dcKw: number
  annualKwh: number | null
  annualCo2Kg: number | null
  lat: number
  lng: number
}

export type HistoryListItem = {
  id: string
  title: string
  note: string | null
  pinned: boolean
  queryHash: string
  summary: HistorySummary
  createdAt: string
  updatedAt: string
}

export type HistoryEntry = HistoryListItem & {
  snapshot: HistorySnapshot
}

export type HistorySaveInput = {
  snapshot: HistorySnapshot
  summary: HistorySummary
  title?: string
  note?: string
  pinned?: boolean
}

export type HistoryMetadataPatch = {
  title?: string
  note?: string
  pinned?: boolean
}
