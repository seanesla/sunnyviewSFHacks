import type {
  HistoryEntry,
  HistoryListItem,
  HistoryMetadataPatch,
  HistorySaveInput,
} from "@/lib/history-types"

async function parseJsonSafe<T>(res: Response) {
  return (await res.json().catch(() => null)) as T | null
}

function responseError(data: unknown, fallback: string) {
  const msg =
    data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : fallback
  return new Error(msg)
}

export async function listHistory(limit = 100): Promise<HistoryListItem[]> {
  const res = await fetch(`/api/history?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: { accept: "application/json" },
  })
  const data = await parseJsonSafe<{ items?: HistoryListItem[]; error?: string }>(res)
  if (!res.ok) throw responseError(data, "Failed to list history")
  return Array.isArray(data?.items) ? data.items : []
}

export async function saveHistory(input: HistorySaveInput): Promise<HistoryEntry> {
  const res = await fetch("/api/history", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  })
  const data = await parseJsonSafe<{ item?: HistoryEntry; error?: string }>(res)
  if (!res.ok || !data?.item) throw responseError(data, "Failed to save history")
  return data.item
}

export async function getHistoryEntry(id: string): Promise<HistoryEntry> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { accept: "application/json" },
  })
  const data = await parseJsonSafe<{ item?: HistoryEntry; error?: string }>(res)
  if (!res.ok || !data?.item) throw responseError(data, "Failed to load history entry")
  return data.item
}

export async function patchHistory(id: string, patch: HistoryMetadataPatch): Promise<HistoryListItem> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(patch),
  })
  const data = await parseJsonSafe<{ item?: HistoryListItem; error?: string }>(res)
  if (!res.ok || !data?.item) throw responseError(data, "Failed to update history entry")
  return data.item
}

export async function removeHistory(id: string): Promise<void> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { accept: "application/json" },
  })
  if (!res.ok) {
    const data = await parseJsonSafe<{ error?: string }>(res)
    throw responseError(data, "Failed to delete history entry")
  }
}
