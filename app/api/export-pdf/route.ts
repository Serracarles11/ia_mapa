import { NextResponse } from "next/server"
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib"

import { type AiReport, type ContextData } from "@/lib/types"

type ExportPayload = {
  placeName?: string | null
  coords?: { lat: number; lon: number } | null
  radius?: number | null
  report?: AiReport | null
  contextData?: ContextData | null
  timestamp?: string | null
}

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const HEADER_HEIGHT = 46
const MARGIN = 46

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ExportPayload
  const report = body.report ?? null
  const context = body.contextData ?? null

  if (!report) {
    return NextResponse.json(
      { ok: false, error: "Missing report" },
      { status: 400 }
    )
  }

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const textSize = 11
  const titleSize = 14
  const contentWidth = PAGE_WIDTH - MARGIN * 2
  const lineHeight = textSize + 4

  let page: ReturnType<PDFDocument["addPage"]>
  let cursorY = 0

  const drawHeader = () => {
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - HEADER_HEIGHT,
      width: PAGE_WIDTH,
      height: HEADER_HEIGHT,
      color: rgb(0.08, 0.16, 0.24),
    })
    page.drawText("Informe geoespacial", {
      x: MARGIN,
      y: PAGE_HEIGHT - HEADER_HEIGHT + 16,
      size: titleSize,
      font: fontBold,
      color: rgb(1, 1, 1),
    })
  }

  const startPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    drawHeader()
    cursorY = PAGE_HEIGHT - HEADER_HEIGHT - 18
  }

  const ensureSpace = (height: number) => {
    if (cursorY - height < MARGIN) {
      startPage()
    }
  }

  const drawInfoBox = (lines: string[]) => {
    const wrapped = lines.flatMap((line) =>
      wrapText(line, font, textSize, contentWidth - 12)
    )
    const boxHeight = wrapped.length * lineHeight + 10
    ensureSpace(boxHeight + 6)

    page.drawRectangle({
      x: MARGIN,
      y: cursorY - boxHeight,
      width: contentWidth,
      height: boxHeight,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.88, 0.89, 0.91),
      borderWidth: 1,
    })

    let textY = cursorY - lineHeight
    for (const line of wrapped) {
      page.drawText(line, {
        x: MARGIN + 6,
        y: textY,
        size: textSize,
        font,
        color: rgb(0.15, 0.15, 0.15),
      })
      textY -= lineHeight
    }

    cursorY = cursorY - boxHeight - 12
  }

  const drawSectionTitle = (title: string) => {
    const height = 18
    ensureSpace(height + 10)
    page.drawRectangle({
      x: MARGIN,
      y: cursorY - height,
      width: contentWidth,
      height,
      color: rgb(0.93, 0.95, 0.97),
    })
    page.drawText(title, {
      x: MARGIN + 6,
      y: cursorY - height + 5,
      size: textSize,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    })
    cursorY -= height + 10
  }

  const drawParagraph = (text: string) => {
    const content = text && text.trim().length > 0 ? text : "Sin datos"
    const lines = wrapText(content, font, textSize, contentWidth)
    const height = lines.length * lineHeight + 4
    ensureSpace(height)

    let y = cursorY - lineHeight
    for (const line of lines) {
      page.drawText(line, {
        x: MARGIN,
        y,
        size: textSize,
        font,
        color: rgb(0.15, 0.15, 0.15),
      })
      y -= lineHeight
    }
    cursorY = y - 4
  }

  const drawList = (items: string[]) => {
    const list = items.length > 0 ? items : ["Sin datos"]
    const segments = list.flatMap((item) =>
      wrapText(`- ${item}`, font, textSize, contentWidth)
    )
    const height = segments.length * lineHeight + 4
    ensureSpace(height)

    let y = cursorY - lineHeight
    for (const line of segments) {
      page.drawText(line, {
        x: MARGIN,
        y,
        size: textSize,
        font,
        color: rgb(0.15, 0.15, 0.15),
      })
      y -= lineHeight
    }
    cursorY = y - 4
  }

  startPage()

  const placeLabel = body.placeName?.trim() || "Lugar sin nombre"
  const coordsLabel =
    body.coords && typeof body.coords.lat === "number"
      ? `${body.coords.lat.toFixed(5)}, ${body.coords.lon.toFixed(5)}`
      : "Coordenadas no disponibles"
  const radiusLabel =
    typeof body.radius === "number" ? `${Math.round(body.radius)} m` : "n/d"
  const timestamp =
    body.timestamp && !Number.isNaN(Date.parse(body.timestamp))
      ? new Date(body.timestamp).toLocaleString("es-ES")
      : new Date().toLocaleString("es-ES")

  drawInfoBox([
    `Lugar: ${placeLabel}`,
    `Coords: ${coordsLabel} | Radio: ${radiusLabel}`,
    `Fecha: ${timestamp}`,
  ])

  const adminLines = context ? buildAdminLines(context) : []
  if (adminLines.length > 0) {
    drawSectionTitle("Resumen administrativo")
    drawList(adminLines)
  }

  drawSectionTitle("Descripcion")
  drawParagraph(report.descripcion_zona)

  drawSectionTitle("Infraestructura")
  drawParagraph(report.infraestructura_cercana)

  drawSectionTitle("Riesgos")
  drawParagraph(report.riesgos)

  if (context?.air_quality) {
    drawSectionTitle("Calidad del aire")
    drawParagraph(context.air_quality.details)
    if (context.air_quality.value != null) {
      const unit = context.air_quality.unit ?? context.air_quality.units
      drawParagraph(
        `Valor puntual: ${context.air_quality.value}${unit ? ` ${unit}` : ""}`
      )
    }
  }

  if (context?.environment) {
    drawSectionTitle("Meteorologia actual")
    drawList(buildWeatherLines(context))
  }

  drawSectionTitle("Usos urbanos")
  drawParagraph(report.usos_urbanos)

  drawSectionTitle("Recomendacion")
  drawParagraph(report.recomendacion_final)

  if (context?.environment) {
    const envLines = [
      context.environment.landuse_summary
        ? `Uso del suelo: ${context.environment.landuse_summary}`
        : "Uso del suelo: sin datos",
      context.environment.landuse_osm_summary
        ? `OSM usos: ${context.environment.landuse_osm_summary}`
        : "OSM usos: sin datos",
      context.environment.nearest_waterways.length > 0
        ? `Agua cercana: ${context.environment.nearest_waterways
            .slice(0, 3)
            .map((item) => `${item.name || item.type} (${item.distance_m} m)`)
            .join(" | ")}`
        : "Agua cercana: sin datos",
      context.environment.elevation_m != null
        ? `Elevacion estimada: ${formatNumber(context.environment.elevation_m)} m`
        : "Elevacion estimada: sin datos",
      context.environment.is_coastal === null
        ? "Zona costera: sin datos"
        : context.environment.is_coastal
          ? "Zona costera: si"
          : "Zona costera: no",
    ]
    drawSectionTitle("Entorno")
    drawList(envLines)
  }

  if (context?.wikidata) {
    const wd = context.wikidata
    const header = wd.label ? wd.label : "Entidad cercana"
    const description = wd.description ? ` - ${wd.description}` : ""
    drawSectionTitle("Wikidata")
    drawParagraph(`${header}${description}`)

    const facts =
      wd.facts.length > 0 ? wd.facts.slice(0, 10) : ["Sin datos adicionales."]
    drawList(facts)

    const links = []
    if (wd.wikipedia_url) {
      links.push(`Wikipedia: ${wd.wikipedia_url}`)
    }
    links.push(`Wikidata: ${wd.wikidata_url}`)
    drawList(links)
  }

  if (context?.wikidata_nearby && context.wikidata_nearby.length > 0) {
    drawSectionTitle("Wikidata cercana")
    drawList(buildWikidataNearbyLines(context.wikidata_nearby))
  }

  if (context?.wikipedia_nearby) {
    drawSectionTitle("Wikipedia cercana")
    drawList(buildWikipediaLines(context.wikipedia_nearby))
  }

  if (context?.comparison) {
    const comp = context.comparison
    const baseLine = `Base: ${comp.base.name || "Punto base"} | ${comp.base.coords.lat.toFixed(5)}, ${comp.base.coords.lon.toFixed(5)} | Radio ${comp.base.radius_m} m`
    const targetLine = `Comparado: ${comp.target.name || "Punto comparado"} | ${comp.target.coords.lat.toFixed(5)}, ${comp.target.coords.lon.toFixed(5)} | Radio ${comp.target.radius_m} m`
    const lines = [baseLine, targetLine, ...comp.highlights]
    drawSectionTitle("Comparacion")
    drawList(lines)
  }

  if (context?.pois) {
    drawSectionTitle("POIs destacados")
    drawList(buildPoiLines(context))
  }

  if (context?.external_pois && context.external_pois.length > 0) {
    const externalLines = context.external_pois.slice(0, 6).map((poi) => {
      const distance =
        typeof poi.distance_m === "number" ? `${poi.distance_m} m` : "distancia n/d"
      const category = poi.category ? ` (${poi.category})` : ""
      return `${poi.name}${category} [${poi.source}] ${distance}`
    })
    drawSectionTitle("POIs alternativos")
    drawList(externalLines)
  }

  if (report.limitaciones.length > 0) {
    drawSectionTitle("Limitaciones")
    drawList(report.limitaciones)
  }

  if (report.fuentes.length > 0) {
    drawSectionTitle("Fuentes")
    drawList(report.fuentes)
  }

  const pdfBytes = await pdfDoc.save()

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=informe.pdf",
    },
  })
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
) {
  const words = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\s+/)
    .filter(Boolean)
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    const width = font.widthOfTextAtSize(next, size)
    if (width <= maxWidth) {
      current = next
    } else {
      if (current) lines.push(current)
      current = word
    }
  }

  if (current) lines.push(current)
  return lines.length > 0 ? lines : [""]
}

function buildPoiLines(context: ContextData) {
  const sections = [
    { label: "Restaurantes", items: context.pois.restaurants },
    { label: "Transporte", items: context.pois.transport },
    { label: "Supermercados", items: context.pois.supermarkets },
    { label: "Farmacias", items: context.pois.pharmacies },
    { label: "Hospitales", items: context.pois.hospitals },
  ]

  const lines: string[] = []
  for (const section of sections) {
    if (section.items.length === 0) continue
    const top = section.items.slice(0, 4).map((item) => {
      const typeLabel = item.type ? ` (${item.type})` : ""
      return `${item.name}${typeLabel} - ${item.distance_m} m`
    })
    lines.push(`${section.label}: ${top.join(" | ")}`)
  }

  return lines.length > 0 ? lines : ["Sin POIs en el radio seleccionado"]
}

function buildWeatherLines(context: ContextData) {
  const weather = context.environment.weather
  if (!weather) {
    return ["Sin datos meteorologicos."]
  }

  return [
    `Estado: ${weather.description ?? "sin descripcion"}`,
    `Temperatura: ${formatMetric(weather.temperature_c, "C")}`,
    `Viento: ${formatMetric(weather.wind_kph, "km/h")}`,
    `Precipitacion: ${formatMetric(weather.precipitation_mm, "mm")}`,
    `Hora: ${formatIso(weather.time_iso)}`,
    `Fuente: ${weather.source}`,
  ]
}

function buildWikipediaLines(items: ContextData["wikipedia_nearby"]) {
  if (!items || items.length === 0) return []
  return items.slice(0, 8).map((item) => {
    const distance =
      item.distance_m != null ? `${item.distance_m} m` : "distancia n/d"
    const text = item.description ?? item.extract
    const snippet = text ? ` - ${truncateText(text, 120)}` : ""
    return `${item.title} - ${distance}${snippet}`
  })
}

function buildWikidataNearbyLines(items: ContextData["wikidata_nearby"]) {
  if (!items || items.length === 0) return []
  return items.slice(0, 8).map((item) => {
    const distance =
      item.distance_m != null ? `${item.distance_m} m` : "distancia n/d"
    const label = item.label || item.id
    const desc = item.description ? ` - ${truncateText(item.description, 100)}` : ""
    return `${label} - ${distance}${desc}`
  })
}

function buildAdminLines(context: ContextData) {
  const admin = context.admin
  const populationLine = buildPopulationLine(context)
  const lines: string[] = [populationLine].filter(Boolean)
  if (!admin) return lines

  const roadLine = admin.road
    ? `Via: ${admin.road}${admin.road_type ? ` (${admin.road_type})` : ""}`
    : admin.road_type
      ? `Tipo via: ${admin.road_type}`
      : null

  const adminLines = [
    roadLine,
    admin.municipality ? `Municipio: ${admin.municipality}` : null,
    admin.district ? `Distrito: ${admin.district}` : null,
    admin.province ? `Provincia: ${admin.province}` : null,
    admin.region ? `Comunidad: ${admin.region}` : null,
    admin.postcode ? `CP: ${admin.postcode}` : null,
    admin.country ? `Pais: ${admin.country}` : null,
  ].filter((item): item is string => Boolean(item))

  return [...lines, ...adminLines]
}

function buildPopulationLine(context: ContextData) {
  const population = context.wikidata?.population
  if (typeof population === "number" && Number.isFinite(population)) {
    return `Poblacion: ${formatNumber(population)}`
  }
  return "Poblacion: sin datos"
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMetric(value: number | null, unit: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d"
  return `${new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
  }).format(value)} ${unit}`
}

function formatIso(value: string | null) {
  if (!value) return "n/d"
  return value.replace("T", " ").replace("Z", "")
}

function truncateText(text: string, limit: number) {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit).trim()}...`
}
