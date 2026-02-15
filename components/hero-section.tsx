"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowRight, PlugZap, Sparkles } from "lucide-react"
import { gsap } from "gsap"

import { AccentColorControl } from "@/components/accent-color-control"
import { LogoPlate } from "@/components/logo-plate"
import { ScrambleText } from "@/components/ScrambleText"
import { cn } from "@/lib/utils"

type IntegrationStatus = "off" | "checking" | "ready" | "invalid"

interface HeroSectionProps {
  onStart: () => void
  onOpenIntegrations: () => void
  visible: boolean
  geminiStatus: IntegrationStatus
  voiceStatus: "off" | "ready"
}

function integrationChipText(label: "Gemini" | "Voice", status: IntegrationStatus | "ready" | "off") {
  if (status === "ready") return `${label}: Ready`
  if (status === "checking") return `${label}: Checking`
  if (status === "invalid") return `${label}: Invalid`
  return `${label}: Off`
}

function integrationChipClass(status: IntegrationStatus | "ready" | "off") {
  if (status === "ready") {
    return "border-emerald-400/35 bg-emerald-500/12 text-emerald-200"
  }
  if (status === "checking") {
    return "border-amber-400/35 bg-amber-500/12 text-amber-200"
  }
  if (status === "invalid") {
    return "border-rose-400/35 bg-rose-500/12 text-rose-200"
  }
  return "border-border/70 bg-background/45 text-muted-foreground"
}

export function HeroSection({
  onStart,
  onOpenIntegrations,
  visible,
  geminiStatus,
  voiceStatus,
}: HeroSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [showAccentPicker, setShowAccentPicker] = useState(false)
  const [showLogoHint, setShowLogoHint] = useState(false)

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

  useLayoutEffect(() => {
    if (!visible) return

    const root = rootRef.current
    if (!root) return

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    const q = gsap.utils.selector(root)
    const listeners: Array<{ el: Element; enter: () => void; leave: () => void }> = []

    const ctx = gsap.context(() => {
      const staged = q(
        "[data-motion='logo'], [data-motion='eyebrow'], [data-motion='kicker'], [data-motion='headline'], [data-motion='copy'], [data-motion='cta-row'], [data-motion='chips']"
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
      }

      if (reduceMotion) return

      const interactiveEls = q("[data-motion='cta'], [data-motion='integrations-cta']")
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

        <div
          data-motion="eyebrow"
          className="hero-landing__eyebrow inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/40 bg-primary/12 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-primary uppercase"
        >
          <Sparkles size={11} />
          Instant Roof Insights
        </div>

        <span className="text-sm font-light tracking-[0.2em] text-primary uppercase" data-motion="kicker">
          Solar Feasibility in 30 Seconds
        </span>

        <h1
          className="hero-landing__title text-balance text-[clamp(3rem,6.4vw,6rem)] font-extralight leading-[0.98] tracking-tight text-foreground"
          data-motion="headline"
        >
          <ScrambleText text="Trace a roof." trigger={visible} />
          <br />
          <span className="text-primary text-glow">
            <ScrambleText text="See the potential." trigger={visible} speed={45} />
          </span>
        </h1>
      </div>

      <p className="hero-landing__copy max-w-[34ch] text-pretty leading-relaxed text-muted-foreground" data-motion="copy">
        Sunnyview turns any satellite view into an instant solar layout.
        Draw a roof polygon and watch panel count, kWh, and CO2 update in real time.
      </p>

      <div className="hero-landing__cta-row flex flex-col gap-2.5 sm:flex-row sm:items-center" data-motion="cta-row">
        <button
          onClick={onStart}
          className="hero-cta-premium group inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20"
          data-motion="cta"
        >
          Launch Demo
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>

        <button
          type="button"
          onClick={onOpenIntegrations}
          className="hero-secondary-action inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-primary/45 bg-primary/12 px-4 text-xs font-semibold text-foreground transition hover:bg-primary/20"
          data-motion="integrations-cta"
        >
          <PlugZap size={14} className="text-primary" />
          Add API keys
        </button>
      </div>

      <div className="hero-landing__chips flex flex-wrap gap-2" data-motion="chips">
        <span className="hero-chip border-border/70 bg-background/45 text-muted-foreground">No account needed</span>
        <span className="hero-chip border-border/70 bg-background/45 text-muted-foreground">~30s workflow</span>
        <span className={cn("hero-chip", integrationChipClass(geminiStatus))}>
          <Sparkles size={11} className="opacity-90" />
          {integrationChipText("Gemini", geminiStatus)}
        </span>
        <span className={cn("hero-chip", integrationChipClass(voiceStatus))}>
          <Sparkles size={11} className="opacity-90" />
          {integrationChipText("Voice", voiceStatus)}
        </span>
      </div>
    </div>
  )
}
