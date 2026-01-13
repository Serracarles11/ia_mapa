export type CopernicusWmsLayer = {
  baseUrl: string
  layer: string
  token?: string | null
  source: string
  metric?: string
  units?: string
}

const EFAS_DEFAULT_URL = "https://www.efas.eu/api/wms/"
const EFAS_DEFAULT_LAYER = "mapserver:Europe_combined_flood_scenarios"

const CAMS_DEFAULT_URL = "https://eccharts.ecmwf.int/wms/"
const CAMS_DEFAULT_LAYER = "composition_europe_pm2p5_forecast_surface"

export function getEfasLayerConfig(): CopernicusWmsLayer {
  const token =
    process.env.COPERNICUS_EFAS_WMS_TOKEN ??
    process.env.NEXT_PUBLIC_EFAS_WMS_TOKEN ??
    null
  const layer =
    process.env.COPERNICUS_EFAS_WMS_LAYER ??
    process.env.NEXT_PUBLIC_EFAS_WMS_LAYER ??
    EFAS_DEFAULT_LAYER
  const baseUrl =
    process.env.COPERNICUS_EFAS_WMS_URL ??
    process.env.NEXT_PUBLIC_EFAS_WMS_URL ??
    EFAS_DEFAULT_URL

  return {
    baseUrl: withToken(baseUrl, token),
    layer,
    token,
    source: "Copernicus EFAS",
  }
}

export function getCamsLayerConfig(): CopernicusWmsLayer {
  const token =
    process.env.CAMS_WMS_TOKEN ??
    process.env.NEXT_PUBLIC_CAMS_WMS_TOKEN ??
    "public"
  const layer =
    process.env.CAMS_WMS_LAYER ??
    process.env.NEXT_PUBLIC_CAMS_WMS_LAYER ??
    CAMS_DEFAULT_LAYER
  const baseUrl =
    process.env.CAMS_WMS_URL ??
    process.env.NEXT_PUBLIC_CAMS_WMS_URL ??
    CAMS_DEFAULT_URL

  return {
    baseUrl: withToken(baseUrl, token),
    layer,
    token,
    source: "Copernicus CAMS",
    metric: "PM2.5",
    units: "ug/m3",
  }
}

function withToken(baseUrl: string, token?: string | null) {
  if (!token) return baseUrl
  try {
    const url = new URL(baseUrl)
    if (!url.searchParams.has("token")) {
      url.searchParams.set("token", token)
    }
    return url.toString()
  } catch {
    return baseUrl
  }
}
