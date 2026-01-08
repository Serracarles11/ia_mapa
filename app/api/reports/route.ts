import { NextResponse } from "next/server"
import { saveAiReport } from "@/lib/reports"

type SaveRequest = {
  lat?: number
  lon?: number
  name?: string | null
  category?: string | null
  aiResponse?: unknown
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SaveRequest

  if (typeof body.lat !== "number" || typeof body.lon !== "number") {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 })
  }

  if (typeof body.aiResponse === "undefined") {
    return NextResponse.json({ error: "Missing aiResponse" }, { status: 400 })
  }

  try {
    await saveAiReport({
      place_name: body.name ?? null,
      lat: body.lat,
      lon: body.lon,
      category: body.category ?? null,
      report: body.aiResponse,
    })
  } catch (error) {
    console.error("Failed to save ai report", error)
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
