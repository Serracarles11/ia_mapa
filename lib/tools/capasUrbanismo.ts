import "server-only"

import { fetchWmsFeatureInfo } from "@/lib/geo/wms"
import { type LandCoverInfo } from "@/lib/types"

export type CapasUrbanismoResult = {
  land_cover: LandCoverInfo | null
  ign_layer: { layer: string; detail: string | null; source: string } | null
}

const DEFAULT_CLC_ARCGIS =
  "https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC2018_WM/MapServer"
const DEFAULT_CLC_LAYER = "0"

const DEFAULT_IGN_WMS = "https://www.ign.es/wms-inspire/pnoa-ma"
const DEFAULT_IGN_LAYER = "OI.MosaicElement"

export async function capasUrbanismo(
  lat: number,
  lon: number
): Promise<CapasUrbanismoResult> {
  const [landCover, ignInfo] = await Promise.all([
    fetchCorineLandCover(lat, lon),
    fetchIgnLayerInfo(lat, lon),
  ])

  return {
    land_cover: landCover,
    ign_layer: ignInfo,
  }
}

async function fetchCorineLandCover(
  lat: number,
  lon: number
): Promise<LandCoverInfo | null> {
  const baseUrl = process.env.COPERNICUS_CLC_ARCGIS_URL || DEFAULT_CLC_ARCGIS
  const layer = process.env.COPERNICUS_CLC_LAYER || DEFAULT_CLC_LAYER

  const minx = lon - 0.02
  const miny = lat - 0.02
  const maxx = lon + 0.02
  const maxy = lat + 0.02

  const url = new URL("identify", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
  url.searchParams.set("f", "json")
  url.searchParams.set("geometry", `${lon},${lat}`)
  url.searchParams.set("geometryType", "esriGeometryPoint")
  url.searchParams.set("sr", "4326")
  url.searchParams.set("layers", `all:${layer}`)
  url.searchParams.set("tolerance", "2")
  url.searchParams.set("mapExtent", `${minx},${miny},${maxx},${maxy}`)
  url.searchParams.set("imageDisplay", "100,100,96")
  url.searchParams.set("returnGeometry", "false")

  const response = await fetch(url.toString(), { cache: "no-store" })
  if (!response.ok) {
    return null
  }

  const data = (await response.json().catch(() => null)) as unknown
  if (!data || typeof data !== "object") return null

  const results = (data as { results?: Array<{ attributes?: Record<string, unknown> }> }).results
  if (!Array.isArray(results) || results.length === 0) return null

  const attributes = results[0]?.attributes
  if (!attributes || typeof attributes !== "object") return null

  const codeValue = attributes.Code_18 ?? attributes.CODE_18 ?? attributes.code_18
  const code = typeof codeValue === "number" ? String(codeValue) : String(codeValue || "")
  if (!code) return null

  return {
    code,
    label: CLC_LABELS[code] ?? `Clase CLC ${code}`,
    source: "Copernicus CLC 2018",
  }
}

async function fetchIgnLayerInfo(
  lat: number,
  lon: number
): Promise<{ layer: string; detail: string | null; source: string } | null> {
  const baseUrl = process.env.IGN_WMS_URL || DEFAULT_IGN_WMS
  const layer = process.env.IGN_WMS_LAYER || DEFAULT_IGN_LAYER

  const result = await fetchWmsFeatureInfo({
    baseUrl,
    layers: layer,
    lat,
    lon,
    infoFormat: "application/json",
  })

  if (!result.ok) {
    return null
  }

  if (result.json && typeof result.json === "object") {
    const json = result.json as { features?: Array<{ properties?: Record<string, unknown> }> }
    const feature = json.features?.[0]
    const properties = feature?.properties
    const detail = properties ? summarizeProperties(properties) : null
    return {
      layer,
      detail,
      source: "IGN WMS",
    }
  }

  const text = result.text ? result.text.trim() : ""
  return {
    layer,
    detail: text ? truncate(text, 240) : null,
    source: "IGN WMS",
  }
}

function summarizeProperties(props: Record<string, unknown>) {
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

const CLC_LABELS: Record<string, string> = {
  "111": "Tejido urbano continuo",
  "112": "Tejido urbano discontinuo",
  "121": "Zonas industriales o comerciales",
  "122": "Redes viarias y ferroviarias",
  "123": "Zonas portuarias",
  "124": "Aeropuertos",
  "131": "Extraccion minera",
  "132": "Vertederos",
  "133": "Zonas en construccion",
  "141": "Zonas verdes urbanas",
  "142": "Instalaciones deportivas y ocio",
  "211": "Cultivos de secano",
  "212": "Cultivos de regadio",
  "213": "Arrozales",
  "221": "Vinedos",
  "222": "Frutales y bayas",
  "223": "Olivares",
  "231": "Pastos",
  "241": "Cultivos mixtos con permanentes",
  "242": "Mosaico de cultivos",
  "243": "Agricultura con vegetacion natural",
  "244": "Agroforesteria",
  "311": "Bosque frondoso",
  "312": "Bosque de coniferas",
  "313": "Bosque mixto",
  "321": "Praderas naturales",
  "322": "Matorrales y brezales",
  "323": "Vegetacion esclerofila",
  "324": "Matorral arbolado",
  "331": "Playas, dunas y arenas",
  "332": "Roquedo",
  "333": "Vegetacion escasa",
  "334": "Zonas quemadas",
  "335": "Glaciares y nieves perpetuas",
  "411": "Marismas interiores",
  "412": "Turberas",
  "421": "Marismas salinas",
  "422": "Salinas",
  "423": "Llanuras intermareales",
  "511": "Cursos de agua",
  "512": "Laminas de agua",
  "521": "Lagunas costeras",
  "522": "Estuarios",
  "523": "Mar y oceano",
}
