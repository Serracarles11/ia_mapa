"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { type AiReport, type ContextData } from "@/lib/types"
import { cn } from "@/lib/utils"

const sectionClass = "space-y-2"

type ReportViewProps = {
  status: "idle" | "loading" | "ready" | "error"
  report: AiReport | null
  aiReport: AiReport | null
  context: ContextData | null
  placeName: string | null
  coords: { lat: number; lon: number } | null
  radius: number
  warning: string | null
  statusCode: "OK" | "NO_POIS" | "OVERPASS_DOWN" | null
  errorMessage: string | null
  onRetry: () => void
}

export default function ReportView({
  status,
  report,
  aiReport,
  context,
  placeName,
  coords,
  radius,
  warning,
  statusCode,
  errorMessage,
  onRetry,
}: ReportViewProps) {
  if (status === "idle") {
    return (
      <div className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">
        Selecciona un punto en el mapa o busca una direccion para generar el informe.
      </div>
    )
  }

  if (status === "loading") {
    return <ReportSkeleton />
  }

  if (status === "error") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage || "No se pudo generar el informe."}
        </div>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Reintentar analisis
        </Button>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">
        No hay datos suficientes para mostrar un informe.
      </div>
    )
  }

  const floodRisk = context?.flood_risk ?? null
  const airQuality = context?.air_quality ?? null
  const airStatus = context?.risks.air.status ?? null
  const riskLabel = floodRisk
    ? floodRisk.risk_level === "alto"
      ? "Alto"
      : floodRisk.risk_level === "medio"
        ? "Medio"
        : floodRisk.risk_level === "bajo"
          ? "Bajo"
          : "Desconocido"
    : "Desconocido"
  const riskToneClass = cn(
    "border",
    floodRisk?.risk_level === "alto" && "border-rose-200 bg-rose-50 text-rose-700",
    floodRisk?.risk_level === "medio" && "border-amber-200 bg-amber-50 text-amber-700",
    floodRisk?.risk_level === "bajo" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    (!floodRisk || floodRisk.risk_level === "desconocido") &&
      "border-slate-200 bg-slate-50 text-slate-600"
  )
  const airToneClass = cn(
    "border",
    airQuality?.ok && "border-sky-200 bg-sky-50 text-sky-700",
    airQuality && !airQuality.ok && "border-slate-200 bg-slate-50 text-slate-600",
    !airQuality && "border-slate-200 bg-slate-50 text-slate-600"
  )
  const airLabel =
    airStatus === "VISUAL_ONLY"
      ? "CAMS visual"
      : airQuality?.ok
        ? "CAMS disponible"
        : "CAMS no disponible"

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{statusCode ?? "OK"}</Badge>
          {warning && <Badge variant="destructive">Aviso</Badge>}
        </div>
        <div className="text-sm font-semibold text-slate-900">
          {placeName || "Lugar sin nombre"}
        </div>
        <div className="text-xs text-muted-foreground">
          {coords
            ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
            : "Coordenadas no disponibles"}
          {` | Radio: ${radius} m`}
        </div>
        {context?.place?.addressLine && (
          <div className="text-xs text-muted-foreground">
            {context.place.addressLine}
          </div>
        )}
        {context?.place?.municipality && (
          <div className="text-xs text-muted-foreground">
            Municipio: {context.place.municipality}
          </div>
        )}
        {warning && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {warning}
          </div>
        )}
        {statusCode === "NO_POIS" && (
          <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            No hay POIs dentro del radio. Prueba con un radio mayor.
          </div>
        )}
        {statusCode === "OVERPASS_DOWN" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Overpass no disponible. Mostrando ultimo informe valido.
          </div>
        )}
      </Card>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Descripcion de la zona</div>
        <p className="text-sm text-muted-foreground">
          {report.descripcion_zona}
        </p>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Infraestructura cercana</div>
        {renderMultiline(report.infraestructura_cercana)}
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Riesgos</div>
        <div className="rounded-lg border bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className={riskToneClass}>Riesgo {riskLabel}</Badge>
            <span className="text-xs text-muted-foreground">
              Fuente: {floodRisk?.source ?? "Sin datos"}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {floodRisk?.details ?? "No hay datos de inundacion disponibles."}
          </p>
          {floodRisk && !floodRisk.ok && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              Servicio de inundacion no disponible
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{report.riesgos}</p>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Calidad del aire</div>
        <div className="rounded-lg border bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className={airToneClass}>{airLabel}</Badge>
            <span className="text-xs text-muted-foreground">
              Fuente: {airQuality?.source ?? "Copernicus CAMS"}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {airQuality?.details ??
              "No hay datos de calidad del aire disponibles."}
          </p>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Posibles usos urbanos</div>
        <p className="text-sm text-muted-foreground">{report.usos_urbanos}</p>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Recomendacion final</div>
        <p className="text-sm text-muted-foreground">{report.recomendacion_final}</p>
      </section>

      {report.fuentes.length > 0 && (
        <section className={sectionClass}>
          <div className="text-sm font-semibold">Fuentes</div>
          <div className="flex flex-wrap gap-2">
            {report.fuentes.map((fuente, index) => (
              <Badge key={`${fuente}-${index}`} variant="outline">
                {fuente}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {report.limitaciones.length > 0 && (
        <section className={sectionClass}>
          <div className="text-sm font-semibold">Limitaciones</div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {report.limitaciones.map((item, index) => (
              <li key={`${item}-${index}`} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {context && context.pois.restaurants.length > 0 && (
        <section className={cn(sectionClass, "rounded-xl border bg-muted/40 p-3")}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Restaurantes cercanos
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {context.pois.restaurants.slice(0, 4).map((item, index) => (
              <li
                key={`${item.type}-${item.name}-${item.distance_m}-${index}`}
                className="flex items-center justify-between gap-2"
              >
                <span>{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.distance_m} m
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {context && (
        <section className={sectionClass}>
          <div className="text-sm font-semibold">Entorno</div>
          <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground">
            <div>
              Uso del suelo:{" "}
              {context.environment.landuse_summary || "Sin datos"}
            </div>
            <div>
              Agua cercana:{" "}
              {context.environment.nearest_waterways.length > 0
                ? context.environment.nearest_waterways
                    .slice(0, 3)
                    .map(
                      (item) =>
                        `${item.name || item.type} (${item.distance_m} m)`
                    )
                    .join(" | ")
                : "Sin datos"}
            </div>
            <div>
              Zona costera:{" "}
              {context.environment.is_coastal === null
                ? "Sin datos"
                : context.environment.is_coastal
                  ? "si"
                  : "no"}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function renderMultiline(text: string) {
  const lines = text.split("\n").map((line) => line.trim())
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      {lines.map((line, index) => (
        <p key={`${line}-${index}`}>{line}</p>
      ))}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
