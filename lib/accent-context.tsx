"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

interface AccentContextType {
  hue: number
  setHue: (hue: number) => void
}

const AccentContext = createContext<AccentContextType>({
  hue: 200,
  setHue: () => {},
})

export function AccentProvider({ children }: { children: ReactNode }) {
  const [hue, setHue] = useState(200)

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-hue", String(hue))
  }, [hue])

  return (
    <AccentContext.Provider value={{ hue, setHue }}>
      {children}
    </AccentContext.Provider>
  )
}

export function useAccent() {
  return useContext(AccentContext)
}
