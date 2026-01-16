import "server-only"

import { type EarthquakeEvent } from "@/lib/types"

const DEFAULT_FEED_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
const CACHE_TTL_MS = 1000 * 60 * 2

type RawEvent = {
  id: string
  magnitude: number | null
  place: string | null
  title: string | null
  time_iso: string | null
  url: string | null
  coordinates: { lat: number; lon: number; depth_km: number | null }
}

const cache = new Map<string, { expiresAt: number; value: RawEvent[] | null }>()

export async function fetchEarthquakesNearby(
  lat: number,
  lon: number,
  radius_m: number,
  limit = 12
): Promise<EarthquakeEvent[] | null> {
  const feedUrl = process.env.USGS_EARTHQUAKE_FEED_URL || DEFAULT_FEED_URL
  const raw = await fetchFeed(feedUrl)
  if (!raw) return null

  const radius = Math.max(0, Math.min(radius_m, 500000))
  const within = raw
    .map((event) => {
      const distance = Math.round(
        distanceMeters(lat, lon, event.coordinates.lat, event.coordinates.lon)
      )
      return { ...event, distance_m: distance }
    })
    .filter((event) => radius === 0 || event.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, Math.min(Math.max(limit, 1), 30))
    .map((event) => ({
      id: event.id,
      magnitude: event.magnitude,
      place: event.place,
      title: event.title,
      time_iso: event.time_iso,
      url: event.url,
      distance_m: event.distance_m,
      coordinates: {
        lat: event.coordinates.lat,
        lon: event.coordinates.lon,
        depth_km: event.coordinates.depth_km,
      },
    }))

  return within
}

async function fetchFeed(feedUrl: string): Promise<RawEvent[] | null> {
  const cached = cache.get(feedUrl)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  try {
    const res = await fetch(feedUrl, { cache: "no-store" })
    if (!res.ok) {
      cache.set(feedUrl, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value: null,
      })
      return null
    }

    const data = (await res.json()) as {
      features?: Array<{
        id?: string
        properties?: Record<string, unknown>
        geometry?: { coordinates?: [number, number, number?] }
      }>
    }

    const features = Array.isArray(data.features) ? data.features : []
    const events = features
      .map((feature) => normalizeFeature(feature))
      .filter((item): item is RawEvent => Boolean(item))

    cache.set(feedUrl, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: events,
    })
    return events
  } catch {
    cache.set(feedUrl, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: null,
    })
    return null
  }
}

function normalizeFeature(feature: {
  id?: string
  properties?: Record<string, unknown>
  geometry?: { coordinates?: [number, number, number?] }
}) {
  const id = typeof feature.id === "string" ? feature.id : null
  const props = feature.properties ?? {}
  const coords = feature.geometry?.coordinates
  if (!id || !Array.isArray(coords) || coords.length < 2) return null

  const lon = toNumber(coords[0])
  const lat = toNumber(coords[1])
  if (lat == null || lon == null) return null
  const depth = coords.length > 2 ? toNumber(coords[2]) : null

  const timeValue = toNumber(props.time)
  const time_iso =
    typeof timeValue === "number"
      ? new Date(timeValue).toISOString()
      : null

  return {
    id,
    magnitude: toNumber(props.mag),
    place: typeof props.place === "string" ? props.place : null,
    title: typeof props.title === "string" ? props.title : null,
    time_iso,
    url: typeof props.url === "string" ? props.url : null,
    coordinates: {
      lat,
      lon,
      depth_km: depth,
    },
  }
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}
