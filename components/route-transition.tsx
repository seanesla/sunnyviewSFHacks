"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { usePathname } from "next/navigation"

type RouteTransitionProps = {
  children: ReactNode
}

const PAGE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

export function RouteTransition({ children }: RouteTransitionProps) {
  const pathname = usePathname()
  const prefersReducedMotion = useReducedMotion()

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="relative min-h-screen"
        initial={
          prefersReducedMotion
            ? { opacity: 0 }
            : {
                opacity: 0,
                y: 14,
                scale: 0.995,
                filter: "blur(8px)",
              }
        }
        animate={
          prefersReducedMotion
            ? { opacity: 1 }
            : {
                opacity: 1,
                y: 0,
                scale: 1,
                filter: "blur(0px)",
              }
        }
        exit={
          prefersReducedMotion
            ? { opacity: 0 }
            : {
                opacity: 0,
                y: -10,
                scale: 1,
                filter: "blur(6px)",
              }
        }
        transition={
          prefersReducedMotion
            ? { duration: 0.18 }
            : {
                duration: 0.44,
                ease: PAGE_EASE,
              }
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
