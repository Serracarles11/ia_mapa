"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { type ComparisonMetrics, type ContextData } from "@/lib/types"
import { cn } from "@/lib/utils"

const sectionClass = "space-y-2"

type ReportViewProps = {
  status: "idle" | "loading" | "ready" | "error"
  report: {
    descripcion_zona: string
    infraestructura_cercana: string
    riesgos: string
    usos_urbanos: string
    recomendacion_final: string
    fuentes: string[]
    limitaciones: string[]
  } | null
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
  const airLabel = airQuality
    ? airQuality.status === "VISUAL_ONLY"
      ? "CAMS visual"
      : airQuality.ok
        ? "CAMS disponible"
        : "CAMS no disponible"
    : "CAMS no disponible"
  const weather = context?.environment.weather ?? null
  const elevation =
    context?.environment.elevation_m ?? context?.wikidata?.elevation_m ?? null
  const wikidataNearby = context?.wikidata_nearby ?? []
  const wikiNearby = context?.wikipedia_nearby ?? []

  const poiSections = buildPoiSections(context)

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
        {context?.admin && (
          <div className="text-xs text-muted-foreground">
            {formatAdmin(context.admin, context.wikidata?.population ?? null)}
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
            Overpass no disponible. Se usan fuentes alternativas.
          </div>
        )}
      </Card>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Resumen</div>
        <p className="text-sm text-muted-foreground">
          {report.descripcion_zona}
        </p>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">POIs</div>
        {poiSections.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {poiSections.map((section, index) => (
              <Card key={`${section.label}-${index}`} className="p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label} ({section.items.length})
                </div>
                {section.items.length === 0 ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Sin datos.
                  </div>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {section.items.slice(0, 4).map((item, itemIndex) => (
                      <li
                        key={`${section.label}-${item.name}-${item.distance_m}-${item.type}-${itemIndex}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>{item.name}</span>
                        <span>{item.distance_m} m</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
            No hay POIs disponibles.
          </div>
        )}
        {context?.external_pois && context.external_pois.length > 0 && (
          <Card className="mt-3 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              POIs adicionales (fuentes alternativas)
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {context.external_pois.slice(0, 6).map((poi, index) => (
                <li key={`${poi.source}-${poi.name}-${index}`}>
                  {poi.name}
                  {poi.category ? ` (${poi.category})` : ""}
                  {poi.distance_m != null ? ` - ${poi.distance_m} m` : ""}
                  {` [${poi.source}]`}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Infraestructura</div>
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
          {floodRisk && floodRisk.status === "VISUAL_ONLY" && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              Datos solo disponibles como capa visual.
            </div>
          )}
          {floodRisk && !floodRisk.ok && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              Servicio de inundacion no disponible.
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{report.riesgos}</p>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Contaminacion / aire</div>
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
          {airQuality?.value != null && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Valor puntual: {airQuality.value}
              {(airQuality.unit ?? airQuality.units)
                ? ` ${airQuality.unit ?? airQuality.units}`
                : ""}
            </div>
          )}
          {airQuality && airQuality.status === "VISUAL_ONLY" && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              Datos solo disponibles como capa visual.
            </div>
          )}
        </div>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Meteorologia actual</div>
        <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground">
          {weather ? (
            <div className="space-y-1">
              <div>
                Estado: {weather.description || "Sin descripcion disponible"}
              </div>
              <div>Temperatura: {formatMetric(weather.temperature_c, "C")}</div>
              <div>Viento: {formatMetric(weather.wind_kph, "km/h")}</div>
              <div>
                Precipitacion: {formatMetric(weather.precipitation_mm, "mm")}
              </div>
              <div>Hora: {formatIso(weather.time_iso)}</div>
              <div className="text-[11px] text-muted-foreground">
                Fuente: {weather.source}
              </div>
            </div>
          ) : (
            <div>Sin datos meteorologicos.</div>
          )}
          {elevation != null && Number.isFinite(elevation) && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Elevacion estimada: {formatMetric(elevation, "m")}
            </div>
          )}
        </div>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Uso del suelo</div>
        <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground">
          <div>
            Copernicus CLC:{" "}
            {context?.land_cover
              ? `${context.land_cover.label} (codigo ${context.land_cover.code})`
              : "Sin datos"}
          </div>
          <div className="mt-1">
            OSM: {context?.environment.landuse_osm_summary || "Sin datos"}
          </div>
          {context?.environment.landuse_osm_counts &&
            Object.keys(context.environment.landuse_osm_counts).length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                OSM categorias:{" "}
                {formatLanduseCounts(context.environment.landuse_osm_counts)}
              </div>
            )}
        </div>
        <p className="text-sm text-muted-foreground">{report.usos_urbanos}</p>
      </section>

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Recomendacion final</div>
        <p className="text-sm text-muted-foreground">{report.recomendacion_final}</p>
      </section>

      {context?.wikidata && (
        <section className={sectionClass}>
          <div className="text-sm font-semibold">Wikidata</div>
          <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground">
            <div className="text-sm font-semibold text-slate-900">
              {context.wikidata.label || "Entidad cercana"}
            </div>
            {context.wikidata.description && (
              <div className="mt-1 text-xs text-muted-foreground">
                {context.wikidata.description}
              </div>
            )}
            {context.wikidata.facts.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {context.wikidata.facts.slice(0, 10).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-2">Sin datos adicionales de Wikidata.</div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {context.wikidata.wikipedia_url && (
                <a
                  href={context.wikidata.wikipedia_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border px-2 py-1 text-[11px] text-slate-600"
                >
                  Wikipedia
                </a>
              )}
              <a
                href={context.wikidata.wikidata_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border px-2 py-1 text-[11px] text-slate-600"
              >
                Wikidata
              </a>
            </div>
          </div>
        </section>
      )}

      {wikidataNearby.length > 0 && (
        <section className={sectionClass}>
          <div className="text-sm font-semibold">Wikidata cercana</div>
          <div className="grid gap-3 md:grid-cols-2">
            {wikidataNearby.slice(0, 6).map((item, index) => (
              <Card key={`${item.id}-${index}`} className="p-3">
                <div className="text-xs font-semibold text-slate-900">
                  {item.label || item.id}
                </div>
                {item.description && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {item.description}
                  </div>
                )}
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {item.distance_m != null
                    ? `${item.distance_m} m`
                    : "Distancia n/d"}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.wikipedia_url && (
                    <a
                      href={item.wikipedia_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border px-2 py-1 text-[11px] text-slate-600"
                    >
                      Wikipedia
                    </a>
                  )}
                  <a
                    href={item.wikidata_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-2 py-1 text-[11px] text-slate-600"
                  >
                    Wikidata
                  </a>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className={sectionClass}>
        <div className="text-sm font-semibold">Wikipedia cercana</div>
        {wikiNearby.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {wikiNearby.slice(0, 6).map((item, index) => (
              <Card key={`${item.pageid}-${index}`} className="p-3">
                <div className="text-xs font-semibold text-slate-900">
                  {item.title}
                </div>
                {item.description && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {item.description}
                  </div>
                )}
                {item.extract && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {truncateText(item.extract, 180)}
                  </p>
                )}
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {item.distance_m != null
                    ? `${item.distance_m} m`
                    : "Distancia n/d"}
                </div>
                {item.url && (
                  <div className="mt-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border px-2 py-1 text-[11px] text-slate-600"
                    >
                      Wikipedia
                    </a>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Sin datos de Wikipedia cercana.
          </div>
        )}
      </section>

      {context?.comparison && (
        <section className={sectionClass}>
          <div className="text-sm font-semibold">Comparacion</div>
          <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Base
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {context.comparison.base.name || "Punto base"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {context.comparison.base.coords.lat.toFixed(5)}, {context.comparison.base.coords.lon.toFixed(5)}
              {` | Radio: ${context.comparison.base.radius_m} m`}
            </div>

            <div className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">
              Comparado con
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {context.comparison.target.name || "Punto comparado"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {context.comparison.target.coords.lat.toFixed(5)}, {context.comparison.target.coords.lon.toFixed(5)}
              {` | Radio: ${context.comparison.target.radius_m} m`}
            </div>

            {context.comparison.highlights.length > 0 && (
              <ul className="mt-3 space-y-1">
                {context.comparison.highlights.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          {(context.comparison.base_metrics ||
            context.comparison.target_metrics) && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {context.comparison.base_metrics && (
                <Card className="p-3 text-xs text-muted-foreground">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Base: {context.comparison.base.name || "Punto base"}
                  </div>
                  {renderComparisonMetrics(context.comparison.base_metrics)}
                </Card>
              )}
              {context.comparison.target_metrics && (
                <Card className="p-3 text-xs text-muted-foreground">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Comparado: {context.comparison.target.name || "Punto comparado"}
                  </div>
                  {renderComparisonMetrics(context.comparison.target_metrics)}
                </Card>
              )}
            </div>
          )}

          <div className="mt-3 rounded-lg border bg-white p-3 text-xs text-muted-foreground">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Opinion IA
            </div>
            {context.comparison.ai_opinion
              ? renderMultiline(context.comparison.ai_opinion)
              : "La IA no ha generado una opinion comparativa."}
          </div>
        </section>
      )}

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

function renderComparisonMetrics(metrics: ComparisonMetrics) {
  const countsLine = formatPoiCounts(metrics.poi_counts)
  return (
    <div className="mt-2 space-y-1">
      <div>
        POIs: {metrics.poi_total}
        {countsLine ? ` (${countsLine})` : ""}
      </div>
      <div>Riesgo inundacion: {metrics.flood_risk}</div>
      <div>Aire: {metrics.air_quality}</div>
      <div>Uso del suelo: {metrics.land_cover}</div>
      <div>Agua cercana: {metrics.waterway}</div>
      <div>
        Zona costera:{" "}
        {metrics.coastal === null ? "sin datos" : metrics.coastal ? "si" : "no"}
      </div>
      {metrics.summary && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          Resumen: {metrics.summary}
        </div>
      )}
      {metrics.recommendation && (
        <div className="text-[11px] text-muted-foreground">
          Recomendacion: {metrics.recommendation}
        </div>
      )}
    </div>
  )
}

function formatAdmin(admin: ContextData["admin"], population: number | null) {
  const roadLine = admin.road
    ? `Via: ${admin.road}${admin.road_type ? ` (${admin.road_type})` : ""}`
    : admin.road_type
      ? `Tipo via: ${admin.road_type}`
      : null
  const populationLine =
    typeof population === "number" && Number.isFinite(population)
      ? `Poblacion: ${formatNumber(population)}`
      : null
  const parts = [
    roadLine,
    populationLine,
    admin.municipality ? `Municipio: ${admin.municipality}` : null,
    admin.district ? `Distrito: ${admin.district}` : null,
    admin.province ? `Provincia: ${admin.province}` : null,
    admin.region ? `Comunidad: ${admin.region}` : null,
    admin.postcode ? `CP: ${admin.postcode}` : null,
    admin.country ? `Pais: ${admin.country}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" | ") : ""
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

function formatLanduseCounts(counts: Record<string, number>) {
  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, value]) => `${key} (${value})`)
  return entries.length > 0 ? entries.join(" | ") : "Sin datos"
}

function formatPoiCounts(counts: Record<string, number>) {
  const entries = Object.entries(counts)
    .filter(([, value]) => typeof value === "number" && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, value]) => `${key} ${value}`)
  return entries.length > 0 ? entries.join(" | ") : ""
}

function truncateText(text: string, limit: number) {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit).trim()}...`
}

function buildPoiSections(context: ContextData | null) {
  if (!context) return []
  return [
    { label: "Restaurantes", items: context.pois.restaurants },
    { label: "Bares y clubes", items: context.pois.bars_and_clubs },
    { label: "Cafes", items: context.pois.cafes },
    { label: "Supermercados", items: context.pois.supermarkets },
    { label: "Transporte", items: context.pois.transport },
    { label: "Hoteles", items: context.pois.hotels },
    {
      label: "Turismo",
      items: [
        ...context.pois.tourism,
        ...context.pois.museums,
        ...context.pois.viewpoints,
      ],
    },
    {
      label: "Infraestructura (salud/educacion)",
      items: [
        ...context.pois.pharmacies,
        ...context.pois.hospitals,
        ...context.pois.schools,
      ],
    },
  ]
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
