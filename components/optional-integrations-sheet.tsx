"use client"

import { useLayoutEffect, useRef } from "react"
import { Bot, KeyRound, Loader2, Mic2, Sparkles } from "lucide-react"
import { gsap } from "gsap"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

type GeminiState = "idle" | "checking" | "valid" | "invalid"

type OptionalIntegrationsSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  geminiKey: string
  onGeminiKeyChange: (value: string) => void
  showGeminiKey: boolean
  onToggleShowGeminiKey: () => void
  geminiState: GeminiState
  elevenLabsKey: string
  onElevenLabsKeyChange: (value: string) => void
  elevenLabsVoiceId: string
  onElevenLabsVoiceIdChange: (value: string) => void
  showElevenLabsKey: boolean
  onToggleShowElevenLabsKey: () => void
  backendSameOrigin: boolean
}

function statusMeta(label: "gemini" | "voice", state: GeminiState | "ready" | "off") {
  if (label === "gemini") {
    if (state === "valid") {
      return {
        text: "Gemini ready",
        className: "border-emerald-400/35 bg-emerald-500/12 text-emerald-200",
      }
    }
    if (state === "checking") {
      return {
        text: "Checking key",
        className: "border-amber-400/35 bg-amber-500/12 text-amber-200",
      }
    }
    if (state === "invalid") {
      return {
        text: "Invalid key",
        className: "border-rose-400/35 bg-rose-500/12 text-rose-200",
      }
    }
    return {
      text: "Gemini off",
      className: "border-border/60 bg-secondary/45 text-muted-foreground",
    }
  }

  if (state === "ready") {
    return {
      text: "Voice ready",
      className: "border-sky-400/35 bg-sky-500/12 text-sky-200",
    }
  }

  return {
    text: "Voice off",
    className: "border-border/60 bg-secondary/45 text-muted-foreground",
  }
}

export function OptionalIntegrationsSheet({
  open,
  onOpenChange,
  geminiKey,
  onGeminiKeyChange,
  showGeminiKey,
  onToggleShowGeminiKey,
  geminiState,
  elevenLabsKey,
  onElevenLabsKeyChange,
  elevenLabsVoiceId,
  onElevenLabsVoiceIdChange,
  showElevenLabsKey,
  onToggleShowElevenLabsKey,
  backendSameOrigin,
}: OptionalIntegrationsSheetProps) {
  const isMobile = useIsMobile() ?? false
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open || !bodyRef.current) return
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (reduceMotion) return

    const q = gsap.utils.selector(bodyRef)
    const nodes = q("[data-intg-row]")
    if (!nodes.length) return

    gsap.fromTo(
      nodes,
      { y: 10, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.38,
        ease: "power2.out",
        stagger: 0.055,
      }
    )
  }, [open])

  const geminiBadge = statusMeta("gemini", geminiState)
  const voiceBadge = statusMeta("voice", elevenLabsKey.trim().length > 0 ? "ready" : "off")

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        overlayClassName="!bg-[radial-gradient(120%_90%_at_100%_0%,rgba(42,137,196,0.16)_0%,rgba(7,18,36,0.34)_52%,rgba(2,8,20,0.48)_100%)] !backdrop-blur-[1.5px]"
        className={cn(
          "isolate overflow-hidden z-[68] gap-0 border-primary/28 bg-[linear-gradient(168deg,rgba(8,20,36,0.82)_0%,rgba(7,14,30,0.74)_48%,rgba(5,12,26,0.68)_100%)] p-0 backdrop-blur-3xl shadow-[0_32px_90px_-42px_rgba(0,0,0,0.95)] before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(120%_80%_at_100%_0%,rgba(96,214,255,0.08)_0%,transparent_45%)]",
          isMobile ? "h-[84vh] rounded-t-2xl" : "h-full w-full sm:max-w-[31rem]"
        )}
      >
        <SheetHeader className="relative z-[1] border-b border-border/60 px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base text-foreground">
            <Sparkles size={15} className="text-primary" />
            API keys & integrations
          </SheetTitle>
          <SheetDescription>
            Connect Gemini and ElevenLabs for richer recommendations and voice output. Keys stay in this browser.
          </SheetDescription>
        </SheetHeader>

        <div
          ref={bodyRef}
          className="relative z-[1] h-full overflow-auto px-5 py-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div data-intg-row className="glass-card gradient-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-foreground uppercase">
                  <Bot size={13} className="text-primary" />
                  Gemini
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Used for panel recommendations (`/api/panel-recommend`).
                </p>
              </div>

              <span className={cn("rounded-full border px-2 py-1 text-[10px] font-medium", geminiBadge.className)}>
                {geminiBadge.text}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={onToggleShowGeminiKey}
                className="rounded-md bg-secondary/80 px-3 py-1.5 text-[11px] font-medium text-secondary-foreground transition hover:bg-secondary"
              >
                {showGeminiKey ? "Hide" : "Show"}
              </button>
            </div>

            <div className="mt-2">
              <label className="text-[11px] text-muted-foreground">
                API key
                <input
                  value={geminiKey}
                  onChange={(e) => onGeminiKeyChange(e.target.value)}
                  type={showGeminiKey ? "text" : "password"}
                  placeholder="Paste your Gemini API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                />
              </label>
              {geminiState === "checking" ? (
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-amber-200">
                  <Loader2 size={11} className="animate-spin" />
                  Validating key...
                </div>
              ) : null}
            </div>
          </div>

          <div data-intg-row className="glass-card gradient-border mt-3 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-foreground uppercase">
                  <Mic2 size={13} className="text-primary" />
                  ElevenLabs
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Used for Talk (`/api/tts`) with optional voice ID.
                </p>
              </div>

              <span className={cn("rounded-full border px-2 py-1 text-[10px] font-medium", voiceBadge.className)}>
                {voiceBadge.text}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={onToggleShowElevenLabsKey}
                className="rounded-md bg-secondary/80 px-3 py-1.5 text-[11px] font-medium text-secondary-foreground transition hover:bg-secondary"
              >
                {showElevenLabsKey ? "Hide" : "Show"}
              </button>
            </div>

            <div className="mt-2 grid gap-2">
              <label className="text-[11px] text-muted-foreground">
                API key
                <input
                  value={elevenLabsKey}
                  onChange={(e) => onElevenLabsKeyChange(e.target.value)}
                  type={showElevenLabsKey ? "text" : "password"}
                  placeholder="Paste your ElevenLabs API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                />
              </label>

              <label className="text-[11px] text-muted-foreground">
                Voice ID (optional)
                <input
                  value={elevenLabsVoiceId}
                  onChange={(e) => onElevenLabsVoiceIdChange(e.target.value)}
                  type="text"
                  placeholder="21m00Tcm4TlvDq8ikWAM"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background/60 px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                />
              </label>

              <div className="inline-flex items-start gap-1.5 rounded-md border border-border/60 bg-background/45 p-2 text-[11px] leading-relaxed text-muted-foreground">
                <KeyRound size={12} className="mt-0.5 shrink-0 text-primary/85" />
                {backendSameOrigin
                  ? "Key is sent only to same-origin /api/tts and remains in localStorage."
                  : "This app is using an external backend (NEXT_PUBLIC_API_ORIGIN). Local key is kept, but not forwarded for safety. Configure ElevenLabs key on that backend."}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
