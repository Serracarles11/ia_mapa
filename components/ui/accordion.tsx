"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

function Accordion({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("space-y-3", className)} {...props} />
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<"details">) {
  return (
    <details
      className={cn(
        "group rounded-xl border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  ...props
}: React.ComponentProps<"summary">) {
  return (
    <summary
      className={cn(
        "flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium outline-none transition-colors hover:bg-accent/40 [&::-webkit-details-marker]:hidden",
        className
      )}
      {...props}
    />
  )
}

function AccordionContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("px-4 pb-4 pt-1", className)} {...props} />
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
