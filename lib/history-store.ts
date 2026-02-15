import { createHash } from "crypto"

import { Collection, Db, ObjectId, WithId } from "mongodb"

import type {
  HistoryEntry,
  HistoryListItem,
  HistoryMetadataPatch,
  HistorySaveInput,
  HistorySnapshot,
  HistorySummary,
} from "@/lib/history-types"

const COLLECTION_NAME = "history_entries"
const DEFAULT_RETENTION_MAX = 100
const HARD_RETENTION_MAX = 300
const MAX_TITLE_LEN = 80
const MAX_NOTE_LEN = 500

type HistoryDocFields = {
  visitorId: string
  queryHash: string
  title: string
  note: string | null
  pinned: boolean
  summary: HistorySummary
  snapshot: HistorySnapshot
  createdAt: Date
  updatedAt: Date
}

type StoredHistoryDoc = WithId<HistoryDocFields>

let indexInitPromise: Promise<void> | null = null

function historyCollection(db: Db): Collection<HistoryDocFields> {
  return db.collection<HistoryDocFields>(COLLECTION_NAME)
}

function parseRetentionMax() {
  const raw = Number(process.env.HISTORY_RETENTION_MAX ?? "")
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RETENTION_MAX
  return Math.max(1, Math.min(HARD_RETENTION_MAX, Math.round(raw)))
}

function normalizeTitle(input: string | undefined, snapshot: HistorySnapshot) {
  const trimmed = (input ?? "").trim().slice(0, MAX_TITLE_LEN)
  if (trimmed.length > 0) return trimmed

  if (snapshot.address && snapshot.address.trim().length > 0) {
    return snapshot.address.trim().slice(0, MAX_TITLE_LEN)
  }

  return `${snapshot.lat.toFixed(5)}, ${snapshot.lng.toFixed(5)}`
}

function normalizeNote(input: string | undefined) {
  if (input === undefined) return undefined
  const trimmed = input.trim().slice(0, MAX_NOTE_LEN)
  return trimmed.length > 0 ? trimmed : null
}

function round(value: number, digits: number) {
  const m = 10 ** digits
  return Math.round(value * m) / m
}

function hashableSnapshot(snapshot: HistorySnapshot) {
  return {
    mode: snapshot.mode,
    address: snapshot.address?.trim().toLowerCase() ?? null,
    lat: round(snapshot.lat, 6),
    lng: round(snapshot.lng, 6),
    zoom: Math.round(snapshot.zoom),
    siteSpec: {
      tiltDeg: round(snapshot.siteSpec.tiltDeg, 2),
      azimuthDeg: round(snapshot.siteSpec.azimuthDeg, 2),
      lossesPct: round(snapshot.siteSpec.lossesPct, 2),
    },
    panelSpec: {
      widthM: round(snapshot.panelSpec.widthM, 3),
      heightM: round(snapshot.panelSpec.heightM, 3),
      wattW: round(snapshot.panelSpec.wattW, 2),
      gapM: round(snapshot.panelSpec.gapM, 3),
    },
    layoutSummary: {
      orientationDeg: round(snapshot.layoutSummary.orientationDeg, 2),
      panelCount: Math.round(snapshot.layoutSummary.panelCount),
      dcKw: round(snapshot.layoutSummary.dcKw, 3),
    },
    geometry: {
      closed: snapshot.geometry.closed,
      vertices: snapshot.geometry.vertices.map((p) => [round(p.x, 1), round(p.y, 1)]),
    },
  }
}

export function buildHistoryQueryHash(snapshot: HistorySnapshot) {
  return createHash("sha1").update(JSON.stringify(hashableSnapshot(snapshot))).digest("hex")
}

function toListItem(doc: StoredHistoryDoc): HistoryListItem {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    note: doc.note,
    pinned: doc.pinned,
    queryHash: doc.queryHash,
    summary: doc.summary,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

function toEntry(doc: StoredHistoryDoc): HistoryEntry {
  return {
    ...toListItem(doc),
    snapshot: doc.snapshot,
  }
}

function toObjectId(id: string) {
  if (!ObjectId.isValid(id)) return null
  return new ObjectId(id)
}

export async function ensureHistoryIndexes(db: Db) {
  if (indexInitPromise) return indexInitPromise

  const coll = historyCollection(db)
  indexInitPromise = (async () => {
    await coll.createIndex({ visitorId: 1, updatedAt: -1 })
    await coll.createIndex({ visitorId: 1, queryHash: 1 }, { unique: true })
  })().catch((err) => {
    indexInitPromise = null
    throw err
  })

  return indexInitPromise
}

async function enforceRetention(coll: Collection<HistoryDocFields>, visitorId: string) {
  const retention = parseRetentionMax()
  const stale = await coll
    .find({ visitorId })
    .sort({ updatedAt: -1 })
    .skip(retention)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray()

  if (!stale.length) return
  const staleIds = stale.map((doc) => doc._id)
  await coll.deleteMany({ _id: { $in: staleIds } })
}

export async function listHistoryEntries(opts: { db: Db; visitorId: string; limit: number }) {
  await ensureHistoryIndexes(opts.db)
  const coll = historyCollection(opts.db)
  const retention = parseRetentionMax()
  const limit = Math.max(1, Math.min(retention, Math.round(opts.limit)))

  const docs = await coll
    .find({ visitorId: opts.visitorId })
    .sort({ pinned: -1, updatedAt: -1 })
    .limit(limit)
    .toArray()

  return docs.map(toListItem)
}

export async function getHistoryEntry(opts: { db: Db; visitorId: string; id: string }) {
  await ensureHistoryIndexes(opts.db)
  const coll = historyCollection(opts.db)
  const objectId = toObjectId(opts.id)
  if (!objectId) return null

  const doc = await coll.findOne({ _id: objectId, visitorId: opts.visitorId })
  return doc ? toEntry(doc) : null
}

export async function upsertHistoryEntry(opts: {
  db: Db
  visitorId: string
  input: HistorySaveInput
}) {
  await ensureHistoryIndexes(opts.db)
  const coll = historyCollection(opts.db)
  const now = new Date()

  const queryHash = buildHistoryQueryHash(opts.input.snapshot)
  const existing = await coll.findOne({ visitorId: opts.visitorId, queryHash })

  if (existing) {
    const title = opts.input.title !== undefined ? normalizeTitle(opts.input.title, opts.input.snapshot) : existing.title
    const note = opts.input.note !== undefined ? normalizeNote(opts.input.note) ?? null : existing.note
    const pinned = typeof opts.input.pinned === "boolean" ? opts.input.pinned : existing.pinned

    await coll.updateOne(
      { _id: existing._id },
      {
        $set: {
          title,
          note,
          pinned,
          summary: opts.input.summary,
          snapshot: opts.input.snapshot,
          updatedAt: now,
        },
      }
    )

    const updated = await coll.findOne({ _id: existing._id })
    if (!updated) throw new Error("History update failed")
    await enforceRetention(coll, opts.visitorId)
    return toEntry(updated)
  }

  const title = normalizeTitle(opts.input.title, opts.input.snapshot)
  const note = normalizeNote(opts.input.note) ?? null
  const pinned = Boolean(opts.input.pinned)

  const insertResult = await coll.insertOne({
    visitorId: opts.visitorId,
    queryHash,
    title,
    note,
    pinned,
    summary: opts.input.summary,
    snapshot: opts.input.snapshot,
    createdAt: now,
    updatedAt: now,
  })

  const inserted = await coll.findOne({ _id: insertResult.insertedId })
  if (!inserted) throw new Error("History insert failed")

  await enforceRetention(coll, opts.visitorId)
  return toEntry(inserted)
}

export async function patchHistoryMetadata(opts: {
  db: Db
  visitorId: string
  id: string
  patch: HistoryMetadataPatch
}) {
  await ensureHistoryIndexes(opts.db)
  const coll = historyCollection(opts.db)
  const objectId = toObjectId(opts.id)
  if (!objectId) return null

  const existing = await coll.findOne({ _id: objectId, visitorId: opts.visitorId })
  if (!existing) return null

  const title = opts.patch.title !== undefined ? normalizeTitle(opts.patch.title, existing.snapshot) : existing.title
  const note = opts.patch.note !== undefined ? normalizeNote(opts.patch.note) ?? null : existing.note
  const pinned = typeof opts.patch.pinned === "boolean" ? opts.patch.pinned : existing.pinned

  await coll.updateOne(
    { _id: objectId, visitorId: opts.visitorId },
    { $set: { title, note, pinned, updatedAt: new Date() } }
  )

  const updated = await coll.findOne({ _id: objectId, visitorId: opts.visitorId })
  return updated ? toListItem(updated) : null
}

export async function deleteHistoryEntry(opts: { db: Db; visitorId: string; id: string }) {
  await ensureHistoryIndexes(opts.db)
  const coll = historyCollection(opts.db)
  const objectId = toObjectId(opts.id)
  if (!objectId) return false

  const res = await coll.deleteOne({ _id: objectId, visitorId: opts.visitorId })
  return res.deletedCount > 0
}
