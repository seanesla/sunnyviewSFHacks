"use client"

import { useSyncExternalStore } from "react"

function subscribe(onStoreChange: () => void): () => void {
  if (typeof document === "undefined") return () => {}

  const root = document.documentElement
  const observer = new MutationObserver(() => {
    onStoreChange()
  })

  observer.observe(root, {
    attributes: true,
    attributeFilter: ["data-accent-dragging"],
  })

  window.addEventListener("blur", onStoreChange)
  return () => {
    window.removeEventListener("blur", onStoreChange)
    observer.disconnect()
  }
}

function getSnapshot(): boolean {
  if (typeof document === "undefined") return false
  return document.documentElement.dataset.accentDragging === "true"
}

function getServerSnapshot(): boolean {
  return false
}

export function useAccentDragging(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
