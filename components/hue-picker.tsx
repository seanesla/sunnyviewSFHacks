"use client"

import { useAccent } from "@/lib/accent-context"

export function HuePicker() {
  const { hue, setHue } = useAccent()

  return (
    <div className="flex items-center gap-3">
      <div
        className="h-5 w-5 shrink-0 rounded-full border border-foreground/20"
        style={{ background: `oklch(0.7 0.18 ${hue})` }}
      />
      <input
        type="range"
        min={0}
        max={360}
        value={hue}
        onChange={(e) => setHue(Number(e.target.value))}
        className="hue-slider h-3 w-36 cursor-pointer appearance-none rounded-full outline-none"
        style={{
          background:
            "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
        }}
      />
    </div>
  )
}
