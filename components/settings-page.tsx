"use client"

import Link from "next/link"
import { ArrowLeft, Palette, RotateCcw } from "lucide-react"
import { AuroraBackground } from "@/components/AuroraBackground"
import { MouseSpotlight } from "@/components/MouseSpotlight"
import { ACCENT_SAT_MAX, ACCENT_SAT_MIN, useAccent } from "@/lib/accent-context"

const PRESET_ACCENTS: Array<{ label: string; hue: number; saturation: number }> = [
  { label: "Ocean", hue: 205, saturation: 0.2 },
  { label: "Citrus", hue: 96, saturation: 0.2 },
  { label: "Copper", hue: 40, saturation: 0.21 },
  { label: "Rose", hue: 14, saturation: 0.19 },
  { label: "Sky", hue: 226, saturation: 0.17 },
  { label: "Mint", hue: 158, saturation: 0.17 },
]

export function SettingsPage() {
  const { hue, saturation, setHue, setSaturation, resetAccent } = useAccent()

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <AuroraBackground />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,20,0.10)_0%,rgba(3,8,20,0.14)_42%,rgba(3,8,20,0.28)_100%)]" />
      <MouseSpotlight />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/35 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition hover:bg-background/55"
          >
            <ArrowLeft size={14} />
            Back to app
          </Link>
          <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Settings</div>
        </header>

        <main className="glass-card gradient-border rounded-2xl p-6 sm:p-8">
          <div className="flex items-center gap-2 text-primary">
            <Palette size={16} />
            <span className="text-xs font-semibold tracking-[0.18em] uppercase">Accent</span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Choose your accent color</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            This changes the app accent and the animated background color. The 3D globe imagery stays the same.
          </p>

          <div className="mt-6 grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-4">
              <label className="block space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Hue</span>
                  <span className="text-foreground">{Math.round(hue)} deg</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={hue}
                  onChange={(event) => setHue(Number(event.target.value))}
                  className="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full outline-none"
                  style={{
                    background:
                      "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
                  }}
                />
              </label>

              <label className="block space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Intensity</span>
                  <span className="text-foreground">{Math.round(saturation * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={ACCENT_SAT_MIN}
                  max={ACCENT_SAT_MAX}
                  step={0.01}
                  value={saturation}
                  onChange={(event) => setSaturation(Number(event.target.value))}
                  className="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full outline-none"
                  style={{
                    background: `linear-gradient(to right, oklch(0.74 ${ACCENT_SAT_MIN} ${hue}), oklch(0.74 ${ACCENT_SAT_MAX} ${hue}))`,
                  }}
                />
              </label>

              <div>
                <div className="text-xs text-muted-foreground">Quick picks</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRESET_ACCENTS.map((preset) => {
                    const active = Math.abs(preset.hue - hue) < 1 && Math.abs(preset.saturation - saturation) < 0.011
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setHue(preset.hue)
                          setSaturation(preset.saturation)
                        }}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                          active
                            ? "border-primary/70 bg-primary/15 text-foreground"
                            : "border-border/70 bg-background/35 text-muted-foreground hover:bg-background/55"
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-black/20"
                          style={{ background: `oklch(0.72 ${preset.saturation} ${preset.hue})` }}
                        />
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <aside className="rounded-xl border border-border/80 bg-background/35 p-4">
              <div className="text-xs text-muted-foreground">Live preview</div>
              <div className="mt-3 flex items-center gap-3">
                <div
                  className="h-14 w-14 rounded-full border border-foreground/20 shadow-[0_0_30px_-6px_rgba(0,0,0,0.65)]"
                  style={{ background: `oklch(0.72 ${saturation} ${hue})` }}
                />
                <div>
                  <div className="text-sm font-semibold text-foreground">App Accent</div>
                  <div className="text-xs text-muted-foreground">{`oklch(0.72 ${saturation.toFixed(2)} ${Math.round(hue)})`}</div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-border/80 bg-card/60 p-3">
                <div className="text-xs text-muted-foreground">Sample button</div>
                <button type="button" className="mt-2 w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
                  Primary Action
                </button>
              </div>
            </aside>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">Saved automatically for future visits.</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetAccent}
                className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/35 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-background/55"
              >
                <RotateCcw size={14} />
                Reset default
              </button>
              <Link
                href="/"
                className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Done
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
