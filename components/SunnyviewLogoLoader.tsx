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
  const [pathData, setPathData] = useState<string | null>(null)
  const [phraseIndex, setPhraseIndex] = useState(0)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(logoSrc)
        if (!res.ok) return
        const source = await res.text()
        if (cancelled) return
        const doc = new DOMParser().parseFromString(source, "image/svg+xml")
        const d = doc.querySelector("path")?.getAttribute("d")?.trim() ?? null
        if (d) {
          setPathData(d)
        }
      } catch {
        // keep fallback mark if path extraction fails
      }
    })()

    return () => {
      cancelled = true
    }
  }, [logoSrc])

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
          className={cn("sv-loader__fallback", pathData && "sv-loader__fallback--hidden")}
          style={logoMaskStyle}
        />

        {pathData ? (
          <svg
            className="sv-loader__svg"
            viewBox="0 0 172.56795 88.107307"
            role="presentation"
            focusable="false"
          >
            <path className="sv-loader__path" d={pathData} pathLength={1} />
          </svg>
        ) : null}
      </div>

      <div className="sv-loader__ticker" aria-hidden>
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
  )
}
