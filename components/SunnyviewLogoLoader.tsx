import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

import SunnyviewLogoOptimized from "@/components/SunnyviewLogoOptimized"
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
  const [phraseIndex, setPhraseIndex] = useState(0)
  const reduceMotion = useReducedMotion()
  const glyphRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = glyphRef.current
    if (!root) return

    const path = root.querySelector<SVGPathElement>("path")
    if (!path) return

    const pathLength = Math.ceil(path.getTotalLength())
    root.style.setProperty("--sv-loader-path-length", `${pathLength}`)
  }, [])

  useEffect(() => {
    if (reduceMotion) return

    const tickerInterval = window.setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % LOFI_PHRASES.length)
    }, 3100)

    return () => {
      window.clearInterval(tickerInterval)
    }
  }, [reduceMotion])

  return (
    <div className={cn("sv-loader", className)}>
      <span className="sr-only">Loading Sunnyview</span>

      <motion.div
        className="sv-loader__mark"
        aria-hidden
        initial={reduceMotion ? false : { opacity: 0, y: 9, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.62, ease: [0.2, 0.85, 0.2, 1] }}
      >
        <div ref={glyphRef} className="sv-loader__glyph">
          <SunnyviewLogoOptimized className="sv-loader__svg" aria-hidden />
        </div>
        {!reduceMotion ? <span className="sv-loader__beam" /> : null}
      </motion.div>

      <motion.div
        className="sv-loader__status"
        aria-hidden
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.52, delay: 0.14, ease: [0.2, 0.85, 0.2, 1] }}
      >
        <span className="sv-loader__title">Preparing Sunnyview</span>
        <div className="sv-loader__ticker">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={phraseIndex}
              className="sv-loader__phrase"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={reduceMotion ? { duration: 0.01 } : { duration: 0.4, ease: [0.2, 0.85, 0.2, 1] }}
            >
              {LOFI_PHRASES[phraseIndex]}
            </motion.span>
          </AnimatePresence>
          <span className="sv-loader__dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
      </motion.div>
    </div>
  )
}
