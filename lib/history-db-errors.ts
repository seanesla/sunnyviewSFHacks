import { MongoServerError } from "mongodb"

type HistoryDbErrorInfo = {
  status: number
  message: string
}

function messageText(err: unknown) {
  return err instanceof Error ? err.message : ""
}

export function mapHistoryDbError(err: unknown, fallback: string): HistoryDbErrorInfo {
  const msg = messageText(err).toLowerCase()

  if (
    (err instanceof MongoServerError && err.code === 8000) ||
    msg.includes("authentication failed") ||
    msg.includes("bad auth")
  ) {
    return {
      status: 503,
      message: "History backend authentication failed. Check MongoDB credentials.",
    }
  }

  if (
    msg.includes("server selection timed out") ||
    msg.includes("timed out") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("network")
  ) {
    return {
      status: 503,
      message: "History backend is temporarily unavailable. Please try again.",
    }
  }

  return { status: 500, message: fallback }
}

export function logHistoryDbError(scope: string, err: unknown) {
  if (err instanceof MongoServerError) {
    console.error(`[history] ${scope} mongo error`, {
      code: err.code,
      codeName: err.codeName,
      message: err.message,
    })
    return
  }

  if (err instanceof Error) {
    console.error(`[history] ${scope} error`, { name: err.name, message: err.message })
    return
  }

  console.error(`[history] ${scope} error`, { value: err })
}
