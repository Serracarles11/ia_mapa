IA Maps es una app Next.js (App Router) que analiza un punto del mapa con OpenStreetMap, Copernicus (CLC/EFAS/CAMS), IGN, Wikidata, Wikipedia, Open-Meteo y Geoapify.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Configuracion rapida

- Copia `.env.local.example` a `.env.local`.
- Completa `GROQ_API_KEY` si quieres IA Groq.
- Completa `GEOAPIFY_API_KEY` para enriquecer POIs cuando Overpass cae.
- Wikipedia y Open-Meteo no requieren key; puedes ajustar endpoints con `WIKIPEDIA_API_URL` y `OPEN_METEO_API_URL`.
- (Opcional) `OPEN_SKY_USERNAME` y `OPEN_SKY_PASSWORD` para mejorar limites de OpenSky.
- (Opcional) `NEXT_PUBLIC_AIRCRAFT_REFRESH_MS` para ajustar el refresco ADS-B.
- Las capas Copernicus/EFAS/CAMS funcionan con endpoints publicos; el token es opcional.

### Capas disponibles

- Inundacion: Copernicus EFAS (WMS). Fallback a MITECO WMS si EFAS falla.
- Aire: Copernicus CAMS (WMS) con capa PM2.5.
- Uso del suelo: Copernicus CLC 2018.
- Base cartografica: OSM / IGN / PNOA.
- Aviones: OpenSky (tiempo real) alrededor del punto, con modo demo si hay rate limit.

### Funciones destacadas

- Comparar dos sitios y anadir la comparacion al informe.
- Contexto ampliado con Wikidata + Geoapify + resumen OSM de usos del suelo.
- Meteorologia actual (Open-Meteo) y Wikipedia cercana para dar mas contexto del lugar.
- Informe determinista si la IA falla o devuelve JSON invalido.

### Limitaciones

- EFAS/CAMS son capas WMS; el muestreo puntual puede no estar disponible. En ese caso se indica "capa visual".
- Overpass puede estar temporalmente caido; se usan fuentes alternativas (Wikidata/Geoapify/CLC/IGN).
- OpenSky puede rate-limit; en ese caso se muestran datos demo.

### Rutas API

- `POST /api/analyze-place`: analiza un punto y devuelve contexto ampliado.
- `POST /api/place-chat`: chat con herramientas basadas en OSM.
- `POST /api/export-pdf`: exporta el informe visible en PDF.
- `POST /api/aircraft`: trafico aereo en tiempo real alrededor del punto.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
