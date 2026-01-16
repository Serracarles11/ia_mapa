import { NextResponse } from "next/server"

type FlightRadarRequest = {
  center?: { lat?: number; lon?: number }
  radius_m?: number
}

type FlightState = {
  id: string
  callsign: string | null
  origin_country: string | null
  lat: number
  lon: number
  altitude_m: number | null
  velocity_mps: number | null
  heading_deg: number | null
  on_ground: boolean
  last_contact: number | null
}

type FlightRadarResponse = {
  ok: boolean
  source?: string
  time?: number | null
  center?: { lat: number; lon: number }
  radius_m?: number
  flights?: FlightState[]
  error?: string
}

const DEFAULT_ENDPOINT = "https://opensky-network.org/api/states/all"
const CACHE_TTL_MS = 1000 * 15
const cache = new Map<
  string,
  { expiresAt: number; payload: FlightRadarResponse }
>()

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as FlightRadarRequest
  const lat = body.center?.lat
  const lon = body.center?.lon
  const radius =
    typeof body.radius_m === "number" && body.radius_m > 0
      ? Math.round(body.radius_m)
      : 1200

  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json(
      { ok: false, error: "Missing lat/lon" },
      { status: 400 }
    )
  }

  const flightRadius = Math.min(Math.max(radius * 4, 25000), 120000)
  const bbox = buildBoundingBox(lat, lon, flightRadius)
  const cacheKey = `${bbox.minLat.toFixed(2)}:${bbox.minLon.toFixed(2)}:${bbox.maxLat.toFixed(2)}:${bbox.maxLon.toFixed(2)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload)
  }

  try {
    const endpoint = process.env.OPEN_SKY_ENDPOINT || DEFAULT_ENDPOINT
    const url = new URL(endpoint)
    url.searchParams.set("lamin", bbox.minLat.toFixed(4))
    url.searchParams.set("lomin", bbox.minLon.toFixed(4))
    url.searchParams.set("lamax", bbox.maxLat.toFixed(4))
    url.searchParams.set("lomax", bbox.maxLon.toFixed(4))

    const headers: Record<string, string> = {
      "User-Agent": "ia-maps-app/1.0 (local)",
    }
    const username = process.env.OPEN_SKY_USERNAME
    const password = process.env.OPEN_SKY_PASSWORD
    if (username && password) {
      headers.Authorization =
        "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
    }

    const res = await fetch(url.toString(), { headers, cache: "no-store" })
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(errorText || "OpenSky error")
    }

    const data = (await res.json()) as {
      time?: number
      states?: unknown[]
    }

    const flights = normalizeFlights(data.states ?? [])
    const payload: FlightRadarResponse = {
      ok: true,
      source: "OpenSky",
      time: typeof data.time === "number" ? data.time : null,
      center: { lat, lon },
      radius_m: flightRadius,
      flights,
    }

    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    })

    return NextResponse.json(payload)
  } catch {
    const payload: FlightRadarResponse = {
      ok: false,
      error: "No se pudo consultar el radar de vuelos.",
    }
    return NextResponse.json(payload, { status: 502 })
  }
}

function normalizeFlights(states: unknown[]): FlightState[] {
  if (!Array.isArray(states)) return []
  const flights: FlightState[] = []

  for (const item of states) {
    if (!Array.isArray(item)) continue
    const lat = toNumber(item[6])
    const lon = toNumber(item[5])
    if (lat == null || lon == null) continue

    const id = typeof item[0] === "string" ? item[0] : "unknown"
    const callsign =
      typeof item[1] === "string" ? item[1].trim() || null : null
    const origin =
      typeof item[2] === "string" ? item[2].trim() || null : null
    const altitude =
      toNumber(item[7]) ?? (toNumber(item[13]) != null ? toNumber(item[13]) : null)
    const velocity = toNumber(item[9])
    const heading = toNumber(item[10])
    const onGround = Boolean(item[8])
    const lastContact = toNumber(item[4])

    flights.push({
      id,
      callsign,
      origin_country: origin,
      lat,
      lon,
      altitude_m: altitude,
      velocity_mps: velocity,
      heading_deg: heading,
      on_ground: onGround,
      last_contact: lastContact,
    })
  }

  return flights
}

function toNumber(value: unknown): number | null {
  if (typeof value !== "number") return null
  return Number.isFinite(value) ? value : null
}

function buildBoundingBox(lat: number, lon: number, radius_m: number) {
  const deltaLat = radius_m / 111_320
  const deltaLon = radius_m / (111_320 * Math.cos((lat * Math.PI) / 180))

  return {
    minLat: clamp(lat - deltaLat, -90, 90),
    maxLat: clamp(lat + deltaLat, -90, 90),
    minLon: clamp(lon - deltaLon, -180, 180),
    maxLon: clamp(lon + deltaLon, -180, 180),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
