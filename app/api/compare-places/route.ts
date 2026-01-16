import { NextResponse } from "next/server"

import { callLlm } from "@/lib/llm"
import { type ComparisonMetrics } from "@/lib/types"

type ComparisonSide = {
  name?: string | null
  coords?: { lat?: number; lon?: number }
  radius_m?: number
  metrics?: ComparisonMetrics
}

type ComparisonSideWithMetrics = ComparisonSide & {
  metrics: ComparisonMetrics
}

type ComparisonRequest = {
  base?: ComparisonSide
  target?: ComparisonSide
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ComparisonRequest
  const base = body.base
  const target = body.target

  if (!base?.metrics || !target?.metrics) {
    return NextResponse.json(
      { ok: false, error: "Missing comparison data" },
      { status: 400 }
    )
  }

  const opinion = await generateOpinion(
    base as ComparisonSideWithMetrics,
    target as ComparisonSideWithMetrics
  )
  return NextResponse.json({ opinion })
}

async function generateOpinion(
  base: ComparisonSideWithMetrics,
  target: ComparisonSideWithMetrics
) {
  const payload = {
    base: normalizeSide(base),
    target: normalizeSide(target),
  }

  const response = await callLlm({
    messages: [
      {
        role: "system",
        content: [
          "Eres un analista territorial.",
          "Compara dos lugares y da una opinion breve y practica (3-6 frases).",
          "Menciona servicios (POIs), riesgo de inundacion, aire, uso del suelo y agua cercana si hay datos.",
          "Si faltan datos, indicarlo en una frase final.",
          "No inventes datos ni nombres.",
          "Responde solo texto plano en castellano.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Datos JSON:\n${JSON.stringify(payload)}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 280,
  })

  const text = response?.message.content ?? ""
  const cleaned = text.trim()
  if (cleaned.length >= 30) {
    return cleaned
  }

  return buildFallbackOpinion(payload.base, payload.target)
}

function normalizeSide(side: ComparisonSideWithMetrics) {
  return {
    name: typeof side.name === "string" ? side.name : "sin nombre",
    coords: side.coords ?? { lat: null, lon: null },
    radius_m: typeof side.radius_m === "number" ? side.radius_m : null,
    metrics: side.metrics,
  }
}

function buildFallbackOpinion(
  base: ReturnType<typeof normalizeSide>,
  target: ReturnType<typeof normalizeSide>
) {
  const baseScore = scoreMetrics(base.metrics)
  const targetScore = scoreMetrics(target.metrics)

  const poiWinner = compareValue(
    base.metrics.poi_total,
    target.metrics.poi_total
  )
  const floodWinner = compareValue(
    scoreFlood(base.metrics.flood_risk),
    scoreFlood(target.metrics.flood_risk)
  )
  const airWinner = compareValue(
    scoreAir(base.metrics.air_quality),
    scoreAir(target.metrics.air_quality)
  )

  const overall =
    baseScore === targetScore
      ? "equilibrado"
      : baseScore > targetScore
        ? "base"
        : "comparado"

  const missing = buildMissingLine(base.metrics, target.metrics)
  const parts = [
    `Servicios: ${pickLabel(poiWinner, base.name, target.name)} tiene mas POIs (base ${base.metrics.poi_total}, comparado ${target.metrics.poi_total}).`,
    `Riesgo inundacion: ${pickLabel(floodWinner, base.name, target.name)} muestra mejor perfil.`,
    `Aire: ${pickLabel(airWinner, base.name, target.name)} tiene mejor disponibilidad de datos.`,
    overall === "equilibrado"
      ? "Opinion: ambos puntos son similares con la informacion disponible."
      : `Opinion: ${overall === "base" ? base.name : target.name} parece mas equilibrado para servicios y riesgos.`,
  ]

  if (missing) {
    parts.push(missing)
  }

  return parts.join(" ")
}

function buildMissingLine(
  base: ComparisonMetrics,
  target: ComparisonMetrics
) {
  const missing: string[] = []
  if (isMissing(base.flood_risk) || isMissing(target.flood_risk)) {
    missing.push("riesgo de inundacion")
  }
  if (isMissing(base.air_quality) || isMissing(target.air_quality)) {
    missing.push("calidad del aire")
  }
  if (isMissing(base.land_cover) || isMissing(target.land_cover)) {
    missing.push("uso del suelo")
  }
  if (missing.length === 0) return null
  return `Limitaciones: faltan datos de ${missing.join(", ")}.`
}

function isMissing(value: string) {
  const lower = value.toLowerCase()
  return (
    lower.includes("sin datos") ||
    lower.includes("no disponible") ||
    lower.includes("desconocido")
  )
}

function scoreMetrics(metrics: ComparisonMetrics) {
  return (
    metrics.poi_total +
    scoreFlood(metrics.flood_risk) * 3 +
    scoreAir(metrics.air_quality) * 2
  )
}

function scoreFlood(value: string) {
  const lower = value.toLowerCase()
  if (lower.includes("bajo")) return 3
  if (lower.includes("medio")) return 2
  if (lower.includes("alto")) return 0
  return 1
}

function scoreAir(value: string) {
  const lower = value.toLowerCase()
  if (lower.includes("ok")) return 3
  if (lower.includes("visual")) return 2
  return 1
}

function compareValue(a: number, b: number) {
  if (a === b) return "igual"
  return a > b ? "base" : "comparado"
}

function pickLabel(result: ReturnType<typeof compareValue>, base: string, target: string) {
  if (result === "igual") return "ambos"
  return result === "base" ? base : target
}
