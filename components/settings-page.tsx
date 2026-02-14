"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { AccentColorControl } from "@/components/accent-color-control";
import { BackgroundScene } from "@/components/BackgroundScene";
import { useAccent } from "@/lib/accent-context";
import { useBackground } from "@/lib/background-context";
import { useUiStyle } from "@/lib/ui-style-context";
import { cn } from "@/lib/utils";

function AccentLivePreview() {
  const { hue, saturation } = useAccent();

  return (
    <div className="mt-3 flex items-center gap-3">
      <div
        className="h-14 w-14 rounded-full border border-foreground/20 shadow-[0_0_30px_-6px_rgba(0,0,0,0.65)]"
        style={{ background: `oklch(0.72 ${saturation} ${hue})` }}
      />
      <div>
        <div className="text-sm font-semibold text-foreground">App Accent</div>
        <div className="text-xs text-muted-foreground">{`oklch(0.72 ${saturation.toFixed(2)} ${Math.round(hue)})`}</div>
      </div>
    </div>
  );
}

const AURORA_GRID_BACKGROUND = {
  label: "Adaptive Fusion/Grid",
  description: "Landing uses Fusion, then dashboard transitions to Dark Grid.",
};

const SOFT_EASE: [number, number, number, number] = [0.2, 0.9, 0.24, 1];
const FADE_EASE: [number, number, number, number] = [0.33, 1, 0.68, 1];

interface SettingsPageProps {
  embedded?: boolean;
  onClose?: () => void;
}

export function SettingsPage({ embedded = false, onClose }: SettingsPageProps) {
  const prefersReducedMotion = useReducedMotion();
  const {
    motion: backgroundMotion,
    intensity,
    spotlight,
    setMotion,
    setIntensity,
    setSpotlight,
  } = useBackground();
  const {
    presetId,
    styleMode,
    activePreset,
    presets,
    selectPreset,
    markCustom,
    resetVisualStyle,
  } = useUiStyle();
  const activeBackground = AURORA_GRID_BACKGROUND;

  const backButton =
    embedded && onClose ? (
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/35 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition hover:bg-background/55"
      >
        <ArrowLeft size={14} />
        Back to app
      </button>
    ) : (
      <Link
        href="/?view=app"
        className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/35 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition hover:bg-background/55"
      >
        <ArrowLeft size={14} />
        Back to app
      </Link>
    );

  const doneButton =
    embedded && onClose ? (
      <button
        type="button"
        onClick={onClose}
        className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
      >
        Done
      </button>
    ) : (
      <Link
        href="/?view=app"
        className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
      >
        Done
      </Link>
    );

  const content = (
    <div
      className={cn(
        "relative z-10 mx-auto flex w-full max-w-4xl flex-col px-5 sm:px-6 lg:px-8",
        embedded ? "py-4" : "min-h-screen py-8 sm:py-10",
      )}
    >
      <motion.header
        className="mb-6 flex items-center justify-between gap-3"
        initial={
          prefersReducedMotion
            ? { opacity: 0 }
            : { opacity: 0, y: -10, filter: "blur(4px)" }
        }
        animate={
          prefersReducedMotion
            ? { opacity: 1 }
            : { opacity: 1, y: 0, filter: "blur(0px)" }
        }
        transition={
          prefersReducedMotion
            ? { duration: 0.14 }
            : {
                opacity: { duration: 0.2, ease: FADE_EASE },
                y: { duration: 0.32, ease: SOFT_EASE },
                filter: { duration: 0.2, ease: FADE_EASE },
              }
        }
      >
        {backButton}
        <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Settings
        </div>
      </motion.header>

      <motion.main
        className={cn(
          "glass-card gradient-border rounded-2xl p-6 sm:p-8",
          embedded && "max-h-[calc(100vh-8.5rem)] overflow-auto",
        )}
        initial={
          prefersReducedMotion
            ? { opacity: 0 }
            : { opacity: 0, y: 14, filter: "blur(8px)" }
        }
        animate={
          prefersReducedMotion
            ? { opacity: 1 }
            : { opacity: 1, y: 0, filter: "blur(0px)" }
        }
        transition={
          prefersReducedMotion
            ? { duration: 0.14 }
            : {
                delay: 0.01,
                opacity: { duration: 0.2, ease: FADE_EASE },
                y: { duration: 0.32, ease: SOFT_EASE },
                filter: { duration: 0.18, ease: FADE_EASE },
              }
        }
      >
        <div className="flex items-center gap-2 text-primary">
          <Palette size={16} />
          <span className="text-xs font-semibold tracking-[0.18em] uppercase">
            Visual style
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Add a polished finish
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Pick a preset, then fine-tune accent and background controls. This
          keeps your current UI while adding a stronger cosmetic touch.
        </p>

        <section className="mt-8 border-t border-border/70 pt-6">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles size={16} />
            <span className="text-xs font-semibold tracking-[0.18em] uppercase">
              Presets
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {presets.map((preset) => {
              const selected = preset.id === presetId;
              const active = selected && styleMode === "preset";
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectPreset(preset.id)}
                  className={cn(
                    "rounded-lg border bg-background/35 px-3 py-3 text-left transition",
                    selected
                      ? "border-primary/70 bg-primary/12"
                      : "border-border/70 hover:bg-background/55",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-foreground">
                      {preset.label}
                    </div>
                    {active ? <Check size={14} className="text-primary" /> : null}
                  </div>
                  <div
                    className="mt-2 h-8 rounded-md border border-white/10"
                    style={{ background: preset.previewGradient }}
                  />
                  <div className="mt-2 text-xs text-muted-foreground">
                    {preset.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {styleMode === "custom"
              ? `Custom mode active (based on ${activePreset.label}).`
              : `${activePreset.label} preset active.`}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-center gap-2 text-primary">
            <Palette size={16} />
            <span className="text-xs font-semibold tracking-[0.18em] uppercase">
              Accent
            </span>
          </div>

          <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
            <AccentColorControl
              className="rounded-xl border border-border/80 bg-background/35 p-4"
              onAccentChange={markCustom}
            />

            <aside className="rounded-xl border border-border/80 bg-background/35 p-4">
              <div className="text-xs text-muted-foreground">Live preview</div>
              <AccentLivePreview />

              <div className="mt-4 rounded-lg border border-border/80 bg-card/60 p-3">
                <div className="text-xs text-muted-foreground">Sample button</div>
                <button
                  type="button"
                  className="mt-2 w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                >
                  Primary Action
                </button>
              </div>

              <div className="mt-4 rounded-lg border border-border/80 bg-card/60 p-3">
                <div className="text-xs text-muted-foreground">Style mode</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {styleMode === "custom" ? "Custom" : activePreset.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {styleMode === "custom"
                    ? `Tweaked from ${activePreset.label}`
                    : activePreset.description}
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-border/80 bg-card/60 p-3">
                <div className="text-xs text-muted-foreground">Background</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {activeBackground.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {activeBackground.description}
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-8 border-t border-border/70 pt-6">
          <div className="flex items-center gap-2 text-primary">
            <SlidersHorizontal size={16} />
            <span className="text-xs font-semibold tracking-[0.18em] uppercase">
              Background
            </span>
          </div>

          <div className="mt-4 rounded-lg border border-primary/70 bg-primary/12 px-3 py-3">
            <div className="text-sm font-semibold text-foreground">
              {AURORA_GRID_BACKGROUND.label}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {AURORA_GRID_BACKGROUND.description}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Automatic transition: Fusion on landing, Grid in dashboard.
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Motion speed</span>
                <span className="text-foreground">
                  {backgroundMotion.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.5}
                step={0.05}
                value={backgroundMotion}
                onChange={(event) => {
                  markCustom();
                  setMotion(Number(event.target.value));
                }}
                className="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full outline-none"
                style={{
                  background:
                    "linear-gradient(to right, oklch(0.3 0.03 var(--accent-hue)), oklch(0.76 var(--accent-sat) var(--accent-hue)))",
                }}
              />
            </label>

            <label className="block space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Glow intensity</span>
                <span className="text-foreground">{intensity.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.65}
                max={1.35}
                step={0.05}
                value={intensity}
                onChange={(event) => {
                  markCustom();
                  setIntensity(Number(event.target.value));
                }}
                className="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full outline-none"
                style={{
                  background:
                    "linear-gradient(to right, oklch(0.28 0.01 var(--accent-hue)), oklch(0.86 calc(var(--accent-sat) * 1.1) var(--accent-hue)))",
                }}
              />
            </label>
          </div>

          <label className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={spotlight}
              onChange={(event) => {
                markCustom();
                setSpotlight(event.target.checked);
              }}
              className="h-4 w-4 rounded border-border bg-background"
            />
            Enable cursor spotlight overlay
          </label>
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Saved automatically for future visits.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetVisualStyle}
              className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/35 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-background/55"
            >
              <RotateCcw size={14} />
              Reset to Classic
            </button>
            {doneButton}
          </div>
        </div>
      </motion.main>
    </div>
  );

  return embedded ? (
    content
  ) : (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <BackgroundScene />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,20,0.10)_0%,rgba(3,8,20,0.14)_42%,rgba(3,8,20,0.28)_100%)]" />
      {content}
    </div>
  );
}
