"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Search } from "lucide-react"

type SearchBarProps = {
  value: string
  onChange: (value: string) => void
  onSearch: () => void
  loading?: boolean
}

export default function SearchBar({
  value,
  onChange,
  onSearch,
  loading = false,
}: SearchBarProps) {
  return (
    <div className="flex w-full items-center gap-2">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onSearch()
          }
        }}
        placeholder="Escribe una direccion o lugar"
        className="h-10"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            onClick={onSearch}
            disabled={loading}
            className="h-10"
          >
            <Search className="size-4" />
            Buscar
          </Button>
        </TooltipTrigger>
        <TooltipContent>Buscar coordenadas</TooltipContent>
      </Tooltip>
    </div>
  )
}
