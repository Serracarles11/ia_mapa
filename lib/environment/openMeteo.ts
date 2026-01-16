import "server-only"

import { type WeatherInfo } from "@/lib/types"

const DEFAULT_ENDPOINT = "https://api.open-meteo.com/v1/forecast"
const CACHE_TTL_MS = 1000 * 60 * 10
const cache = new Map<
  string,
  { expiresAt: number; value: OpenMeteoResult | null }
>()

export type OpenMeteoResult = {
  weather: WeatherInfo | null
  elevation_m: number | null
}

type OpenMeteoResponse = {
  current?: {
    time?: string
    temperature_2m?: number
    wind_speed_10m?: number
    precipitation?: number
    weather_code?: number
  }
  elevation?: number
}

export async function fetchOpenMeteoWeather(
  lat: number,
  lon: number
): Promise<OpenMeteoResult | null> {
  const cacheKey = `${lat.toFixed(3)}:${lon.toFixed(3)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const url = new URL(process.env.OPEN_METEO_API_URL || DEFAULT_ENDPOINT)
  url.searchParams.set("latitude", String(lat))
  url.searchParams.set("longitude", String(lon))
  url.searchParams.set(
    "current",
    "temperature_2m,wind_speed_10m,precipitation,weather_code"
  )
  url.searchParams.set("temperature_unit", "celsius")
  url.searchParams.set("wind_speed_unit", "kmh")
  url.searchParams.set("precipitation_unit", "mm")
  url.searchParams.set("timezone", "auto")

  const res = await fetch(url.toString(), { cache: "no-store" })
  if (!res.ok) {
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: null,
    })
    return null
  }

  const data = (await res.json()) as OpenMeteoResponse
  const current = data.current ?? null
  const weather: WeatherInfo | null = current
    ? {
        source: "Open-Meteo",
        temperature_c: toNumber(current.temperature_2m),
        wind_kph: toNumber(current.wind_speed_10m),
        precipitation_mm: toNumber(current.precipitation),
        weather_code: toNumber(current.weather_code),
        description: describeWeatherCode(toNumber(current.weather_code)),
        time_iso: typeof current.time === "string" ? current.time : null,
      }
    : null

  const result: OpenMeteoResult = {
    weather,
    elevation_m: toNumber(data.elevation),
  }

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: result,
  })

  return result
}

function describeWeatherCode(code: number | null) {
  if (code == null) return null
  switch (code) {
    case 0:
      return "Despejado"
    case 1:
      return "Mayormente despejado"
    case 2:
      return "Parcialmente nublado"
    case 3:
      return "Nublado"
    case 45:
    case 48:
      return "Niebla"
    case 51:
      return "Llovizna ligera"
    case 53:
      return "Llovizna moderada"
    case 55:
      return "Llovizna intensa"
    case 56:
      return "Llovizna helada ligera"
    case 57:
      return "Llovizna helada intensa"
    case 61:
      return "Lluvia ligera"
    case 63:
      return "Lluvia moderada"
    case 65:
      return "Lluvia intensa"
    case 66:
      return "Lluvia helada ligera"
    case 67:
      return "Lluvia helada intensa"
    case 71:
      return "Nieve ligera"
    case 73:
      return "Nieve moderada"
    case 75:
      return "Nieve intensa"
    case 77:
      return "Granizo"
    case 80:
      return "Chubascos ligeros"
    case 81:
      return "Chubascos moderados"
    case 82:
      return "Chubascos intensos"
    case 85:
      return "Nieve ligera (chubascos)"
    case 86:
      return "Nieve intensa (chubascos)"
    case 95:
      return "Tormenta"
    case 96:
      return "Tormenta con granizo"
    case 99:
      return "Tormenta fuerte con granizo"
    default:
      return null
  }
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
