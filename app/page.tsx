"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import Map from "@/components/Map"

function parseNumber(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

export default function Page() {
  const params = useSearchParams()
  const initial = useMemo(() => {
    const lat = parseNumber(params.get("lat"))
    const lon = parseNumber(params.get("lon"))
    const radius = parseNumber(params.get("radius"))
    return { lat, lon, radius }
  }, [params])

  return (
    <Map
      initialLat={initial.lat}
      initialLon={initial.lon}
      initialRadius={initial.radius}
    />
  )
}
