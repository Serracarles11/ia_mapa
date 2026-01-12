import "server-only"

import {
  fetchOverpassPoisByTags,
  type OverpassTaggedPoi,
} from "@/lib/osm/overpass"

export type BuscarPOIsPorCategoriaResult = {
  ok: boolean
  tags: string[]
  center: { lat: number; lon: number }
  radius_m: number
  pois: Array<{
    name: string
    lat: number
    lon: number
    distance_m: number
    type: string | null
    tags: Record<string, string>
  }>
  error?: string
}

export async function buscarPOIsPorCategoria(
  lat: number,
  lon: number,
  radius_m: number,
  tags: string[]
): Promise<BuscarPOIsPorCategoriaResult> {
  const cleanTags = Array.isArray(tags)
    ? tags.map((tag) => String(tag).trim()).filter(Boolean)
    : []

  if (cleanTags.length === 0) {
    return {
      ok: false,
      tags: [],
      center: { lat, lon },
      radius_m,
      pois: [],
      error: "Sin tags para consultar.",
    }
  }

  try {
    const raw = await fetchOverpassPoisByTags(lat, lon, radius_m, cleanTags)
    const pois = normalizeTaggedPois(lat, lon, radius_m, raw)
    return {
      ok: true,
      tags: cleanTags,
      center: { lat, lon },
      radius_m,
      pois,
    }
  } catch {
    return {
      ok: false,
      tags: cleanTags,
      center: { lat, lon },
      radius_m,
      pois: [],
      error: "Overpass no disponible",
    }
  }
}

function normalizeTaggedPois(
  lat: number,
  lon: number,
  radius_m: number,
  items: OverpassTaggedPoi[]
) {
  return items
    .map((item) => {
      const distance = Math.round(distanceMeters(lat, lon, item.lat, item.lon))
      return { ...item, distance_m: distance }
    })
    .filter((item) => item.distance_m <= radius_m)
    .sort((a, b) => a.distance_m - b.distance_m)
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
