"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { usePathname } from "next/navigation"

type RouteTransitionProps = {
  children: ReactNode
}

const PAGE_EASE: [number, number, number, number] = [0.2, 0.9, 0.24, 1]
const FADE_EASE: [number, number, number, number] = [0.33, 1, 0.68, 1]

export function RouteTransition({ children }: RouteTransitionProps) {
  const pathname = usePathname()
  const prefersReducedMotion = useReducedMotion()
  const initial = prefersReducedMotion
    ? { opacity: 0 }
    : {
        opacity: 0,
        y: 10,
        scale: 0.997,
        filter: "blur(5px)",
      }

  const animate = prefersReducedMotion
    ? { opacity: 1 }
    : {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
      }

  const exit = prefersReducedMotion
    ? {
        opacity: 0,
        transition: { duration: 0.1 },
      }
    : {
        opacity: 0,
        y: -6,
        scale: 1,
        filter: "blur(2px)",
        transition: {
          opacity: { duration: 0.16, ease: FADE_EASE },
          y: { duration: 0.24, ease: PAGE_EASE },
          scale: { duration: 0.24, ease: PAGE_EASE },
          filter: { duration: 0.14, ease: FADE_EASE },
        },
      }

  const transition = prefersReducedMotion
    ? { duration: 0.14 }
    : {
        opacity: { duration: 0.24, ease: FADE_EASE },
        y: { duration: 0.36, ease: PAGE_EASE },
        scale: { duration: 0.36, ease: PAGE_EASE },
        filter: { duration: 0.2, ease: FADE_EASE },
      }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="relative min-h-screen transform-gpu"
        initial={initial}
        animate={animate}
        exit={exit}
        transition={transition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
