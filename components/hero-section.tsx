"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowRight } from "lucide-react"
import { AccentColorControl } from "@/components/accent-color-control"
import { LogoPlate } from "@/components/logo-plate"
import { ScrambleText } from "@/components/ScrambleText"

interface HeroSectionProps {
  onStart: () => void
  visible: boolean
}

export function HeroSection({ onStart, visible }: HeroSectionProps) {
  const [showAccentPicker, setShowAccentPicker] = useState(false)
  const [showLogoHint, setShowLogoHint] = useState(false)
  const [geminiKey, setGeminiKey] = useState("")
  const [showGeminiKey, setShowGeminiKey] = useState(false)

  const [geminiOnlineKey, setGeminiOnlineKey] = useState<string | null>(null)
  const [geminiOnlineOk, setGeminiOnlineOk] = useState<boolean | null>(null)
  const validateAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const k = "sunnyview-gemini-api-key-v1"
    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled) return
      try {
        const v = window.localStorage.getItem(k)
        if (v) setGeminiKey(v)
      } catch {
        // ignore
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    const k = "sunnyview-gemini-api-key-v1"
    const t = window.setTimeout(() => {
      try {
        if (geminiKey.trim().length === 0) window.localStorage.removeItem(k)
        else window.localStorage.setItem(k, geminiKey)
      } catch {
        // ignore
      }
    }, 120)
    return () => window.clearTimeout(t)
  }, [geminiKey])

  useEffect(() => {
    const raw = geminiKey.trim()
    validateAbortRef.current?.abort()

    if (!raw) return
    if (!/^[A-Za-z0-9._-]{20,}$/.test(raw)) return

    const ac = new AbortController()
    validateAbortRef.current = ac

    const t = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/gemini-validate", {
          method: "POST",
          signal: ac.signal,
          headers: {
            "content-type": "application/json",
            "x-gemini-api-key": raw,
          },
          body: JSON.stringify({}),
        })
        const data = (await res.json().catch(() => null)) as any
        if (ac.signal.aborted) return
        setGeminiOnlineKey(raw)
        setGeminiOnlineOk(data?.ok === true)
      } catch {
        if (ac.signal.aborted) return
        setGeminiOnlineKey(raw)
        setGeminiOnlineOk(false)
      }
    }, 260)

    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [geminiKey])

  useEffect(() => {
    if (!visible) {
      const resetTimer = window.setTimeout(() => {
        setShowAccentPicker(false)
        setShowLogoHint(false)
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const hintSeenKey = "sunnyview-logo-accent-hint-v1"
    if (window.sessionStorage.getItem(hintSeenKey)) return

    const showTimer = window.setTimeout(() => setShowLogoHint(true), 1500)
    const hideTimer = window.setTimeout(() => {
      setShowLogoHint(false)
      window.sessionStorage.setItem(hintSeenKey, "1")
    }, 4000)

    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
    }
  }, [visible])

  function handleLogoClick() {
    window.sessionStorage.setItem("sunnyview-logo-accent-hint-v1", "1")
    setShowLogoHint(false)
    setShowAccentPicker((prev) => !prev)
  }

  const rawGeminiKey = geminiKey.trim()
  const geminiFormatOk = rawGeminiKey.length > 0 && /^[A-Za-z0-9._-]{20,}$/.test(rawGeminiKey)
  const geminiKeyState: "idle" | "checking" | "valid" | "invalid" =
    rawGeminiKey.length === 0
      ? "idle"
      : !geminiFormatOk
        ? "invalid"
        : geminiOnlineKey === rawGeminiKey
          ? geminiOnlineOk
            ? "valid"
            : "invalid"
          : "checking"

  return (
    <div
      className="flex flex-col justify-center gap-6 transition-[opacity,transform,filter] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0"
      style={{
        transitionDuration: visible ? "900ms" : "220ms",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(-48px)",
        filter: visible ? "blur(0px)" : "blur(10px)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="relative w-fit">
          <button
            type="button"
            onClick={handleLogoClick}
            aria-expanded={showAccentPicker}
            aria-label="Adjust accent color"
            className="group rounded-[1.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
          >
            <LogoPlate className="w-fit transition-transform duration-300 group-hover:scale-[1.012] group-active:scale-[0.992]" />
          </button>

          {showLogoHint && !showAccentPicker ? (
            <div className="logo-hint-tooltip absolute left-0 top-[calc(100%+0.7rem)] z-20 w-[min(86vw,21rem)] rounded-lg border border-primary/45 bg-background/80 px-3 py-2 text-xs text-foreground shadow-[0_20px_40px_-26px_rgba(0,0,0,0.9)] backdrop-blur-md">
              Click the logo to adjust the accent color.
            </div>
          ) : null}

          {showAccentPicker ? (
            <div className="logo-accent-popover absolute left-0 top-[calc(100%+0.7rem)] z-20 w-[min(86vw,22rem)] rounded-xl border border-border/75 bg-background/75 p-3 shadow-[0_24px_50px_-26px_rgba(0,0,0,0.95)] backdrop-blur-md">
              <AccentColorControl compact showSwatch={false} />
            </div>
          ) : null}
        </div>

        <span className="text-sm font-light tracking-[0.2em] text-primary uppercase">
          Solar Feasibility in 30 Seconds
        </span>
        <h1 className="text-balance text-5xl font-extralight leading-tight tracking-tight text-foreground lg:text-7xl">
          <ScrambleText text="Trace a roof." trigger={visible} />
          <br />
          <span className="text-primary text-glow">
            <ScrambleText text="See the potential." trigger={visible} speed={45} />
          </span>
        </h1>
      </div>

      <p className="max-w-md text-pretty leading-relaxed text-muted-foreground">
        Sunnyview turns any satellite view into an instant solar layout.
        Draw a roof polygon, and watch panels fill in live with real energy
        and CO2 estimates. No account needed.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          onClick={onStart}
          className="group flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:gap-3 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-primary/20"
        >
          Launch Demo
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
        <span className="text-xs text-muted-foreground">
          or click the Earth to begin
        </span>
      </div>

        <div className="glass-card gradient-border rounded-lg p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold tracking-wide text-foreground uppercase">Gemini API key</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">Stored locally. Status shows only Valid/Invalid.</div>
            </div>
            <div className="flex items-center gap-2">
              {geminiKeyState === "checking" ? (
                <div className="rounded-md border border-border/45 bg-secondary/40 px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                  Checking…
                </div>
              ) : null}
              {geminiKeyState === "valid" || geminiKeyState === "invalid" ? (
                <div
                  className={
                    geminiKeyState === "valid"
                      ? "rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200"
                      : "rounded-md border border-rose-400/35 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-200"
                  }
                >
                  {geminiKeyState === "valid" ? "Valid" : "Invalid"}
                </div>
              ) : null}
              <button
                type="button"
                className="rounded-md bg-secondary px-3 py-1.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={() => setShowGeminiKey((v) => !v)}
              >
                {showGeminiKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="mt-2">
            <input
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              type={showGeminiKey ? "text" : "password"}
              placeholder="Paste your Gemini API key"
              autoComplete="off"
              spellCheck={false}
              className={
                "h-10 w-full rounded-lg border bg-background/60 px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 " +
                (geminiKeyState === "valid"
                  ? "border-emerald-400/55 focus-visible:ring-emerald-400/35"
                  : geminiKeyState === "invalid" && geminiKey.trim().length > 0
                    ? "border-rose-400/55 focus-visible:ring-rose-400/35"
                    : "border-input focus-visible:ring-primary/50")
              }
            />
          </div>
        </div>

      {/* preview cards */}
      <div className="mt-4 flex gap-3">
        {["Panel Layout", "Energy Report", "Share QR"].map(label => (
          <div
            key={label}
            className="glass-card gradient-border flex h-20 w-28 items-center justify-center"
          >
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
