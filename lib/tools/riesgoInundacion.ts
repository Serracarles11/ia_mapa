import "server-only"

import { fetchWmsFeatureInfo } from "@/lib/geo/wms"
import { type FloodRiskInfo } from "@/lib/types"

const DEFAULT_FLOOD_WMS =
  "https://servicios.mapama.gob.es/arcgis/services/Agua/Riesgo/MapServer/WMSServer"
const DEFAULT_FLOOD_LAYER = "AreaImp_100"
const DEFAULT_LAYERS = [DEFAULT_FLOOD_LAYER]

export async function riesgoInundacion(
  lat: number,
  lon: number
): Promise<FloodRiskInfo> {
  const baseUrl = process.env.FLOOD_WMS_URL || DEFAULT_FLOOD_WMS
  const layers = parseLayers(
    process.env.FLOOD_WMS_LAYERS || process.env.FLOOD_WMS_LAYER
  )

  let ok = false
  const hits: Array<{ layer: string; detail: string | null }> = []
  const rawResponses: Array<{ layer: string; raw: unknown }> = []

  for (const layer of layers) {
    let result: Awaited<ReturnType<typeof fetchWmsFeatureInfo>> | null = null
    try {
      result = await fetchWmsFeatureInfo({
        baseUrl,
        layers: layer,
        lat,
        lon,
        infoFormat: "application/json",
        bufferDeg: 0.0015,
      })
    } catch {
      result = null
    }

    if (!result || !result.ok) {
      continue
    }

    ok = true

    const parsed = parseFeatureInfo(result)
    if (parsed.raw) {
      rawResponses.push({ layer, raw: parsed.raw })
    }
    if (parsed.hit) {
      hits.push({ layer, detail: parsed.detail })
    }
  }

  if (!ok) {
    return {
      ok: false,
      source: "MITECO",
      risk_level: "desconocido",
      details: "Servicio no disponible",
      layers_hit: [],
    }
  }

  if (hits.length === 0) {
    return {
      ok: true,
      source: "MITECO",
      risk_level: "bajo",
      details: "No se detectan zonas inundables en el punto consultado.",
      layers_hit: [],
    }
  }

  const riskLevel = determineRisk(hits.map((item) => item.layer))
  const details = hits
    .map((item) =>
      item.detail
        ? `Interseccion con ${item.layer}: ${item.detail}`
        : `Interseccion con ${item.layer}`
    )
    .join(" | ")

  const response: FloodRiskInfo = {
    ok: true,
    source: "MITECO",
    risk_level: riskLevel,
    details,
    layers_hit: hits.map((item) => item.layer),
  }

  if (process.env.FLOOD_WMS_DEBUG === "true" && rawResponses.length > 0) {
    response.raw = rawResponses
  }

  return response
}

function parseLayers(input?: string | null) {
  if (!input) return DEFAULT_LAYERS
  const items = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  return items.length > 0 ? items : DEFAULT_LAYERS
}

function parseFeatureInfo(result: {
  json?: unknown
  text?: string
}): { hit: boolean; detail: string | null; raw?: unknown } {
  if (result.json && typeof result.json === "object") {
    const json = result.json as {
      features?: Array<{ properties?: Record<string, unknown> }>
    }
    const features = Array.isArray(json.features) ? json.features : []
    if (features.length === 0) {
      return { hit: false, detail: null, raw: result.json }
    }
    return {
      hit: true,
      detail: summarizeProperties(features[0]?.properties),
      raw: result.json,
    }
  }

  const text = result.text ? result.text.trim() : ""
  const lower = text.toLowerCase()
  const hit = Boolean(text) && !lower.includes("no features") && !lower.includes("sin resultados")
  return {
    hit,
    detail: hit ? truncate(text, 240) : null,
    raw: text ? text : undefined,
  }
}

function summarizeProperties(props?: Record<string, unknown>) {
  if (!props) return null
  const entries = Object.entries(props)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${value}`)
  return entries.length > 0 ? entries.join(" | ") : null
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 3)}...`
}

function determineRisk(layers: string[]): FloodRiskInfo["risk_level"] {
  const scores = layers.map((layer) => layerRiskScore(layer))
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0
  if (maxScore >= 3) return "alto"
  if (maxScore === 2) return "medio"
  if (maxScore === 1) return "bajo"
  return "desconocido"
}

function layerRiskScore(layer: string) {
  const normalized = layer.toLowerCase()
  if (normalized.includes("10")) return 3
  if (normalized.includes("50")) return 2
  if (normalized.includes("100")) return 2
  if (normalized.includes("500")) return 1
  return 1
}
