import { AppSidebar } from "@/components/app-sidebar"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { SectionCards } from "@/components/section-cards"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import Map from "@/components/Map"


import data from "../app/dashboard/data.json"

export default function Page() {
  return (
    <main className="h-screen p-4">
      <div className="h-full rounded-lg overflow-hidden border">
        <Map />
      </div>
    </main>
  )
}
