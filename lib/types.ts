export type PoiItem = {
  name: string
  distance_m: number
  lat: number
  lon: number
  type: string
  source?: "OSM" | "Wikidata" | "Geoapify" | "OpenTripMap"
  category?: string | null
  raw?: unknown
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

export type LayerStatus = "OK" | "DOWN" | "VISUAL_ONLY"

export type FloodRiskInfo = {
  ok: boolean
  status: LayerStatus
  source: "IGN" | "MITECO" | "Copernicus" | "otro_oficial"
  risk_level: "bajo" | "medio" | "alto" | "desconocido"
  details: string
  layers_hit: string[]
  value?: number | null
  unit?: string | null
  raw?: unknown
}

export type AirQualityInfo = {
  ok: boolean
  status: LayerStatus
  source: "Copernicus" | "otro_oficial"
  metric: string
  unit?: string | null
  units: string | null
  details: string
  layer: string | null
  value?: number | null
  raw?: unknown
}

export type ContextPlace = {
  name: string | null
  category: string | null
  addressLine: string | null
  municipality: string | null
  type?: string | null
  displayName?: string | null
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
  landuse_osm_summary?: string | null
  landuse_osm_counts?: Record<string, number>
  nearest_waterways: WaterwayInfo[]
  elevation_m: number | null
  is_coastal: boolean | null
  weather?: WeatherInfo | null
}

export type AdminInfo = {
  municipality: string | null
  district: string | null
  province: string | null
  region: string | null
  country: string | null
  postcode: string | null
  road: string | null
  road_type: string | null
  house_number: string | null
  neighbourhood: string | null
  county: string | null
  state: string | null
}

export type WikidataInfo = {
  id: string
  label: string | null
  description: string | null
  distance_m: number | null
  wikipedia_url: string | null
  wikidata_url: string
  types: string[]
  admin_areas: string[]
  country: string | null
  population: number | null
  area_km2: number | null
  elevation_m: number | null
  inception: string | null
  timezone: string | null
  website: string | null
  image: string | null
  commons_category: string | null
  aliases: string[]
  coordinates: { lat: number; lon: number } | null
  facts: string[]
}

export type WikidataNearbyItem = {
  id: string
  label: string | null
  description: string | null
  distance_m: number | null
  wikipedia_url: string | null
  wikidata_url: string
  types: string[]
  coordinates: { lat: number; lon: number } | null
}

export type WikipediaNearbyItem = {
  pageid: number
  title: string
  extract: string | null
  description: string | null
  url: string | null
  distance_m: number | null
  coordinates: { lat: number; lon: number } | null
  thumbnail: string | null
}

export type WeatherInfo = {
  source: "Open-Meteo" | "otro"
  temperature_c: number | null
  wind_kph: number | null
  precipitation_mm: number | null
  weather_code: number | null
  description: string | null
  time_iso: string | null
}

export type ExternalPoi = {
  name: string
  source: "Wikidata" | "Geoapify" | "OpenTripMap"
  category: string | null
  distance_m: number | null
  lat: number | null
  lon: number | null
  kinds?: string[]
  url?: string | null
  raw?: unknown
}

export type ComparisonSummary = {
  base: {
    name: string | null
    coords: { lat: number; lon: number }
    radius_m: number
  }
  target: {
    name: string | null
    coords: { lat: number; lon: number }
    radius_m: number
  }
  distance_km: number | null
  poi_totals: {
    base: number
    target: number
  }
  highlights: string[]
  created_at: string
}

export type RiskLayerInfo = {
  source: string
  status: LayerStatus
  notes: string
  layer_enabled_supported: boolean
}

export type ContextSources = {
  osm: { nominatim: boolean; overpass: boolean }
  ign: { layers: string[]; flood_wms: boolean }
  copernicus: { corine: boolean; efas: boolean; cams: boolean }
  wikidata: boolean
  geoapify: boolean
  wikipedia: boolean
  open_meteo: boolean
}

export type ContextData = {
  center: { lat: number; lon: number }
  radius_m: number
  place: ContextPlace
  admin: AdminInfo
  poi_summary: PoiSummary
  sources: ContextSources
  wikidata?: WikidataInfo | null
  wikidata_nearby?: WikidataNearbyItem[]
  wikipedia_nearby?: WikipediaNearbyItem[]
  external_pois?: ExternalPoi[]
  comparison?: ComparisonSummary | null
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
