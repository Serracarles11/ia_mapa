import { NextResponse } from "next/server"

import { buildContext } from "@/lib/context/buildContext"
import { buildFallbackReport } from "@/lib/report/buildFallbackReport"
import { runAgent } from "@/lib/agent/runAgent"
import { hasAnyPois } from "@/lib/context/pois"
import {
  type AiReport,
  type AirQualityInfo,
  type ContextData,
  type FloodRiskInfo,
} from "@/lib/types"

type AnalyzeRequest = {
  center?: { lat?: number; lon?: number }
  radius_m?: number
  request_id?: number
}

type AnalyzeStatus = "OK" | "NO_POIS" | "OVERPASS_DOWN"
type FloodStatus = "OK" | "DOWN" | "VISUAL_ONLY"
type AirStatus = "OK" | "DOWN" | "VISUAL_ONLY"

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
  air_ok: boolean
  air_error: string | null
  air_status: AirStatus
  status: AnalyzeStatus
  aiReport: AiReport | null
  fallbackReport: AiReport | null
  warnings: string[]
  warning?: string | null
  error?: string
}

const CACHE_TTL_MS = 1000 * 60 * 6
const cache = new Map<
  string,
  { expiresAt: number; payload: AnalyzeResponse }
>()

let lastGoodContext: ContextData | null = null
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

  let contextData: ContextData | null = null
  let overpassOk = false
  let overpassError: string | null = null
  let warnings: string[] = []

  try {
    const result = await buildContext(lat, lon, radius)
    contextData = result.context
    overpassOk = result.overpassOk
    overpassError = result.overpassError
    warnings = result.warnings
  } catch {
    if (lastGoodContext) {
      const fallbackReport = buildFallbackReport(
        lastGoodContext,
        lastGoodPlaceName,
        ["Fallo al construir el contexto"]
      )
      const fallbackMetaFlood = buildFloodMeta(lastGoodContext.flood_risk)
      const fallbackMetaAir = buildAirMeta(lastGoodContext.air_quality)
      const payload: AnalyzeResponse = {
        ok: true,
        request_id: requestId,
        placeName: lastGoodPlaceName,
        contextData: lastGoodContext,
        overpass_ok: false,
        overpass_error: "Contexto no disponible",
        flood_ok: fallbackMetaFlood.flood_ok,
        flood_error: fallbackMetaFlood.flood_error,
        flood_status: fallbackMetaFlood.flood_status,
        air_ok: fallbackMetaAir.air_ok,
        air_error: fallbackMetaAir.air_error,
        air_status: fallbackMetaAir.air_status,
        status: "OVERPASS_DOWN",
        aiReport: null,
        fallbackReport,
        warnings: ["Contexto no disponible"],
        warning: "Contexto no disponible",
      }
      return NextResponse.json(payload)
    }

    return NextResponse.json(
      { ok: false, error: "No se pudo construir el contexto." },
      { status: 500 }
    )
  }

  const placeName = contextData.place.name
  const hasPois = hasAnyPois(contextData.pois)
  const baseStatus: AnalyzeStatus = hasPois ? "OK" : "NO_POIS"
  const status: AnalyzeStatus = overpassOk ? baseStatus : "OVERPASS_DOWN"

  if (!hasPois) {
    warnings.push("No se encontraron POIs en el radio seleccionado")
  }

  let aiReport: AiReport | null = null
  let fallbackReport: AiReport | null = null

  let agentResult: Awaited<ReturnType<typeof runAgent>> | null = null
  try {
    agentResult = await runAgent(contextData, placeName, {
      capasUrbanismo: contextData.land_cover
        ? {
            land_cover: contextData.land_cover,
            ign_layer: null,
            landuse_summary: contextData.environment.landuse_summary ?? null,
          }
        : null,
      riesgoInundacion: contextData.flood_risk,
      aireContaminacion: contextData.air_quality,
    })
  } catch {
    agentResult = null
  }

  if (agentResult?.landCover) {
    contextData = {
      ...contextData,
      land_cover: agentResult.landCover,
      environment: {
        ...contextData.environment,
        landuse_summary:
          contextData.environment.landuse_summary ??
          `CLC: ${agentResult.landCover.label}`,
      },
      sources: {
        ...contextData.sources,
        copernicus: { ...contextData.sources.copernicus, corine: true },
      },
    }
  }
  if (agentResult?.floodRisk) {
    contextData = {
      ...contextData,
      flood_risk: agentResult.floodRisk,
      risks: buildRiskSummary(agentResult.floodRisk, contextData.air_quality),
      sources: {
        ...contextData.sources,
        ign: {
          ...contextData.sources.ign,
          flood_wms: agentResult.floodRisk.source === "MITECO",
        },
        copernicus: {
          ...contextData.sources.copernicus,
          efas: agentResult.floodRisk.source === "Copernicus",
        },
      },
    }
  }
  if (agentResult?.airQuality) {
    contextData = {
      ...contextData,
      air_quality: agentResult.airQuality,
      risks: buildRiskSummary(contextData.flood_risk, agentResult.airQuality),
      sources: {
        ...contextData.sources,
        copernicus: {
          ...contextData.sources.copernicus,
          cams: agentResult.airQuality.ok,
        },
      },
    }
  }

  if (agentResult?.warnings) {
    const safeWarnings = agentResult.warnings.filter(
      (item) => !item.toLowerCase().includes("ia")
    )
    warnings.push(...safeWarnings)
  }

  aiReport = agentResult?.report ?? null
  if (!aiReport) {
    fallbackReport = buildFallbackReport(contextData, placeName, warnings)
  }

  const floodMeta = buildFloodMeta(contextData.flood_risk)
  const airMeta = buildAirMeta(contextData.air_quality)
  const payload: AnalyzeResponse = {
    ok: true,
    request_id: requestId,
    placeName,
    contextData,
    overpass_ok: overpassOk,
    overpass_error: overpassError,
    flood_ok: floodMeta.flood_ok,
    flood_error: floodMeta.flood_error,
    flood_status: floodMeta.flood_status,
    air_ok: airMeta.air_ok,
    air_error: airMeta.air_error,
    air_status: airMeta.air_status,
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
  lastGoodPlaceName = placeName

  return NextResponse.json(payload)
}

function buildFloodMeta(flood: FloodRiskInfo | null) {
  const fallback = ensureFloodRisk(flood)
  if (fallback.ok) {
    return {
      flood_ok: true,
      flood_error: null,
      flood_status: fallback.status,
    }
  }
  return {
    flood_ok: false,
    flood_error: fallback.details || "Servicio no disponible",
    flood_status: "DOWN" as const,
  }
}

function buildAirMeta(air: AirQualityInfo | null) {
  const fallback = ensureAirQuality(air)
  if (fallback.ok) {
    return {
      air_ok: true,
      air_error: null,
      air_status: fallback.status,
    }
  }
  return {
    air_ok: false,
    air_error: fallback.details || "Servicio no disponible",
    air_status: "DOWN" as const,
  }
}

function buildRiskSummary(
  flood: FloodRiskInfo | null,
  air: AirQualityInfo | null
): ContextData["risks"] {
  const floodFallback = ensureFloodRisk(flood)
  const airFallback = ensureAirQuality(air)

  return {
    flood: {
      source: floodFallback.source,
      status: floodFallback.status,
      notes: floodFallback.details,
      layer_enabled_supported: true,
    },
    air: {
      source: airFallback.source,
      status: airFallback.status,
      notes: airFallback.details,
      layer_enabled_supported: true,
    },
  }
}

function ensureFloodRisk(value: FloodRiskInfo | null): FloodRiskInfo {
  if (value) return value
  return {
    ok: false,
    status: "DOWN",
    source: "MITECO",
    risk_level: "desconocido",
    details: "Servicio no disponible",
    layers_hit: [],
  }
}

function ensureAirQuality(value: AirQualityInfo | null): AirQualityInfo {
  if (value) return value
  return {
    ok: false,
    status: "DOWN",
    source: "Copernicus",
    metric: "CAMS",
    unit: null,
    units: null,
    details: "Servicio no disponible",
    layer: null,
  }
}
