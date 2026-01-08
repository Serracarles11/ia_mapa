"use client"

import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMapEvent,
} from "react-leaflet"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import L, { type LeafletMouseEvent } from "leaflet"
import SidePanel, { type SidePanelData } from "@/components/SidePanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import {
  Copy,
  Eraser,
  Github,
  Loader2,
  LocateFixed,
  MapPin,
} from "lucide-react"

const RADIUS_OPTIONS = [500, 800, 1200, 2000]

function ClickHandler({
  onClick,
}: {
  onClick: (lat: number, lon: number) => void
}) {
  useMapEvent("click", (event: LeafletMouseEvent) => {
    onClick(event.latlng.lat, event.latlng.lng)
  })
  return null
}

type MapInnerProps = {
  initialLat?: number | null
  initialLon?: number | null
  initialRadius?: number | null
}

type AnalyzeResponse = {
  ok: boolean
  request_id?: number | null
  placeName?: string | null
  contextData?: SidePanelData["context"] | null
  overpass_ok?: boolean
  overpass_error?: string | null
  status?: "OK" | "NO_POIS" | "OVERPASS_DOWN"
  aiReport?: SidePanelData["report"]
  fallbackReport?: SidePanelData["report"] | null
  warnings?: string[]
  warning?: string | null
  error?: string
}

export default function MapInner({
  initialLat,
  initialLon,
  initialRadius,
}: MapInnerProps) {
  const [radiusMeters, setRadiusMeters] = useState(() => {
    const initial =
      typeof initialRadius === "number" && initialRadius > 0
        ? Math.round(initialRadius)
        : 1200
    return RADIUS_OPTIONS.includes(initial) ? initial : 1200
  })
  const [position, setPosition] = useState<[number, number] | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  )
  const [activePoi, setActivePoi] = useState<{
    name: string
    lat: number
    lon: number
    distance_m?: number
    type?: string
  } | null>(null)
  const [panelData, setPanelData] = useState<SidePanelData>({
    placeName: null,
    report: null,
    aiReport: null,
    context: null,
    warning: null,
    coords: null,
    requestId: null,
    status: null,
    overpassOk: null,
    overpassError: null,
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const lastGoodRef = useRef<SidePanelData | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const poiMarkerRef = useRef<L.Marker | null>(null)
  const autoAnalyzeRef = useRef(false)

  const initialCenter = useMemo<[number, number]>(() => {
    if (typeof initialLat === "number" && typeof initialLon === "number") {
      return [initialLat, initialLon]
    }
    return [38.9607, 1.4138]
  }, [initialLat, initialLon])

  useEffect(() => {
    if (typeof window === "undefined") return
    type IconDefaultPrototype = { _getIconUrl?: () => string }
    const iconDefaultPrototype = L.Icon.Default
      .prototype as IconDefaultPrototype
    delete iconDefaultPrototype._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    })
  }, [])

  useEffect(() => {
    if (activePoi && poiMarkerRef.current) {
      poiMarkerRef.current.openPopup()
    }
  }, [activePoi])

  function handleRadiusChange(nextRadius: number) {
    setRadiusMeters(nextRadius)
    if (position) {
      analyzePlace(position[0], position[1], nextRadius)
    }
  }

  const analyzePlace = useCallback(
    async (lat: number, lon: number, radius: number) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      setStatus("loading")
      setErrorMessage(null)
      setActivePoi(null)
      setPanelData((prev) => ({
        ...prev,
        placeName: null,
        report: null,
        aiReport: null,
        context: null,
        warning: null,
        coords: { lat, lon },
        requestId,
        status: null,
        overpassOk: null,
        overpassError: null,
      }))

      try {
        const res = await fetch("/api/analyze-place", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            center: { lat, lon },
            radius_m: radius,
            request_id: requestId,
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(errorText || "No se pudo analizar el lugar.")
        }

        const data = (await res.json()) as AnalyzeResponse
        const responseId = data.request_id ?? requestId
        if (responseId !== requestIdRef.current) return
        if (!data.ok) {
          throw new Error(data.error || "No se pudo analizar el lugar.")
        }

        const responseStatus = data.status ?? "OK"
        const isOverpassDown = responseStatus === "OVERPASS_DOWN"
        const warnings =
          Array.isArray(data.warnings) && data.warnings.length > 0
            ? data.warnings
            : data.warning
              ? [data.warning]
              : []
        if (warnings.length > 0) {
          console.debug("Avisos de analisis", warnings)
        }
        const nextData: SidePanelData = {
          placeName: data.placeName ?? null,
          report: data.aiReport ?? data.fallbackReport ?? null,
          aiReport: data.aiReport ?? null,
          context: data.contextData ?? null,
          warning: warnings.length > 0 ? warnings.join(" | ") : null,
          coords:
            isOverpassDown && data.contextData
              ? {
                  lat: data.contextData.center.lat,
                  lon: data.contextData.center.lon,
                }
              : { lat, lon },
          requestId: responseId,
          status: responseStatus,
          overpassOk: data.overpass_ok ?? null,
          overpassError: data.overpass_error ?? null,
        }

        if (isOverpassDown) {
          const fallback = lastGoodRef.current
          const fallbackCoords = fallback?.coords ?? nextData.coords
          setPanelData({
            ...nextData,
            report: fallback?.report ?? nextData.report,
            context: fallback?.context ?? nextData.context,
            placeName: nextData.placeName ?? fallback?.placeName ?? null,
            coords: fallbackCoords,
            warning: nextData.warning ?? "Overpass no disponible",
          })
        } else {
          setPanelData(nextData)
          if (
            (responseStatus === "OK" || responseStatus === "NO_POIS") &&
            nextData.report
          ) {
            lastGoodRef.current = nextData
          }
        }

        setStatus("ready")
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        console.debug("Fallo al analizar lugar", err)
        const message =
          err instanceof Error ? err.message : "No se pudo analizar el lugar."
        setErrorMessage(
          message.includes("Groq") || message.includes("json")
            ? "No se pudo generar el informe en este momento."
            : "No se pudo analizar el lugar."
        )
        setStatus("error")
      }
    },
    []
  )

  useEffect(() => {
    if (autoAnalyzeRef.current) return
    if (typeof initialLat !== "number" || typeof initialLon !== "number") {
      return
    }
    const nextRadius =
      typeof initialRadius === "number" && initialRadius > 0
        ? Math.round(initialRadius)
        : radiusMeters
    const normalizedRadius = RADIUS_OPTIONS.includes(nextRadius)
      ? nextRadius
      : radiusMeters
    autoAnalyzeRef.current = true
    setRadiusMeters(normalizedRadius)
    setPosition([initialLat, initialLon])
    analyzePlace(initialLat, initialLon, normalizedRadius)
    mapRef.current?.setView([initialLat, initialLon], 14, { animate: false })
  }, [initialLat, initialLon, initialRadius, radiusMeters, analyzePlace])

  async function handleCopyCoords() {
    if (!position) return
    const text = `${position[0].toFixed(5)}, ${position[1].toFixed(5)}`
    try {
      await navigator.clipboard.writeText(text)
      setCopyNotice("Coordenadas copiadas")
    } catch (error) {
      console.debug("No se pudieron copiar las coordenadas", error)
      setCopyNotice("No se pudo copiar")
    } finally {
      window.setTimeout(() => setCopyNotice(null), 1500)
    }
  }

  function handleCenter() {
    const target =
      position ??
      (panelData.coords
        ? [panelData.coords.lat, panelData.coords.lon]
        : null)
    if (!target || !mapRef.current) return
    mapRef.current.flyTo(target, mapRef.current.getZoom(), { animate: true })
  }

  function handleClear() {
    abortRef.current?.abort()
    setPosition(null)
    setActivePoi(null)
    setStatus("idle")
    setErrorMessage(null)
    setPanelData({
      placeName: null,
      report: null,
      aiReport: null,
      context: null,
      warning: null,
      coords: null,
      requestId: null,
      status: null,
      overpassOk: null,
      overpassError: null,
    })
  }

  function handleRetry() {
    const target =
      position ??
      (panelData.coords
        ? [panelData.coords.lat, panelData.coords.lon]
        : null)
    if (!target) return
    setPosition([target[0], target[1]])
    analyzePlace(target[0], target[1], radiusMeters)
  }

  const overpassBadge = useMemo(() => {
    if (panelData.overpassOk === null) {
      return { label: "Overpass en espera", tone: "muted" as const }
    }
    if (panelData.overpassOk) {
      return { label: "Overpass OK", tone: "ok" as const }
    }
    return { label: "Overpass down", tone: "error" as const }
  }, [panelData.overpassOk])

  const groqBadge = useMemo(() => {
    if (status === "idle") {
      return { label: "IA en espera", tone: "muted" as const }
    }
    if (panelData.aiReport) {
      return { label: "IA OK", tone: "ok" as const }
    }
    if (panelData.report) {
      return { label: "IA fallback", tone: "warn" as const }
    }
    return { label: "IA sin datos", tone: "error" as const }
  }, [panelData.aiReport, panelData.report, status])

  const badgeToneClass = (tone: "ok" | "warn" | "error" | "muted") =>
    cn(
      "border",
      tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-700",
      tone === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
      tone === "error" && "border-rose-200 bg-rose-50 text-rose-700",
      tone === "muted" && "border-slate-200 bg-slate-50 text-slate-600"
    )

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#f8f7f3]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_10%_0%,rgba(16,185,129,0.18),transparent_60%),radial-gradient(50%_50%_at_90%_0%,rgba(251,191,36,0.2),transparent_55%)]" />
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-sm">
              IA
            </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">
              IA Maps
            </div>
            <div className="text-xs text-muted-foreground">
              Analisis territorial y entorno inmediato
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
            <Badge className={badgeToneClass(overpassBadge.tone)}>
              {overpassBadge.label}
            </Badge>
            <Badge className={badgeToneClass(groqBadge.tone)}>
              {groqBadge.label}
            </Badge>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                <Github className="size-4" />
                GitHub
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-base">Mapa interactivo</CardTitle>
              <CardDescription>
                Haz click en el mapa para analizar el entorno y recibir un
                informe completo.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Radio
                </span>
                <ToggleGroup
                  type="single"
                  value={String(radiusMeters)}
                  onValueChange={(value) => {
                    const parsed = Number(value)
                    if (!Number.isNaN(parsed)) {
                      handleRadiusChange(parsed)
                    }
                  }}
                  variant="outline"
                  size="sm"
                  spacing={0}
                >
                  {RADIUS_OPTIONS.map((option) => (
                    <ToggleGroupItem key={option} value={String(option)}>
                      {option} m
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Separator orientation="vertical" className="mx-1 h-6" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCoords}
                  disabled={!position}
                >
                  <Copy className="size-4" />
                  Copiar coords
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCenter}
                  disabled={!position}
                >
                  <LocateFixed className="size-4" />
                  Recentrar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  disabled={!position && status === "idle"}
                >
                  <Eraser className="size-4" />
                  Limpiar
                </Button>
                {status === "loading" && (
                  <Badge className="border-blue-200 bg-blue-50 text-blue-700">
                    <Loader2 className="size-3 animate-spin" />
                    Analizando...
                  </Badge>
                )}
                {copyNotice && (
                  <span className="text-xs text-muted-foreground">
                    {copyNotice}
                  </span>
                )}
              </div>

              <div className="relative flex-1 min-h-[200px] w-full overflow-hidden rounded-xl border bg-muted/30">
                <MapContainer
                  center={initialCenter}
                  zoom={12}
                  className={cn(
                    "h-full w-full",
                    status === "loading" ? "cursor-wait" : "cursor-crosshair"
                  )}
                  whenCreated={(mapInstance) => {
                    mapRef.current = mapInstance
                  }}
                >
                  <TileLayer
                    attribution="(c) OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  <ClickHandler
                    onClick={(nextLat, nextLon) => {
                      setPosition([nextLat, nextLon])
                      mapRef.current?.flyTo([nextLat, nextLon], 14, {
                        animate: true,
                      })
                      analyzePlace(nextLat, nextLon, radiusMeters)
                    }}
                  />

                  {position && (
                    <>
                      <Circle
                        center={position}
                        radius={radiusMeters}
                        pathOptions={{
                          color: "#0f766e",
                          fillColor: "#99f6e4",
                          fillOpacity: 0.2,
                        }}
                      />
                      <Marker position={position}>
                        <Popup>
                          <div className="space-y-1 text-xs">
                            <div className="font-semibold">Punto analizado</div>
                            <div>
                              Lat: {position[0].toFixed(5)} | Lon:{" "}
                              {position[1].toFixed(5)}
                            </div>
                            <div>Radio: {radiusMeters} m</div>
                          </div>
                        </Popup>
                        <Tooltip direction="top" offset={[0, -10]} permanent>
                          <div className="text-xs font-medium">Punto base</div>
                        </Tooltip>
                      </Marker>
                    </>
                  )}

                  {activePoi && (
                    <Marker
                      position={[activePoi.lat, activePoi.lon]}
                      ref={(marker) => {
                        poiMarkerRef.current = marker
                      }}
                    >
                      <Popup>
                        <div className="space-y-1 text-xs">
                          <div className="font-semibold">{activePoi.name}</div>
                          {activePoi.type && (
                            <div className="text-muted-foreground">
                              Tipo: {activePoi.type}
                            </div>
                          )}
                          {typeof activePoi.distance_m === "number" && (
                            <div>Distancia: {activePoi.distance_m} m</div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
                {status === "loading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/65 text-sm font-medium text-slate-700">
                    Analizando entorno...
                  </div>
                )}
                {!position && status === "idle" && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full border bg-white/80 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                      <MapPin className="mr-1 inline-block size-3" />
                      Haz click para analizar un punto
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex min-h-0 flex-1 flex-col lg:w-[420px] lg:flex-none">
            <SidePanel
              status={status}
              data={panelData}
              errorMessage={errorMessage}
              selectedRadius={radiusMeters}
              onRetry={handleRetry}
              onClearSelection={handleClear}
              onCenter={handleCenter}
              onViewPoi={(poi) => {
                if (!mapRef.current) return
                setActivePoi(poi)
                mapRef.current.flyTo([poi.lat, poi.lon], 16, { animate: true })
              }}
              onRadiusSuggestion={(suggested) => {
                handleRadiusChange(suggested)
              }}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
