"use client"

import { ArrowRight } from "lucide-react"

interface HeroSectionProps {
  onStart: () => void
  visible: boolean
}

export function HeroSection({ onStart, visible }: HeroSectionProps) {
  return (
    <div
      className="flex flex-col justify-center gap-6 transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(-48px)",
        filter: visible ? "blur(0px)" : "blur(10px)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium tracking-widest text-primary uppercase">
          Solar Feasibility in 30 Seconds
        </span>
        <h1 className="text-balance text-5xl font-bold leading-tight tracking-tight text-foreground lg:text-6xl">
          Trace a roof.
          <br />
          <span className="text-primary">See the potential.</span>
        </h1>
      </div>

      <p className="max-w-md text-pretty leading-relaxed text-muted-foreground">
        sunnyview turns any satellite view into an instant solar layout.
        Draw a roof polygon, and watch panels fill in live with real energy
        and CO2 estimates. No account needed.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          onClick={onStart}
          className="group flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:gap-3"
        >
          Launch Demo
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
        <span className="text-xs text-muted-foreground">
          or click the Earth to begin
        </span>
      </div>

      {/* placeholder image areas */}
      <div className="mt-4 flex gap-3">
        {["Panel Layout", "Energy Report", "Share QR"].map(label => (
          <div
            key={label}
            className="flex h-20 w-28 items-center justify-center rounded-lg border border-dashed border-border bg-card/50"
          >
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
