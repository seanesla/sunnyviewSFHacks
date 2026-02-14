import { useEffect, useState, type CSSProperties } from "react"
import sunnyviewLogo from "@/sunnyviewlogo.svg"
import { cn } from "@/lib/utils"

const LOFI_PHRASES = [
  "Tracing roof lines",
  "Calibrating sunlight model",
  "Mapping panel geometry",
  "Estimating seasonal output",
]

interface SunnyviewLogoLoaderProps {
  className?: string
}

export function SunnyviewLogoLoader({ className }: SunnyviewLogoLoaderProps) {
  const logoSrc = typeof sunnyviewLogo === "string" ? sunnyviewLogo : sunnyviewLogo.src
  const [logoReady, setLogoReady] = useState(false)
  const [animationArmed, setAnimationArmed] = useState(false)
  const [phraseIndex, setPhraseIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    const preload = new Image()

    const markReady = () => {
      if (cancelled) return
      setLogoReady(true)
    }

    preload.decoding = "sync"
    preload.src = logoSrc

    if (preload.complete && preload.naturalWidth > 0) {
      markReady()
    } else {
      preload.addEventListener("load", markReady)
      preload.addEventListener("error", markReady)
      if (typeof preload.decode === "function") {
        void preload.decode().then(markReady).catch(() => {
          // ignore; load/error listeners still handle completion
        })
      }
    }

    return () => {
      cancelled = true
      preload.removeEventListener("load", markReady)
      preload.removeEventListener("error", markReady)
    }
  }, [logoSrc])

  useEffect(() => {
    if (!logoReady) return
    const startRaf = window.requestAnimationFrame(() => {
      setAnimationArmed(true)
    })

    return () => {
      window.cancelAnimationFrame(startRaf)
    }
  }, [logoReady])

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (reduceMotion) return

    const tickerInterval = window.setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % LOFI_PHRASES.length)
    }, 3100)

    return () => {
      window.clearInterval(tickerInterval)
    }
  }, [])

  const logoMaskStyle = {
    ["--sv-loader-logo-src" as string]: `url("${logoSrc}")`,
  } as CSSProperties

  return (
    <div className={cn("sv-loader", className)}>
      <span className="sr-only">Loading Sunnyview</span>

      <div className="sv-loader__mark" aria-hidden>
        <span
          className={cn(
            "sv-loader__logo",
            logoReady && "sv-loader__logo--ready",
            animationArmed && "sv-loader__logo--animate"
          )}
          style={logoMaskStyle}
        />
      </div>

      <div className="sv-loader__status" aria-hidden>
        <span className="sv-loader__title">Preparing Sunnyview</span>
        <div className="sv-loader__ticker">
          <span key={phraseIndex} className="sv-loader__phrase">
            {LOFI_PHRASES[phraseIndex]}
          </span>
          <span className="sv-loader__dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
      </div>
    </div>
  )
}
