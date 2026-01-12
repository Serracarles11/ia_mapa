import { NextResponse } from "next/server"

import { reverseGeocode } from "@/lib/osm/nominatim"
import { fetchOverpassPois, type OverpassPoi } from "@/lib/osm/overpass"
import { capasUrbanismo } from "@/lib/tools/capasUrbanismo"
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion"
import { buildFallbackReport } from "@/lib/report/buildFallbackReport"
import { runAgent } from "@/lib/agent/runAgent"
import {
  type AiReport,
  type ContextData,
  type FloodRiskInfo,
  type LandCoverInfo,
  type PoiItem,
  type PoisByCategory,
} from "@/lib/types"

type AnalyzeRequest = {
  center?: { lat?: number; lon?: number }
  radius_m?: number
  request_id?: number
}

type AnalyzeStatus = "OK" | "NO_POIS" | "OVERPASS_DOWN"
type FloodStatus = "OK" | "DOWN"

type AnalyzeResponse = {
  ok: boolean
  request_id: number | null
  placeName: string | null
  contextData: ContextData | null
  overpass_ok: boolean
  overpass_error: string | null
  flood_ok: boolean
  flood_error: string | null
  flood_status: FloodStatus
  status: AnalyzeStatus
  aiReport: AiReport | null
  fallbackReport: AiReport | null
  warnings: string[]
  warning?: string | null
  error?: string
}

const CACHE_TTL_MS = 1000 * 60 * 8
const cache = new Map<
  string,
  { expiresAt: number; payload: AnalyzeResponse }
>()

let lastGoodContext: ContextData | null = null
let lastGoodReport: AiReport | null = null
let lastGoodPlaceName: string | null = null

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AnalyzeRequest

  const lat = body.center?.lat
  const lon = body.center?.lon
  const radius =
    typeof body.radius_m === "number" && body.radius_m > 0
      ? Math.round(body.radius_m)
      : 1200
  const requestId =
    typeof body.request_id === "number" ? body.request_id : null

  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json(
      { ok: false, error: "Missing lat/lon" },
      { status: 400 }
    )
  }

  const cacheKey = `${lat.toFixed(6)}:${lon.toFixed(6)}:${radius}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({
      ...cached.payload,
      request_id: requestId,
    })
  }

  const warnings: string[] = []
  let placeName: string | null = null
  let overpassOk = false
  let overpassError: string | null = null

  try {
    const reverse = await reverseGeocode(lat, lon).catch(() => null)
    placeName = reverse?.display_name ?? reverse?.name ?? null
  } catch {
    placeName = null
  }

  let overpassPois: OverpassPoi[] = []
  try {
    overpassPois = await fetchOverpassPois(lat, lon, radius)
    overpassOk = true
  } catch (error) {
    overpassOk = false
    overpassError = "Overpass no disponible"
    warnings.push(overpassError)
    if (process.env.NODE_ENV === "development") {
      console.error("Overpass error", error)
    }
  }

  if (!overpassOk) {
    if (lastGoodContext && lastGoodReport) {
      const floodMeta = buildFloodMeta(lastGoodContext.flood_risk)
      const payload: AnalyzeResponse = {
        ok: true,
        request_id: requestId,
        placeName: lastGoodPlaceName,
        contextData: lastGoodContext,
        overpass_ok: false,
        overpass_error: overpassError,
        flood_ok: floodMeta.flood_ok,
        flood_error: floodMeta.flood_error,
        flood_status: floodMeta.flood_status,
        status: "OVERPASS_DOWN",
        aiReport: null,
        fallbackReport: lastGoodReport,
        warnings,
        warning: warnings[0] ?? null,
      }
      return NextResponse.json(payload)
    }

    const { contextData, report } = await buildMinimalContextAndReport(
      lat,
      lon,
      radius,
      placeName,
      warnings
    )
    const floodMeta = buildFloodMeta(contextData.flood_risk)

    const payload: AnalyzeResponse = {
      ok: true,
      request_id: requestId,
      placeName,
      contextData,
      overpass_ok: false,
      overpass_error: overpassError,
      flood_ok: floodMeta.flood_ok,
      flood_error: floodMeta.flood_error,
      flood_status: floodMeta.flood_status,
      status: "OVERPASS_DOWN",
      aiReport: null,
      fallbackReport: report,
      warnings,
      warning: warnings[0] ?? null,
    }

    return NextResponse.json(payload)
  }

  const { pois, hasPois } = buildPoisByCategory(lat, lon, radius, overpassPois)

  const [urban, floodRaw] = await Promise.all([
    capasUrbanismo(lat, lon).catch(() => null),
    riesgoInundacion(lat, lon).catch(() => null),
  ])

  const landCover: LandCoverInfo | null = urban?.land_cover ?? null
  const floodRisk = ensureFloodRisk(floodRaw)

  if (!landCover) {
    warnings.push("Sin datos Copernicus CLC 2018")
  }
  if (!floodRisk.ok) {
    warnings.push("Servicio de inundacion no disponible")
  }

  const sources = {
    osm: { nominatim: Boolean(placeName), overpass: true },
    ign: {
      layers: ["IGNBaseTodo", "PNOA"],
      flood_wms: floodRisk.ok,
    },
    copernicus: { corine: Boolean(landCover) },
  }

  let contextData: ContextData = {
    center: { lat, lon },
    radius_m: radius,
    sources,
    land_cover: landCover,
    flood_risk: floodRisk,
    pois,
  }

  let status: AnalyzeStatus = hasPois ? "OK" : "NO_POIS"
  let aiReport: AiReport | null = null
  let fallbackReport: AiReport | null = null

  if (!hasPois) {
    warnings.push("No se encontraron POIs en el radio seleccionado")
    fallbackReport = buildFallbackReport(contextData, placeName, warnings)
  } else {
    let agentResult: Awaited<ReturnType<typeof runAgent>> | null = null
    try {
      agentResult = await runAgent(contextData, placeName, {
        capasUrbanismo: urban,
        riesgoInundacion: floodRisk,
      })
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Agent error", error)
      }
      warnings.push("IA no disponible")
    }

    if (agentResult?.landCover) {
      contextData = {
        ...contextData,
        land_cover: agentResult.landCover,
        sources: {
          ...contextData.sources,
          copernicus: { corine: true },
        },
      }
    }
    if (agentResult?.floodRisk) {
      contextData = {
        ...contextData,
        flood_risk: agentResult.floodRisk,
        sources: {
          ...contextData.sources,
          ign: { ...contextData.sources.ign, flood_wms: agentResult.floodRisk.ok },
        },
      }
    }

    if (agentResult?.warnings) {
      warnings.push(...agentResult.warnings)
    }
    aiReport = agentResult?.report ?? null

    if (!aiReport) {
      fallbackReport = buildFallbackReport(contextData, placeName, warnings)
    }
  }

  const floodMeta = buildFloodMeta(contextData.flood_risk)
  const payload: AnalyzeResponse = {
    ok: true,
    request_id: requestId,
    placeName,
    contextData,
    overpass_ok: true,
    overpass_error: null,
    flood_ok: floodMeta.flood_ok,
    flood_error: floodMeta.flood_error,
    flood_status: floodMeta.flood_status,
    status,
    aiReport,
    fallbackReport,
    warnings,
    warning: warnings[0] ?? null,
  }

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  })

  lastGoodContext = contextData
  lastGoodReport = aiReport ?? fallbackReport
  lastGoodPlaceName = placeName

  return NextResponse.json(payload)
}

async function buildMinimalContextAndReport(
  lat: number,
  lon: number,
  radius: number,
  placeName: string | null,
  warnings: string[]
) {
  const [urban, floodRaw] = await Promise.all([
    capasUrbanismo(lat, lon).catch(() => null),
    riesgoInundacion(lat, lon).catch(() => null),
  ])

  const landCover: LandCoverInfo | null = urban?.land_cover ?? null
  const floodRisk = ensureFloodRisk(floodRaw)

  if (!landCover) {
    warnings.push("Sin datos Copernicus CLC 2018")
  }
  if (!floodRisk.ok) {
    warnings.push("Servicio de inundacion no disponible")
  }

  const sources = {
    osm: { nominatim: Boolean(placeName), overpass: false },
    ign: {
      layers: ["IGNBaseTodo", "PNOA"],
      flood_wms: floodRisk.ok,
    },
    copernicus: { corine: Boolean(landCover) },
  }

  const contextData: ContextData = {
    center: { lat, lon },
    radius_m: radius,
    sources,
    land_cover: landCover,
    flood_risk: floodRisk,
    pois: createEmptyPois(),
  }

  const report = buildFallbackReport(contextData, placeName, warnings)
  return { contextData, report }
}

function ensureFloodRisk(value: FloodRiskInfo | null): FloodRiskInfo {
  if (value) return value
  return {
    ok: false,
    source: "MITECO",
    risk_level: "desconocido",
    details: "Servicio no disponible",
    layers_hit: [],
  }
}

function buildFloodMeta(flood: FloodRiskInfo | null) {
  const fallback = ensureFloodRisk(flood)
  if (fallback.ok) {
    return {
      flood_ok: true,
      flood_error: null,
      flood_status: "OK" as const,
    }
  }
  return {
    flood_ok: false,
    flood_error: fallback.details || "Servicio no disponible",
    flood_status: "DOWN" as const,
  }
}

function buildPoisByCategory(
  lat: number,
  lon: number,
  radius: number,
  rawPois: OverpassPoi[]
) {
  const pois = createEmptyPois()

  const items = rawPois
    .map((poi) => {
      const distance = Math.round(distanceMeters(lat, lon, poi.lat, poi.lon))
      return { ...poi, distance_m: distance }
    })
    .filter((poi) => poi.distance_m <= radius)

  for (const poi of items) {
    const item: PoiItem = {
      name: poi.name,
      distance_m: poi.distance_m,
      lat: poi.lat,
      lon: poi.lon,
      type: poi.type,
    }

    switch (poi.type) {
      case "restaurant":
      case "fast_food":
        pois.restaurants.push(item)
        break
      case "bar":
      case "club":
        pois.bars_and_clubs.push(item)
        break
      case "cafe":
        pois.cafes.push(item)
        break
      case "pharmacy":
        pois.pharmacies.push(item)
        break
      case "hospital":
        pois.hospitals.push(item)
        break
      case "school":
        pois.schools.push(item)
        break
      case "supermarket":
        pois.supermarkets.push(item)
        break
      case "bus_stop":
        pois.transport.push(item)
        break
      case "hotel":
        pois.hotels.push(item)
        break
      case "attraction":
        pois.tourism.push(item)
        break
      case "museum":
        pois.museums.push(item)
        break
      case "viewpoint":
        pois.viewpoints.push(item)
        break
      default:
        break
    }
  }

  const sorted = sortPois(pois)

  return { pois: sorted, hasPois: hasAnyPois(sorted) }
}

function createEmptyPois(): PoisByCategory {
  return {
    restaurants: [],
    bars_and_clubs: [],
    cafes: [],
    pharmacies: [],
    hospitals: [],
    schools: [],
    supermarkets: [],
    transport: [],
    hotels: [],
    tourism: [],
    museums: [],
    viewpoints: [],
  }
}

function sortPois(pois: PoisByCategory): PoisByCategory {
  const sort = (items: PoiItem[]) =>
    [...items].sort((a, b) => a.distance_m - b.distance_m)

  return {
    restaurants: sort(pois.restaurants),
    bars_and_clubs: sort(pois.bars_and_clubs),
    cafes: sort(pois.cafes),
    pharmacies: sort(pois.pharmacies),
    hospitals: sort(pois.hospitals),
    schools: sort(pois.schools),
    supermarkets: sort(pois.supermarkets),
    transport: sort(pois.transport),
    hotels: sort(pois.hotels),
    tourism: sort(pois.tourism),
    museums: sort(pois.museums),
    viewpoints: sort(pois.viewpoints),
  }
}

function hasAnyPois(pois: PoisByCategory) {
  return (
    pois.restaurants.length > 0 ||
    pois.bars_and_clubs.length > 0 ||
    pois.cafes.length > 0 ||
    pois.pharmacies.length > 0 ||
    pois.hospitals.length > 0 ||
    pois.schools.length > 0 ||
    pois.supermarkets.length > 0 ||
    pois.transport.length > 0 ||
    pois.hotels.length > 0 ||
    pois.tourism.length > 0 ||
    pois.museums.length > 0 ||
    pois.viewpoints.length > 0
  )
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
