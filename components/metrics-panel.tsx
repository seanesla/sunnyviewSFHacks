"use client"

import { useEffect, useRef, useState } from "react"
import { Sun, Zap, Leaf, LayoutGrid } from "lucide-react"

interface MetricCardProps {
  icon: React.ReactNode
  label: string
  value: number
  suffix: string
  decimals?: number
}

function useAnimatedValue(target: number, duration = 600) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number>(0)

  useEffect(() => {
    const start = display
    const diff = target - start
    const startTime = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(start + diff * eased)
      if (progress < 1) raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return display
}

function MetricCard({ icon, label, value, suffix, decimals = 0 }: MetricCardProps) {
  const animated = useAnimatedValue(value)

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xl font-bold tabular-nums text-foreground">
          {animated.toFixed(decimals)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>
        </span>
      </div>
    </div>
  )
}

interface MetricsPanelProps {
  panels: number
  kw: number
  kwh: number
  co2: number
}

export function MetricsPanel({ panels, kw, kwh, co2 }: MetricsPanelProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <MetricCard icon={<LayoutGrid size={18} />} label="Panels" value={panels} suffix="" />
      <MetricCard icon={<Sun size={18} />} label="System Size" value={kw} suffix="kW" decimals={1} />
      <MetricCard icon={<Zap size={18} />} label="Annual Energy" value={kwh} suffix="kWh/yr" />
      <MetricCard icon={<Leaf size={18} />} label="CO2 Avoided" value={co2} suffix="kg/yr" />
    </div>
  )
}
