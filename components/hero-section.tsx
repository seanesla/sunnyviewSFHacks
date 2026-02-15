"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowRight } from "lucide-react"
import { gsap } from "gsap"
import { AccentColorControl } from "@/components/accent-color-control"
import { LogoPlate } from "@/components/logo-plate"
import { ScrambleText } from "@/components/ScrambleText"

interface HeroSectionProps {
  onStart: () => void
  visible: boolean
}

export function HeroSection({ onStart, visible }: HeroSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
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

  useLayoutEffect(() => {
    if (!visible) return

    const root = rootRef.current
    if (!root) return

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    const q = gsap.utils.selector(root)
    const listeners: Array<{
      el: Element
      enter: () => void
      leave: () => void
    }> = []

    const ctx = gsap.context(() => {
      const staged = q(
        "[data-motion='logo'], [data-motion='kicker'], [data-motion='headline'], [data-motion='copy'], [data-motion='cta-row'], [data-motion='gemini']"
      )

      if (!reduceMotion) {
        gsap.fromTo(
          staged,
          { y: 12, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.52,
            ease: "power3.out",
            stagger: 0.058,
          }
        )

        const ctaEl = q("[data-motion='cta']")[0]
        if (ctaEl) {
          gsap.to(ctaEl, {
            y: -0.85,
            duration: 3.6,
            ease: "sine.inOut",
            repeat: -1,
            yoyo: true,
            delay: 1.4,
          })
        }

        const accentLineEl = q("[data-motion='accent-line']")[0]
        if (accentLineEl) {
          gsap.to(accentLineEl, {
            opacity: 0.96,
            duration: 3.4,
            ease: "sine.inOut",
            repeat: -1,
            yoyo: true,
            delay: 1.25,
          })
        }
      }

      if (reduceMotion) return

      const interactiveEls = q("[data-motion='cta']")

      for (const el of interactiveEls) {
        const enter = () => {
          gsap.to(el, {
            y: -2.1,
            scale: 1.01,
            duration: 0.22,
            ease: "power2.out",
            overwrite: "auto",
          })
        }

        const leave = () => {
          gsap.to(el, {
            y: 0,
            scale: 1,
            duration: 0.26,
            ease: "power2.out",
            overwrite: "auto",
          })
        }

        el.addEventListener("mouseenter", enter)
        el.addEventListener("mouseleave", leave)
        el.addEventListener("focusin", enter)
        el.addEventListener("focusout", leave)
        listeners.push({ el, enter, leave })
      }
    }, root)

    return () => {
      for (const { el, enter, leave } of listeners) {
        el.removeEventListener("mouseenter", enter)
        el.removeEventListener("mouseleave", leave)
        el.removeEventListener("focusin", enter)
        el.removeEventListener("focusout", leave)
      }
      ctx.revert()
    }
  }, [visible])

  return (
    <div
      ref={rootRef}
      className="hero-landing relative isolate flex w-full max-w-[30rem] flex-col justify-center gap-5 transition-[opacity,transform,filter] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0 xl:max-w-[31rem]"
      style={{
        transitionDuration: visible ? "900ms" : "220ms",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(-48px)",
        filter: visible ? "blur(0px)" : "blur(10px)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div className="relative z-20 flex flex-col gap-3">
        <div className="relative z-[60] w-fit isolate" data-motion="logo">
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
            <div className="logo-hint-tooltip pointer-events-auto absolute left-0 top-[calc(100%+0.7rem)] z-[80] w-[min(86vw,21rem)] rounded-lg border border-primary/45 bg-background/90 px-3 py-2 text-xs text-foreground shadow-[0_20px_40px_-26px_rgba(0,0,0,0.9)] backdrop-blur-md">
              Click the logo to adjust the accent color.
            </div>
          ) : null}

          {showAccentPicker ? (
            <div className="logo-accent-popover pointer-events-auto absolute left-0 top-[calc(100%+0.7rem)] z-[90] w-[min(86vw,22rem)] rounded-xl border border-border/85 bg-background/95 p-3 shadow-[0_28px_64px_-30px_rgba(0,0,0,0.98)] backdrop-blur-md">
              <AccentColorControl compact showSwatch={false} />
            </div>
          ) : null}
        </div>

        <span className="text-sm font-light tracking-[0.2em] text-primary uppercase" data-motion="kicker">
          Solar Feasibility in 30 Seconds
        </span>
        <h1 className="hero-landing__title text-balance text-[clamp(3rem,6.4vw,6rem)] font-extralight leading-[0.98] tracking-tight text-foreground" data-motion="headline">
          <ScrambleText text="Trace" trigger={visible} /> <ScrambleText text="a" trigger={visible} /> <ScrambleText text="roof." trigger={visible} />
          <br />
          <span className="text-primary text-glow" data-motion="accent-line">
            <ScrambleText text="See" trigger={visible} speed={45} /> <ScrambleText text="the" trigger={visible} speed={45} /> <ScrambleText text="potential." trigger={visible} speed={45} />
          </span>
        </h1>
      </div>

      <p className="hero-landing__copy max-w-[34ch] text-pretty leading-relaxed text-muted-foreground" data-motion="copy">
        Sunnyview turns any satellite view into an instant solar layout.
        Draw a roof polygon, and watch panels fill in live with real energy
        and CO2 estimates. No account needed.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center" data-motion="cta-row">
        <button
          onClick={onStart}
          className="hero-cta-premium group flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:gap-3 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-primary/20"
          data-motion="cta"
        >
          Launch Demo
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
        <span className="hero-landing__cta-hint text-xs text-muted-foreground">
          or click the Earth to begin
        </span>
      </div>

      <div className="hero-landing__gemini glass-card gradient-border rounded-xl p-3.5 sm:p-4" data-motion="gemini">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold tracking-wide text-foreground uppercase">Gemini API key</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Stored locally in this browser (localStorage). Format + live check.</div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={
                geminiKeyState === "valid"
                  ? "rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200"
                  : geminiKeyState === "checking"
                    ? "rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-200"
                    : geminiKeyState === "invalid"
                      ? "rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-200"
                      : "rounded-md border border-border/45 bg-secondary/40 px-2 py-1 text-[10px] font-semibold text-muted-foreground"
              }
            >
              {geminiKeyState === "valid"
                ? "Valid"
                : geminiKeyState === "checking"
                  ? "Checking…"
                  : geminiKeyState === "invalid"
                    ? "Invalid"
                    : "Optional"}
            </div>
            <button
              type="button"
              className="rounded-md bg-secondary px-3 py-1.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
              onClick={() => setShowGeminiKey((v) => !v)}
            >
              {showGeminiKey ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <div className="mt-3">
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
                : geminiKeyState === "invalid" && rawGeminiKey.length > 0
                  ? "border-rose-400/55 focus-visible:ring-rose-400/35"
                  : "border-input focus-visible:ring-primary/50")
            }
          />
        </div>
      </div>
    </div>
  )
}
