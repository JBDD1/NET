# Finova

Gestión financiera personal: patrimonio neto, transacciones, cartera de inversión, dividendos, metas de ahorro, fiscalidad y un asesor con IA. Frontend en JavaScript vanilla (sin framework) + backend Node.js propio, con Firebase Authentication.

## Arquitectura

- **Frontend**: HTML/CSS/JS clásico (sin bundler en tiempo de ejecución de desarrollo local). Los módulos viven en `src/` y se cargan como `<script>` clásicos desde `index.html` / `landing.html`, en el orden declarado ahí (importa mucho: cada módulo depende de que los anteriores ya estén cargados).
- **Build de producción**: [Vite](https://vitejs.dev) (`vite.config.js`) empaqueta `index.html` y `landing.html`, minifica con Terser y copia el resto de estáticos (iconos, `manifest.json`, `sw.js`, páginas legales) a `dist/`. Se despliega en **Vercel** como sitio estático.
- **Backend**: `server.cjs` — un servidor HTTP en Node puro (sin Express). Se despliega en **Railway**. Expone `/api/*` (datos de usuario, IA, cotizaciones, Open Banking vía GoCardless, panel admin) y, en local, también sirve los archivos estáticos del frontend.
- **Proxy Vercel → Railway**: `api/[...path].js` es una función serverless de Vercel que reenvía cualquier `/api/*` al backend de Railway, añadiendo una cabecera secreta compartida (`FINOVA_PROXY_SECRET`) para que Railway solo acepte tráfico que pase por ese proxy.
- **Autenticación**: Firebase Authentication (Email/Password + Google). El backend verifica el ID token de Firebase en cada petición autenticada (con Firebase Admin SDK si está configurado, o verificación JWT propia como fallback) — el `uid` nunca se confía desde el cliente.
- **Datos de usuario**: JSON cifrado (AES-256-GCM) por usuario en `data/users/<uid>.json` en el disco del backend. No hay base de datos SQL ni NoSQL: todo el acceso pasa por `/api/user-data`, con el `uid` derivado siempre del token verificado.

## Estructura del proyecto

```
/
├── src/
│   ├── core/       — motor de la app (estado, navegación, storage, IA, orquestador)
│   ├── sections/   — una vista/sección del dashboard por archivo
│   ├── auth/       — flujo de autenticación con Firebase
│   ├── utils/      — utilidades (premium, PDF, tickers, onboarding, banca)
│   └── tests/      — tests con Jest
├── server.cjs      — backend (Railway)
├── api/            — proxy serverless (Vercel → Railway)
├── index.html, landing.html, style.css, sw.js, manifest.json, icon*.png/svg
│                   — app y assets públicos (raíz = "public" de facto para Vite y server.cjs)
├── privacy.html, privacidad.html, terms.html, terminos.html — páginas legales (EN/ES)
├── branding/       — kit de marca (logo fuente, iconos generados en más formatos/tamaños)
├── scripts/        — scripts de utilidad (generación de iconos, release)
├── docs/           — documentación del proyecto (setup de GitHub/CI, convención de commits, design tokens)
├── data/           — estado runtime del backend (ignorado por git salvo estructura)
└── vite.config.js, vercel.json, jest.config.js, package.json
```

## Instalación

```bash
npm install
```

## Desarrollo

Dos servidores en paralelo:

```bash
npm run start   # backend Node en http://localhost:3000 (sirve también el frontend sin Vite)
npm run dev     # Vite con hot-reload en http://localhost:5173, proxy /api → localhost:3000
```

Para desarrollo diario usa `npm run dev`. `npm run start` sirve el frontend "en crudo" (sin transformar `import.meta.env`, sin HMR) — útil para probar el comportamiento exacto del backend, o vía `Iniciar Finova.bat` en Windows.

## Build de producción

```bash
npm run build      # genera dist/ (modo production: sin console.log, sin source maps, minificado)
npm run preview    # sirve dist/ localmente para verificar el build
```

## Tests

```bash
npm test                # toda la suite (src/tests/**/*.test.js)
npm run test:isolation  # solo el test de aislamiento entre usuarios (IDOR)
```

## Variables de entorno

Ver [`.env.example`](.env.example) para el resumen y [`.env.server.example`](.env.server.example) para la lista completa de variables del backend con explicación de cada una.

- **Frontend** (`VITE_*`): siempre públicas (terminan en el navegador). Ya están en `.env.development` / `.env.production`, commiteadas con valores reales porque son la configuración pública de cliente de Firebase — no secretos.
- **Backend** (Railway, `server.cjs`): secretos reales. Nunca se commitean. Cópialos desde `.env.server.example` a Railway → tu proyecto → Variables.
- **Proxy** (Vercel, `api/[...path].js`): `RAILWAY_URL` y `FINOVA_PROXY_SECRET`, configuradas en Vercel → Settings → Environment Variables (el mismo `FINOVA_PROXY_SECRET` debe coincidir en Railway).

## Despliegue

Ver [`docs/SETUP.md`](docs/SETUP.md) para la configuración paso a paso de GitHub (protección de rama), Vercel y Railway. Convención de mensajes de commit en [`docs/COMMITS.md`](docs/COMMITS.md).

## Seguridad

Ver [`SECURITY.md`](SECURITY.md) para el resumen de medidas implementadas (autenticación, control de acceso, cifrado en reposo, rate limiting, CORS/CSP, etc.) y cómo reportar una vulnerabilidad.
