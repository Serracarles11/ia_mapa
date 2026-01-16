import { NextResponse } from "next/server"

import { fetchAircraftStates } from "@/lib/opensky"

type AircraftRequest = {
  center?: { lat?: number; lon?: number }
  radius_m?: number
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AircraftRequest
  const lat = body.center?.lat
  const lon = body.center?.lon
  const radius =
    typeof body.radius_m === "number" && body.radius_m > 0
      ? Math.round(body.radius_m)
      : 1200

  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json(
      { ok: false, error: "Missing lat/lon" },
      { status: 400 }
    )
  }

  const payload = await fetchAircraftStates(lat, lon, radius)
  return NextResponse.json(payload)
}
