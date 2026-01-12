import "server-only"

import { forwardGeocode } from "@/lib/osm/nominatim"

export type BuscarCoordenadasResult = {
  lat: number
  lon: number
  display_name: string
  confidence?: number
}

export async function buscarCoordenadas(
  direccion: string
): Promise<BuscarCoordenadasResult | null> {
  const trimmed = direccion.trim()
  if (!trimmed) return null

  const result = await forwardGeocode(trimmed)
  if (!result) return null

  return {
    lat: result.lat,
    lon: result.lon,
    display_name: result.display_name,
    confidence: result.importance ?? undefined,
  }
}
