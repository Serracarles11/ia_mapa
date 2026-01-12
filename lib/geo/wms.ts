import "server-only"

type WmsFeatureInfoParams = {
  baseUrl: string
  layers: string
  lat: number
  lon: number
  infoFormat?: string
  version?: string
  bufferDeg?: number
}

type WmsFeatureInfoResponse = {
  ok: boolean
  json?: unknown
  text?: string
  url: string
}

export async function fetchWmsFeatureInfo(
  params: WmsFeatureInfoParams
): Promise<WmsFeatureInfoResponse> {
  const version = params.version ?? "1.3.0"
  const infoFormat = params.infoFormat ?? "application/json"
  const buffer = typeof params.bufferDeg === "number" ? params.bufferDeg : 0.002

  const minx = params.lon - buffer
  const miny = params.lat - buffer
  const maxx = params.lon + buffer
  const maxy = params.lat + buffer

  const url = new URL(params.baseUrl)
  url.searchParams.set("SERVICE", "WMS")
  url.searchParams.set("REQUEST", "GetFeatureInfo")
  url.searchParams.set("VERSION", version)
  url.searchParams.set("CRS", "EPSG:4326")
  url.searchParams.set("BBOX", `${miny},${minx},${maxy},${maxx}`)
  url.searchParams.set("WIDTH", "101")
  url.searchParams.set("HEIGHT", "101")
  url.searchParams.set("LAYERS", params.layers)
  url.searchParams.set("QUERY_LAYERS", params.layers)
  url.searchParams.set("INFO_FORMAT", infoFormat)
  url.searchParams.set("I", "50")
  url.searchParams.set("J", "50")
  url.searchParams.set("FEATURE_COUNT", "5")

  const response = await fetch(url.toString(), { cache: "no-store" })

  if (!response.ok) {
    return { ok: false, url: url.toString() }
  }

  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("json")) {
    const json = (await response.json().catch(() => null)) as unknown
    return { ok: true, json, url: url.toString() }
  }

  const text = await response.text().catch(() => "")
  return { ok: true, text, url: url.toString() }
}
