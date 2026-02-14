import type { CSSProperties } from "react"
import sunnyviewLogo from "@/sunnyviewlogo.svg"
import { cn } from "@/lib/utils"

interface LogoPlateProps {
  className?: string
}

export function LogoPlate({ className }: LogoPlateProps) {
  const logoSrc = typeof sunnyviewLogo === "string" ? sunnyviewLogo : sunnyviewLogo.src
  const logoMaskStyle = {
    ["--logo-src" as string]: `url("${logoSrc}")`,
  } as CSSProperties

  return (
    <div className={cn("logo-plate relative inline-flex w-fit max-w-full rounded-[1.75rem] p-[1px]", className)}>
      <div className="logo-plate__surface relative flex items-center justify-center rounded-[1.68rem] px-3 py-2.5 sm:px-4 sm:py-3">
        <span aria-hidden className="logo-mark pointer-events-none select-none" style={logoMaskStyle} />
      </div>
    </div>
  )
}
