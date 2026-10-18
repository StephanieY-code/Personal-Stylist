// Shared helpers for talking to the FastAPI backend (see ../../main.py).

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "")

export type Status = {
  kind: "idle" | "loading" | "success" | "error"
  message: string
}

export const initialStatus: Status = { kind: "idle", message: "" }

export type ClosetItem = {
  id: string
  category: string
  color: string
  description: string
  imageUrl: string | null
}

export type Weather = {
  city: string
  region: string
  country: string
  temperatureC: number
  rain: boolean
  chanceOfRain: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload) || !("detail" in payload)) return fallback

  const { detail } = payload
  if (typeof detail === "string") return detail
  // FastAPI input validation errors arrive as a list of { msg }.
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) =>
      isRecord(item) && typeof item.msg === "string" ? [item.msg] : [],
    )
    if (messages.length) return messages.join(" ")
  }
  if (isRecord(detail)) {
    const messages = [
      typeof detail.message === "string" ? detail.message : "",
      ...(Array.isArray(detail.skipped)
        ? detail.skipped.flatMap((item) =>
            isRecord(item) && typeof item.error === "string"
              ? [item.error]
              : [],
          )
        : []),
    ].filter(Boolean)
    if (messages.length) return messages.join(" ")
  }

  return fallback
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new Error("Can't reach your stylist. Make sure the backend is running (./start.sh).")
  }
  let payload: unknown

  try {
    payload = await response.json()
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new Error(
      response.ok
        ? "The backend returned an invalid response."
        : `The backend request failed (${response.status}). Make sure it is running (./start.sh).`,
    )
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, `Request failed (${response.status}).`))
  }

  return payload as T
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** Turn a backend path such as /api/images/top_01.jpg into a URL on the API's host. */
export function mediaUrl(path: string) {
  return new URL(path, new URL(API_BASE, window.location.href)).href
}
