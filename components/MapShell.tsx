"use client"

import dynamic from "next/dynamic"

type MapShellProps = {
  initialLat?: number | null
  initialLon?: number | null
  initialRadius?: number | null
}

const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
      Cargando mapa...
    </div>
  ),
})

export default function MapShell({
  initialLat,
  initialLon,
  initialRadius,
}: MapShellProps) {
  return (
    <MapInner
      initialLat={initialLat}
      initialLon={initialLon}
      initialRadius={initialRadius}
    />
  )
}
