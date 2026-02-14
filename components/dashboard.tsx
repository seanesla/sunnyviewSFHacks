"use client"

import { useState } from "react"
import { Search, Wand2, Share2, MessageSquare } from "lucide-react"
import { RoofCanvas } from "./roof-canvas"
import { MetricsPanel } from "./metrics-panel"
import { HuePicker } from "./hue-picker"

interface Metrics {
  panels: number
  kw: number
  kwh: number
  co2: number
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>({ panels: 0, kw: 0, kwh: 0, co2: 0 })
  const [address, setAddress] = useState("")
  const [searchRequestId, setSearchRequestId] = useState(0)

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!address.trim()) return
    setSearchRequestId(prev => prev + 1)
  }

  return (
    <div className="flex h-full w-full flex-col gap-6 p-6 lg:flex-row">
      {/* left: canvas */}
      <div className="flex flex-1 flex-col gap-4">
        {/* toolbar */}
        <form className="flex items-center gap-3" onSubmit={handleSearch}>
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Enter a house address..."
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-input pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Search size={14} />
            <span className="hidden sm:inline">Find Roof</span>
          </button>
          <button className="flex h-10 items-center gap-2 rounded-lg border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80">
            <Wand2 size={14} />
            <span className="hidden sm:inline">Auto-outline</span>
          </button>
        </form>

        <RoofCanvas
          onMetricsChange={setMetrics}
          addressQuery={address}
          searchRequestId={searchRequestId}
        />
      </div>

      {/* right: sidebar */}
      <div className="flex w-full flex-col gap-4 lg:w-80">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Solar Analysis</h2>
          <p className="text-xs text-muted-foreground">
            Draw a roof polygon to see instant panel layout and energy estimates.
          </p>
        </div>

        <MetricsPanel {...metrics} />

        {/* confidence */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Confidence</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {metrics.panels > 0 ? "Medium" : "Waiting"}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: metrics.panels > 0 ? "55%" : "0%" }}
            />
          </div>
        </div>

        {/* actions */}
        <div className="flex gap-2">
          <button className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            <MessageSquare size={14} />
            Explain it
          </button>
          <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-secondary py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80">
            <Share2 size={14} />
            Share
          </button>
        </div>

        {/* accent picker */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <span className="text-xs font-medium text-muted-foreground">Accent Color</span>
          <HuePicker />
        </div>

        {/* assumptions */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assumptions</h3>
          <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <li className="flex justify-between">
              <span>Module wattage</span>
              <span className="text-foreground">400 W</span>
            </li>
            <li className="flex justify-between">
              <span>Tilt</span>
              <span className="text-foreground">20 deg</span>
            </li>
            <li className="flex justify-between">
              <span>System losses</span>
              <span className="text-foreground">14%</span>
            </li>
            <li className="flex justify-between">
              <span>CO2 factor</span>
              <span className="text-foreground">0.42 kg/kWh</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
