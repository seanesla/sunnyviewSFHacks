export function apiOrigin() {
  return (process.env.NEXT_PUBLIC_API_ORIGIN ?? "").trim().replace(/\/$/, "")
}

export function apiUrl(pathname: string) {
  const base = apiOrigin()
  if (!pathname.startsWith("/")) return `${base}/${pathname}`
  return `${base}${pathname}`
}

