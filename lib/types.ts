export type PoiItem = {
  name: string
  distance_m: number
  lat: number
  lon: number
  type: string
}

export type PoisByCategory = {
  restaurants: PoiItem[]
  bars_and_clubs: PoiItem[]
  cafes: PoiItem[]
  pharmacies: PoiItem[]
  hospitals: PoiItem[]
  schools: PoiItem[]
  supermarkets: PoiItem[]
  transport: PoiItem[]
  hotels: PoiItem[]
  tourism: PoiItem[]
  museums: PoiItem[]
  viewpoints: PoiItem[]
}

export type LandCoverInfo = {
  code: string
  label: string
  source: "Copernicus CLC 2018"
}

export type FloodRiskInfo = {
  ok: boolean
  source: "IGN" | "MITECO" | "Copernicus" | "otro_oficial"
  risk_level: "bajo" | "medio" | "alto" | "desconocido"
  details: string
  layers_hit: string[]
  raw?: unknown
}

export type ContextSources = {
  osm: { nominatim: boolean; overpass: boolean }
  ign: { layers: string[]; flood_wms: boolean }
  copernicus: { corine: boolean }
}

export type ContextData = {
  center: { lat: number; lon: number }
  radius_m: number
  sources: ContextSources
  land_cover: LandCoverInfo | null
  flood_risk: FloodRiskInfo | null
  pois: PoisByCategory
}

export type AiReport = {
  descripcion_zona: string
  infraestructura_cercana: string
  riesgos: string
  usos_urbanos: string
  recomendacion_final: string
  fuentes: string[]
  limitaciones: string[]
}
