import "server-only"

import { fetchWmsFeatureInfo } from "@/lib/geo/wms"
import { getCamsLayerConfig } from "@/lib/copernicus"
import { type AirQualityInfo } from "@/lib/types"

export async function aireContaminacion(
  lat: number,
  lon: number
): Promise<AirQualityInfo> {
  const config = getCamsLayerConfig()
  const baseUrl = config.baseUrl
  const layer = config.layer

  let result: Awaited<ReturnType<typeof fetchWmsFeatureInfo>> | null = null
  try {
    result = await fetchWmsFeatureInfo({
      baseUrl,
      layers: layer,
      lat,
      lon,
      infoFormat: "application/json",
      bufferDeg: 0.2,
    })
  } catch {
    result = null
  }

  if (!result || !result.ok) {
    const available = await checkWmsAvailability(baseUrl)
    if (available) {
      return {
        ok: true,
        status: "VISUAL_ONLY",
        source: "Copernicus",
        metric: config.metric ?? "CAMS",
        unit: config.units ?? null,
        units: config.units ?? null,
        details:
          "Capa CAMS disponible para visualizacion. No se pudo muestrear el valor.",
        layer: layer,
      }
    }

    return {
      ok: false,
      status: "DOWN",
      source: "Copernicus",
      metric: config.metric ?? "CAMS",
      unit: config.units ?? null,
      units: config.units ?? null,
      details: "Servicio CAMS no disponible",
      layer: layer,
    }
  }

  const parsed = parseFeatureInfo(result)
  if (parsed.value !== null) {
    const unit = config.units ?? parsed.units ?? null
    const valueText = `${parsed.value}`
    return {
      ok: true,
      status: "OK",
      source: "Copernicus",
      metric: config.metric ?? parsed.metric ?? "CAMS",
      unit,
      units: unit,
      details: `Valor estimado: ${valueText}${unit ? ` ${unit}` : ""}`,
      layer: layer,
      value: parsed.value,
      raw: parsed.raw,
    }
  }

  return {
    ok: true,
    status: "VISUAL_ONLY",
    source: "Copernicus",
    metric: config.metric ?? "CAMS",
    unit: config.units ?? null,
    units: config.units ?? null,
    details:
      "Capa CAMS disponible para visualizacion. No se pudo extraer valor puntual.",
    layer: layer,
    raw: parsed.raw,
  }
}

function parseFeatureInfo(result: {
  json?: unknown
  text?: string
}): {
  value: number | null
  metric?: string
  units?: string | null
  raw?: unknown
} {
  if (result.json && typeof result.json === "object") {
    const json = result.json as {
      features?: Array<{ properties?: Record<string, unknown> }>
    }
    const props = json.features?.[0]?.properties
    if (props && typeof props === "object") {
      const extracted = extractNumeric(props)
      return {
        value: extracted?.value ?? null,
        metric: extracted?.metric,
        units: extracted?.units ?? null,
        raw: result.json,
      }
    }
    return { value: null, raw: result.json }
  }

  const text = result.text?.trim() ?? ""
  if (!text) return { value: null }
  const numericMatch = text.match(/-?\\d+(?:\\.\\d+)?/)
  return {
    value: numericMatch ? Number(numericMatch[0]) : null,
    raw: text,
  }
}

function extractNumeric(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return { value, metric: key, units: null }
    }
    if (typeof value === "string") {
      const match = value.match(/-?\\d+(?:\\.\\d+)?/)
      if (match) {
        const parsed = Number(match[0])
        if (Number.isFinite(parsed)) {
          return { value: parsed, metric: key, units: null }
        }
      }
    }
  }
  return null
}

async function checkWmsAvailability(baseUrl: string) {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set("service", "WMS")
    url.searchParams.set("request", "GetCapabilities")
    const response = await fetch(url.toString(), { cache: "no-store" })
    if (!response.ok) return false
    const text = await response.text()
    return /WMS_Capabilities|WMT_MS_Capabilities/i.test(text)
  } catch {
    return false
  }
}
