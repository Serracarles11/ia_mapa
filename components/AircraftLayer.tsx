"use client"

import { useEffect, useMemo, useState } from "react"
import L from "leaflet"
import { Marker, Popup } from "react-leaflet"

type AircraftLayerProps = {
  enabled: boolean
  center: { lat: number; lon: number } | null
  radius_m: number
  onStatusChange?: (status: AircraftStatus) => void
}

export type AircraftStatus = {
  state: "idle" | "loading" | "error"
  count: number
  notice?: string
  mode?: "live" | "demo"
  source?: string
}

type AircraftState = {
  id: string
  callsign: string | null
  origin_country: string | null
  lat: number
  lon: number
  altitude_m: number | null
  velocity_mps: number | null
  heading_deg: number | null
  on_ground: boolean
  last_contact: number | null
  time_position: number | null
}

type AircraftResponse = {
  ok: boolean
  mode: "live" | "demo"
  source: string
  time: number | null
  flights: AircraftState[]
  notice?: string
  rate_limited?: boolean
  refresh_ms?: number
}

const DEFAULT_REFRESH_MS = 10000

export default function AircraftLayer({
  enabled,
  center,
  radius_m,
  onStatusChange,
}: AircraftLayerProps) {
  const [flights, setFlights] = useState<AircraftState[]>([])
  const centerLat = center?.lat ?? null
  const centerLon = center?.lon ?? null
  const [refreshMs, setRefreshMs] = useState(() => {
    const env = process.env.NEXT_PUBLIC_AIRCRAFT_REFRESH_MS
    const parsed = env ? Number(env) : DEFAULT_REFRESH_MS
    return Number.isFinite(parsed) ? parsed : DEFAULT_REFRESH_MS
  })

  useEffect(() => {
    if (!enabled) {
      setFlights([])
      const next = { state: "idle", count: 0 } as const
      onStatusChange?.(next)
      return
    }

    if (centerLat == null || centerLon == null) {
      setFlights([])
      const next = { state: "error", count: 0, notice: "Selecciona un punto." }
      onStatusChange?.(next)
      return
    }

    let active = true
    let timeout: number | undefined

    const loadFlights = async () => {
      onStatusChange?.({ state: "loading", count: 0 })

      try {
        const res = await fetch("/api/aircraft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            center: { lat: centerLat, lon: centerLon },
            radius_m,
          }),
        })

        if (!res.ok) {
          throw new Error("No se pudo cargar ADS-B.")
        }

        const data = (await res.json()) as AircraftResponse
        if (!active) return
        const nextFlights = Array.isArray(data.flights) ? data.flights : []
        setFlights(nextFlights)
        const nextStatus: AircraftStatus = {
          state: "idle",
          count: nextFlights.length,
          notice: data.notice,
          mode: data.mode,
          source: data.source,
        }
        onStatusChange?.(nextStatus)

        if (typeof data.refresh_ms === "number") {
          setRefreshMs(Math.max(5000, data.refresh_ms))
        } else if (data.rate_limited) {
          setRefreshMs(30000)
        } else {
          setRefreshMs(DEFAULT_REFRESH_MS)
        }
      } catch {
        if (!active) return
        const nextStatus: AircraftStatus = {
          state: "error",
          count: 0,
          notice: "No se pudo cargar el radar ADS-B.",
        }
        setFlights([])
        onStatusChange?.(nextStatus)
        setRefreshMs(30000)
      } finally {
        if (!active) return
        timeout = window.setTimeout(loadFlights, refreshMs)
      }
    }

    loadFlights()

    return () => {
      active = false
      if (timeout) window.clearTimeout(timeout)
    }
  }, [enabled, centerLat, centerLon, radius_m, refreshMs, onStatusChange])

  const icons = useMemo(() => {
    return new Map(
      flights.map((flight) => [
        flight.id,
        buildIcon(flight.heading_deg, flight.on_ground),
      ])
    )
  }, [flights])

  if (!enabled || centerLat == null || centerLon == null) return null

  return (
    <>
      {flights.map((flight) => (
        <Marker
          key={`${flight.id}-${flight.lat}-${flight.lon}`}
          position={[flight.lat, flight.lon]}
          icon={icons.get(flight.id)}
        >
          <Popup>
            <div className="text-[11px]">
              <div className="font-semibold">
                {flight.callsign?.trim() || flight.id}
              </div>
              <div>{flight.origin_country || "Origen desconocido"}</div>
              <div>Altitud: {formatAltitude(flight.altitude_m)}</div>
              <div>Velocidad: {formatSpeed(flight.velocity_mps)}</div>
              <div>Rumbo: {formatHeading(flight.heading_deg)}</div>
              <div>
                Hora:{" "}
                {formatTimestamp(flight.last_contact ?? flight.time_position)}
              </div>
              <div>Estado: {flight.on_ground ? "en tierra" : "en vuelo"}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}

function buildIcon(heading: number | null, onGround: boolean) {
  const rotation = typeof heading === "number" ? heading : 0
  const color = onGround ? "#94a3b8" : "#2563eb"
  const html = `
    <div class="aircraft-marker" style="transform: rotate(${rotation}deg);">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2l5 10-5 3-5-3 5-10z" fill="${color}"></path>
        <path d="M12 15v7"></path>
      </svg>
    </div>
  `
  return L.divIcon({
    className: "aircraft-icon",
    html,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function formatAltitude(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d"
  return `${Math.round(value)} m`
}

function formatSpeed(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d"
  const kmh = Math.round(value * 3.6)
  return `${kmh} km/h`
}

function formatHeading(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d"
  return `${Math.round(value)} deg`
}

function formatTimestamp(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d"
  const date = new Date(value * 1000)
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}
