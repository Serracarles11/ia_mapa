import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import "leaflet/dist/leaflet.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "IA Maps",
  description: "Analisis territorial con mapas y asistente inteligente",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full overflow-hidden">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen overflow-hidden antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
