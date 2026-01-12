import { NextResponse } from "next/server"

import { buscarCoordenadas } from "@/lib/tools/buscarCoordenadas"

type GeocodeRequest = {
  direccion?: string
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as GeocodeRequest
  const direccion = typeof body.direccion === "string" ? body.direccion : ""

  if (!direccion.trim()) {
    return NextResponse.json(
      { ok: false, error: "Missing address" },
      { status: 400 }
    )
  }

  const result = await buscarCoordenadas(direccion)
  if (!result) {
    return NextResponse.json(
      { ok: false, error: "No se encontraron resultados" },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, result })
}
