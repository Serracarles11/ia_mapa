"use client"

import { Toggle } from "@/components/ui/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type LayerState = {
  osm: boolean
  ign: boolean
  pnoa: boolean
  clc: boolean
  flood: boolean
}

export type LayerKey = keyof LayerState

type LayerControlsProps = {
  layers: LayerState
  onToggle: (layer: LayerKey, next: boolean) => void
  floodDisabled?: boolean
  floodHint?: string
  floodStatus?: "OK" | "DOWN" | null
}

type SwitchRowProps = {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  tooltip?: string
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  tooltip,
}: SwitchRowProps) {
  const tooltipText =
    tooltip ?? (checked ? "Activada" : "Desactivada")

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex", disabled && "cursor-not-allowed")}>
            <Toggle
              pressed={checked}
              onPressedChange={onChange}
              disabled={disabled}
              className={cn(
                "relative h-6 w-11 rounded-full border border-slate-300 bg-slate-100 p-0 shadow-inner transition",
                "data-[state=on]:border-emerald-500 data-[state=on]:bg-emerald-500",
                disabled && "opacity-60"
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
                  checked && "translate-x-5"
                )}
              />
            </Toggle>
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default function LayerControls({
  layers,
  onToggle,
  floodDisabled,
  floodHint,
  floodStatus,
}: LayerControlsProps) {
  const floodDescription =
    floodStatus === "DOWN"
      ? "Servicio de inundacion no disponible"
      : "Zonas inundables oficiales (WMS)"

  return (
    <div className="space-y-3">
      <SwitchRow
        label="OSM"
        description="Base cartografica de OpenStreetMap"
        checked={layers.osm}
        onChange={(value) => onToggle("osm", value)}
      />
      <SwitchRow
        label="IGN base"
        description="Mapa base IGN (callejero)"
        checked={layers.ign}
        onChange={(value) => onToggle("ign", value)}
      />
      <SwitchRow
        label="PNOA"
        description="Ortofoto PNOA (satelite)"
        checked={layers.pnoa}
        onChange={(value) => onToggle("pnoa", value)}
      />
      <SwitchRow
        label="Copernicus CLC"
        description="Cobertura de usos del suelo CLC"
        checked={layers.clc}
        onChange={(value) => onToggle("clc", value)}
      />
      <SwitchRow
        label="Inundacion (oficial)"
        description={floodDescription}
        checked={layers.flood}
        onChange={(value) => onToggle("flood", value)}
        disabled={floodDisabled}
        tooltip={floodHint}
      />
    </div>
  )
}
