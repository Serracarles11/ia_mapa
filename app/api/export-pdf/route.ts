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
  const page = pdfDoc.addPage([595, 842])
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const margin = 50
  const maxWidth = 595 - margin * 2
  let cursorY = 842 - margin
  const lineHeight = 14
  const titleSize = 16
  const textSize = 11

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

  cursorY = drawTextLine(page, fontBold, titleSize, margin, cursorY, "Informe geoespacial")
  cursorY = drawTextLine(
    page,
    font,
    textSize,
    margin,
    cursorY - 6,
    `${placeLabel} | ${coordsLabel} | Radio ${radiusLabel}`
  )
  cursorY = drawTextLine(
    page,
    font,
    textSize,
    margin,
    cursorY,
    `Fecha: ${timestamp}`
  )
  cursorY -= 10

  cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Descripcion")
  cursorY = drawParagraph(page, font, textSize, margin, cursorY, report.descripcion_zona)

  cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Infraestructura")
  cursorY = drawParagraph(page, font, textSize, margin, cursorY, report.infraestructura_cercana)

  cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Riesgos")
  cursorY = drawParagraph(page, font, textSize, margin, cursorY, report.riesgos)

  if (context?.air_quality) {
    cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Calidad del aire")
    cursorY = drawParagraph(page, font, textSize, margin, cursorY, context.air_quality.details)
  }

  cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Usos urbanos")
  cursorY = drawParagraph(page, font, textSize, margin, cursorY, report.usos_urbanos)

  cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Recomendacion")
  cursorY = drawParagraph(page, font, textSize, margin, cursorY, report.recomendacion_final)

  if (context?.environment) {
    const envLines = [
      context.environment.landuse_summary
        ? `Uso del suelo: ${context.environment.landuse_summary}`
        : "Uso del suelo: sin datos",
      context.environment.nearest_waterways.length > 0
        ? `Agua cercana: ${context.environment.nearest_waterways
            .slice(0, 3)
            .map((item) => `${item.name || item.type} (${item.distance_m} m)`)
            .join(" | ")}`
        : "Agua cercana: sin datos",
      context.environment.is_coastal === null
        ? "Zona costera: sin datos"
        : context.environment.is_coastal
          ? "Zona costera: si"
          : "Zona costera: no",
    ]
    cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Entorno")
    cursorY = drawList(page, font, textSize, margin, cursorY, envLines)
  }

  if (context?.pois) {
    cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "POIs destacados")
    const poiLines = buildPoiLines(context)
    cursorY = drawList(page, font, textSize, margin, cursorY, poiLines)
  }

  if (report.limitaciones.length > 0) {
    cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Limitaciones")
    cursorY = drawList(page, font, textSize, margin, cursorY, report.limitaciones)
  }

  if (report.fuentes.length > 0) {
    cursorY = drawSectionTitle(page, fontBold, margin, cursorY, "Fuentes")
    cursorY = drawList(page, font, textSize, margin, cursorY, report.fuentes)
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

function drawTextLine(
  page: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  text: string
) {
  page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) })
  return y - size - 4
}

function drawSectionTitle(
  page: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  x: number,
  y: number,
  title: string
) {
  const nextY = y - 10
  page.drawText(title, { x, y: nextY, size: 12, font, color: rgb(0.1, 0.1, 0.1) })
  return nextY - 6
}

function drawParagraph(
  page: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  text: string
) {
  const lines = wrapText(text, font, size, 595 - x * 2)
  let cursor = y
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, size, font, color: rgb(0.15, 0.15, 0.15) })
    cursor -= size + 4
  }
  return cursor - 4
}

function drawList(
  page: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  items: string[]
) {
  let cursor = y
  const list = items.length > 0 ? items : ["Sin datos"]
  for (const item of list) {
    const line = `- ${item}`
    const wrapped = wrapText(line, font, size, 595 - x * 2)
    for (const segment of wrapped) {
      page.drawText(segment, { x, y: cursor, size, font, color: rgb(0.15, 0.15, 0.15) })
      cursor -= size + 4
    }
  }
  return cursor - 4
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
