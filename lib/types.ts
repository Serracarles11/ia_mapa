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

export type AirQualityInfo = {
  ok: boolean
  source: "Copernicus" | "otro_oficial"
  metric: string
  units: string | null
  details: string
  layer: string | null
  raw?: unknown
}

export type ContextPlace = {
  name: string | null
  category: string | null
  addressLine: string | null
  municipality: string | null
}

export type PoiSummary = {
  counts: Record<string, number>
  total: number
}

export type WaterwayInfo = {
  name: string | null
  type: string
  distance_m: number
}

export type EnvironmentInfo = {
  landuse_summary: string | null
  nearest_waterways: WaterwayInfo[]
  elevation_m: number | null
  is_coastal: boolean | null
}

export type RiskLayerInfo = {
  source: string
  status: "OK" | "DOWN" | "VISUAL_ONLY"
  notes: string
  layer_enabled_supported: boolean
}

export type ContextSources = {
  osm: { nominatim: boolean; overpass: boolean }
  ign: { layers: string[]; flood_wms: boolean }
  copernicus: { corine: boolean; efas: boolean; cams: boolean }
}

export type ContextData = {
  center: { lat: number; lon: number }
  radius_m: number
  place: ContextPlace
  poi_summary: PoiSummary
  sources: ContextSources
  land_cover: LandCoverInfo | null
  flood_risk: FloodRiskInfo | null
  air_quality: AirQualityInfo | null
  environment: EnvironmentInfo
  risks: {
    flood: RiskLayerInfo
    air: RiskLayerInfo
  }
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
