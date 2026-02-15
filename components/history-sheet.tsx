"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Clock3, Loader2, Pin, PinOff, Save, Trash2 } from "lucide-react"
import { gsap } from "gsap"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { getHistoryEntry, listHistory, patchHistory, removeHistory } from "@/lib/history-api"
import type { HistoryListItem, HistorySnapshot } from "@/lib/history-types"
import { cn } from "@/lib/utils"

type HistorySheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLoadSnapshot: (snapshot: HistorySnapshot) => void
  onNotice?: (message: string) => void
}

function formatDateTime(iso: string) {
  const dt = new Date(iso)
  if (!Number.isFinite(dt.getTime())) return "—"
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function HistorySheet({
  open,
  onOpenChange,
  onLoadSnapshot,
  onNotice,
}: HistorySheetProps) {
  const isMobile = useIsMobile() ?? false
  const [tab, setTab] = useState<"recent" | "pinned">("recent")
  const [items, setItems] = useState<HistoryListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftNote, setDraftNote] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await listHistory(100)
      setItems(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void reload()
  }, [open, reload])

  const recentItems = useMemo(
    () => [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [items]
  )
  const pinnedItems = useMemo(() => recentItems.filter((item) => item.pinned), [recentItems])
  const visibleItems = tab === "pinned" ? pinnedItems : recentItems

  useLayoutEffect(() => {
    if (!open || !listRef.current) return
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (reduceMotion) return

    const q = gsap.utils.selector(listRef)
    const rows = q("[data-history-row]")
    if (!rows.length) return

    gsap.fromTo(
      rows,
      { y: 8, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.34,
        ease: "power2.out",
        stagger: 0.045,
      }
    )
  }, [open, tab, visibleItems])

  const startEdit = useCallback((item: HistoryListItem) => {
    setEditId(item.id)
    setDraftTitle(item.title)
    setDraftNote(item.note ?? "")
  }, [])

  const cancelEdit = useCallback(() => {
    setEditId(null)
    setDraftTitle("")
    setDraftNote("")
  }, [])

  const saveEdit = useCallback(
    async (id: string) => {
      setBusyId(id)
      try {
        const next = await patchHistory(id, { title: draftTitle, note: draftNote })
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)))
        cancelEdit()
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to update history entry"
        setError(message)
      } finally {
        setBusyId(null)
      }
    },
    [cancelEdit, draftNote, draftTitle]
  )

  const togglePin = useCallback(async (item: HistoryListItem) => {
    setBusyId(item.id)
    try {
      const next = await patchHistory(item.id, { pinned: !item.pinned })
      setItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, ...next } : entry)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to pin entry")
    } finally {
      setBusyId(null)
    }
  }, [])

  const loadEntry = useCallback(
    async (id: string) => {
      setBusyId(id)
      try {
        const entry = await getHistoryEntry(id)
        onLoadSnapshot(entry.snapshot)
        onNotice?.("Loaded history snapshot.")
        onOpenChange(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load history entry")
      } finally {
        setBusyId(null)
      }
    },
    [onLoadSnapshot, onNotice, onOpenChange]
  )

  const deleteEntry = useCallback(async (item: HistoryListItem) => {
    if (!window.confirm(`Delete history entry \"${item.title}\"?`)) return
    setBusyId(item.id)
    try {
      await removeHistory(item.id)
      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
      if (editId === item.id) {
        setEditId(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete history entry")
    } finally {
      setBusyId(null)
    }
  }, [editId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "z-[65] gap-0 border-border/70 bg-background/92 p-0 backdrop-blur-xl",
          isMobile ? "h-[82vh] rounded-t-2xl" : "h-full w-full sm:max-w-[30rem]"
        )}
      >
        <SheetHeader className="border-b border-border/60 px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Clock3 size={16} className="text-primary" />
            History
          </SheetTitle>
          <SheetDescription>
            Saved address-based sessions. Edit title/notes, pin favorites, and reload previous results.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "recent" | "pinned")} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="recent">Recent</TabsTrigger>
              <TabsTrigger value="pinned">Pinned</TabsTrigger>
            </TabsList>

            <TabsContent value="recent" className="mt-3 min-h-0 flex-1">
              <div className="h-full overflow-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {tab === "recent" ? renderList() : null}
              </div>
            </TabsContent>

            <TabsContent value="pinned" className="mt-3 min-h-0 flex-1">
              <div className="h-full overflow-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {tab === "pinned" ? renderList() : null}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )

  function renderList() {
    if (loading) {
      return (
        <div className="grid place-items-center py-8 text-sm text-muted-foreground">
          <div className="inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading history...
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="glass-card rounded-lg p-3 text-sm text-destructive">
          {error}
          <div className="mt-2">
            <button
              type="button"
              className="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
              onClick={() => void reload()}
            >
              Retry
            </button>
          </div>
        </div>
      )
    }

    if (!visibleItems.length) {
      return (
        <div className="glass-card rounded-lg p-4 text-sm text-muted-foreground">
          {tab === "pinned"
            ? "No pinned history yet. Pin entries from the Recent tab."
            : "No history yet. Start an address session and it will appear here automatically."}
        </div>
      )
    }

    return (
      <div ref={listRef} className="space-y-2">
        {visibleItems.map((item) => {
          const isBusy = busyId === item.id
          const isEditing = editId === item.id

          return (
            <div
              key={item.id}
              data-history-row
              className="glass-card rounded-xl border border-border/65 p-3 transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:border-primary/35 hover:shadow-[0_18px_30px_-24px_rgba(0,0,0,0.96)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Updated {formatDateTime(item.updatedAt)}</div>
                </div>
                {item.pinned ? (
                  <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-foreground">
                    Pinned
                  </span>
                ) : null}
              </div>

              <div className="mt-2 text-[11px] text-muted-foreground">
                {item.summary.address && item.summary.address.length > 0
                  ? item.summary.address
                  : `${item.summary.lat.toFixed(5)}, ${item.summary.lng.toFixed(5)}`}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-md bg-background/55 px-2 py-1 text-muted-foreground">
                  <span className="text-foreground">{item.summary.panelCount}</span> panels
                </div>
                <div className="rounded-md bg-background/55 px-2 py-1 text-muted-foreground">
                  <span className="text-foreground">{item.summary.dcKw.toFixed(1)}</span> kW
                </div>
                <div className="rounded-md bg-background/55 px-2 py-1 text-muted-foreground">
                  <span className="text-foreground">
                    {item.summary.annualKwh !== null ? Math.round(item.summary.annualKwh).toLocaleString() : "—"}
                  </span>{" "}
                  kWh
                </div>
              </div>

              {item.note ? <div className="mt-2 text-[11px] text-muted-foreground">{item.note}</div> : null}

              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void loadEntry(item.id)}
                  className="rounded-md bg-primary/88 px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary disabled:opacity-60"
                >
                  {isBusy ? "Loading..." : "Load"}
                </button>

                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void togglePin(item)}
                  className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary disabled:opacity-60"
                >
                  {item.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  {item.pinned ? "Unpin" : "Pin"}
                </button>

                <button
                  type="button"
                  onClick={() => startEdit(item)}
                  className="rounded-md bg-secondary/80 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary"
                >
                  Edit
                </button>

                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void deleteEntry(item)}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/45 bg-destructive/12 px-2.5 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/18 disabled:opacity-60"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>

              {isEditing ? (
                <div className="mt-3 rounded-lg border border-border/60 bg-background/55 p-2.5">
                  <label className="block text-[11px] text-muted-foreground">
                    Title
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background/70 px-2.5 text-xs text-foreground"
                      maxLength={80}
                    />
                  </label>

                  <label className="mt-2 block text-[11px] text-muted-foreground">
                    Note
                    <textarea
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      rows={3}
                      className="mt-1 w-full resize-none rounded-md border border-input bg-background/70 px-2.5 py-2 text-xs text-foreground"
                      maxLength={500}
                    />
                  </label>

                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void saveEdit(item.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/88 px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary disabled:opacity-60"
                    >
                      <Save size={12} />
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={cancelEdit}
                      className="rounded-md bg-secondary/80 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }
}
