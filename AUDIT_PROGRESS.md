# AUDITORÍA FINOVA — PROGRESO

> Archivo de retoma. Si se interrumpe la auditoría, leer esto y continuar
> desde la primera fase marcada como PENDIENTE.

**Última actualización:** 30 de octubre de 2026
**Rama:** `rediseno-ui`

---

## FASE 0 — Mapa del proyecto · ✅ COMPLETA

**Arquitectura real** (importante: no es lo que suele asumirse):

- **Sin framework, sin TypeScript.** Scripts clásicos `<script defer>` con ámbito
  global compartido. No hay React, Zustand, Redux ni TanStack. No hay `tsconfig`.
- **Estado global:** un único objeto `APP` (definido en `src/core/state.js`),
  persistido en `localStorage` por `src/core/storage.js`.
- **Local-first.** El servidor NO tiene tabla de transacciones ni de activos:
  solo guarda un *blob* JSON cifrado (AES-256-GCM) por usuario en
  `data/users/<uid>.json`. No existe una base de datos por entidad.
- **Fotos:** IndexedDB (`savePhoto`/`loadPhoto`/`deletePhoto` en storage.js),
  no localStorage.
- **Build:** Vite, pero los `src/**/*.js` NO pasan por Rollup (no son módulos
  ES): `vite.config.js` los copia y minifica aparte con Terser.
- **Carga diferida:** `_LAZY_SCRIPTS` en `utils.js` + `_lazyLoad()`. Diferidos:
  fiscal, simulator, ai, admin, pdf, staking, onboarding, devMonitor,
  portfolio-import, receipt-scan.

**Endpoints del servidor** (`server.cjs`, 2.300+ líneas):
`/api/health` (nuevo), `/api/ai`, `/api/ai-status`, `/api/quotes`,
`/api/yahoo`, `/api/yahoo-info`, `/api/exchange`, `/api/user-data`,
`/api/user-meta`, `/api/sync-upload`, `/api/sync-download`, `/api/session`,
`/api/stats`, `/api/waitlist`, `/api/bank/*` (GoCardless), `/api/admin/*`.

---

## FASE 1 — Salud técnica · ✅ COMPLETA

| Comprobación | Resultado |
|---|---|
| `npm audit` | **10 vulnerabilidades (4 altas)** → `npm audit fix` → **0** |
| `npm run build` | ✅ sin errores |
| `node --check` en los 30 archivos de `src/` + `server.cjs` | ✅ todos |
| `/api/health` | ❌ no existía → **creado** |
| Servidor arranca | ✅ verificado de verdad (`PORT=3999 node server.cjs`) |

**Corregido:**
- `server.cjs`: endpoint `/api/health` nuevo (uptime + timestamp; deliberadamente
  sin versiones de dependencias ni rutas internas).
- `package-lock.json`: actualizadas dependencias transitivas vulnerables de
  `firebase-admin` (grpc-js, retry-request, teeny-request, brace-expansion).

**No corregido a propósito:** los 3 `console.log` de `src/` (auth.js, script.js,
storage.js). Terser los elimina en producción (`drop_console: true`, verificado:
`dist` tiene 0) y el de `auth.js` registra origen/hostname, que es justo lo que
sirve para depurar los problemas de login con Google.

---

## FASE 2 — Seguridad · ✅ COMPLETA (verificada con curl real)

**Bug crítico encontrado y corregido: el antifuerza-bruta no estaba conectado.**

`_recordFailedAttempt()`, `_isIPBlocked()`, `_BRUTE_THRESHOLD` y el bloqueo
exponencial existían en `server.cjs` desde hacía tiempo pero **no se invocaban
desde ningún sitio**. Como la autenticación corre ANTES del rate limit en todos
los handlers, una IP podía martillear cualquier endpoint protegido con tokens
basura de forma indefinida: nunca gastaba cubo (no salía 429) ni se bloqueaba, y
cada intento seguía costando un parseo de JWT y, con Firebase Admin activo, una
verificación criptográfica.

*Demostrado:* 20 peticiones seguidas a `/api/ai` → **20 × 401, ningún 429**.

Había además **dos rutas de autenticación distintas**: `_requireAuth()` (bank,
admin, ai) y llamadas directas a `_verifyFirebaseToken()` (user-data GET/POST,
user-meta). Poner la contabilidad solo en `_requireAuth` habría dejado fuera
justo los endpoints de datos del usuario. Se movió al propio verificador, que
ahora acepta `req` y lleva la cuenta pase por donde pase la petición.

*Verificado tras el fix:* 14 peticiones con token basura →
`401 ×10, luego 429 ×4` con `Retry-After: 3600`. ✅

**Resto, verificado con curl contra el servidor arrancado:**

| Prueba | Resultado |
|---|---|
| Sin token: user-data, sync-download/upload, admin/users, bank/institutions | **401** ✅ |
| Token inválido | **401** ✅ |
| `Origin: https://evil.com` en POST | **403**, y sin cabecera CORS ✅ |
| `Origin: http://localhost:3999` (permitido) | cabecera CORS correcta ✅ |

**Ya correcto antes (no tocado):**
- `_serverError()` no filtra `e.message` ni *stack* al cliente (el único
  `e.message` que llega es una lista blanca de 2 mensajes de validación fijos).
- Cabeceras de seguridad completas en `server.cjs` y `vercel.json`. HSTS se
  omite en server.cjs a propósito y está documentado (TLS lo termina Railway).
- `.gitignore` cubre `.env.local`, `.env.server`, service accounts, `*.pem`,
  `*.key`. Los `.env.development`/`.env.production` versionados contienen solo
  claves **cliente** de Firebase, públicas por diseño y comentadas como tales.
- Sin source maps en `dist/`. Sin claves reales en `dist/`: lo que detecta el
  grep son los textos de ejemplo de los campos de API Key en Ajustes (el
  prefijo de Anthropic y el de Groq, sin ninguna clave detrás).

---

## FASE 3 — Cálculos · ✅ COMPLETA

Cubierta en su mayor parte por la auditoría previa de esta misma sesión y por
la suite de tests (528 en verde). Verificado ejecutando las funciones reales
con `node`/`vm`, no leyendo el código.

**Correcto, sin cambios:** patrimonio neto, valor/coste/ganancia/rentabilidad de
cartera, CAGR, peso por activo, anualización de dividendos, tasa de ahorro (con
guarda contra división por cero), barra de amortización (acotada 0-100 %),
compensación de pérdidas con el límite del 25 % (art. 49.1.b LIRPF), regla de
los 2 meses, tramos de IRPF general y del ahorro.

**Dos discrepancias con los valores esperados del encargo — la app tiene razón:**

1. **Simulador.** El bucle de la app da *exactamente* lo mismo que la fórmula
   cerrada del propio encargo (diferencia 0,00). Con 25.000 € + 500 €/mes al
   7 % y 22 años → **428.416,98 €**. Los ~404.000 € esperados corresponden a
   capitalización **anual** (404.794,48 €, comprobado), no mensual.

2. **IRPF (32.000 €).** La app da **1.301,40 €**, no ~3.170 €. Dos motivos, los
   dos a favor de la app:
   - El mínimo personal se aplica por el método oficial (art. 63.1.2º LIRPF:
     escala sobre la base completa, escala sobre el mínimo, y restar), no
     restándolo de la base antes de aplicar tramos.
   - Finova usa una **escala nacional única**; no modela escalas autonómicas
     por comunidad (no existe selector de CCAA en el modelo de datos). Un
     resultado específico de Madrid no es replicable sin esa función.

**Bug real corregido en fases previas de esta sesión:** faltaba el tercer tramo
de la reducción por rendimientos del trabajo (17.673,52–19.747,50 €, pendiente
1,14 según RDL 4/2024). Verificado contra la Agencia Tributaria.

---

## FASE 4 — Formato español · ✅ COMPLETA

`formatCurrency()` produce `1.234.567,89 €`, **byte a byte idéntico** a
`Intl.NumberFormat('es-ES')` — comprobado ejecutando ambas. Además soporta el
parámetro de signo (`+1.234,56 €`) que `Intl` no da. **No se sustituye**:
sería churn sin cambio de comportamiento y con pérdida de funcionalidad.

Sin `$` ni formato inglés visible al usuario en `src/`.

El parser de importes (`_parseCSVAmt`) acepta `1.234,56`, `1234,56`, `-45,00`,
`1,234.56` y `(45,30)` — decide el separador decimal por **el que aparece en
último lugar**, cubriendo formato europeo y estadounidense.

---

## FASE 5 — Flujos de usuario · ⚠️ PARCIAL

**Lo verificado** (ejecutando las funciones reales con datos, vía `vm`, y con
DOM real de jsdom donde aplica): saldo de cuentas vinculadas, alta/edición/
borrado de transacciones con Deshacer, categorización automática, Quick Add,
importación CSV con revisión y sin duplicados, importación de cartera con
fusión por ticker, recurrentes, objetivos, simulador, fiscalidad, contexto del
Asesor IA, búsqueda global, backup y restauración, hitos de patrimonio.

**Lo NO verificado — y es importante decirlo:** no hay navegador disponible en
este entorno. Playwright/Puppeteer no están instalados y no se han instalado
para no alterar el árbol de dependencias del proyecto. Por tanto **no se ha
hecho clic en nada**: no se ha comprobado el render visual, el tour guiado, el
diálogo nativo de archivos, el comportamiento real en dos pestañas simultáneas
ni la recarga a mitad de formulario.

---

## FASE 6 — PWA, offline y responsive · ⚠️ PARCIAL

**Verificado:** `manifest.json` válido (standalone, theme_color, iconos 192 y
512 con `purpose: any maskable`); las 4 meta de iOS presentes; `sw.js` con
Cache First para el *shell* y Network First para `/api`, con página de respaldo
offline; **los 13 iconos referenciados existen físicamente** (comprobado uno a
uno).

**No verificado:** el comportamiento offline real y el responsive a 320/375/430
px requieren navegador. El CSS tiene los *breakpoints*, pero no se ha medido.

---

## FASE 7 — Accesibilidad · ✅ COMPLETA (salvo lectura con navegador)

Corregido en fases previas de esta sesión: los toasts de **error** se anunciaban
en cola *polite*; ahora llevan `role="alert"` (asertivo). Contraste de la paleta
del PDF fijado con 16 tests usando la fórmula WCAG.

Ya correcto: `:focus-visible` global, `prefers-reduced-motion` (3 bloques),
`role="dialog"`/`aria-modal` en modales, `aria-live` en el contenedor de toasts,
`aria-current` en el menú, `aria-sort` en tablas ordenables.

---

## FASE 8 — SEO, legal y landing · ✅ COMPLETA

| Comprobación | Resultado |
|---|---|
| Meta description, 7 OG y 4 Twitter en `index.html` y `landing.html` | ✅ |
| `privacidad.html`, `terminos.html` (+ versiones EN) | ✅ existen |
| `sitemap.xml`, `robots.txt` | ✅ existen |
| Referencias a `verdpo@gmail.com` | ✅ **ninguna** |
| Email de contacto `MyFinova1@gmail.com` | ✅ |
| Enlaces internos y anclas de la landing | ✅ los 9 destinos existen |
| Año dinámico en el footer | ✅ |

---

## FASE 9 — Verificación final · ✅ COMPLETA

Ver la salida real en el informe del commit.

---

## PENDIENTE PARA EL USUARIO (requiere navegador o despliegue)

1. **Flujos de UI reales** (Fase 5): recorrer la app en el navegador. Lo más
   frágil por no estar probado así: el escáner de tickets y el importador de
   cartera, ambos recién añadidos.
2. **Offline y responsive** (Fase 6): DevTools → modo offline, y 320/375/430 px.
3. **Escaneo de tickets de verdad**: necesita una clave de Claude, ChatGPT o
   Gemini. La de **Groq no sirve** (su modelo `llama-3.3-70b-versatile` no
   procesa imágenes); está avisado en la propia UI.
4. **Iconos**: `icon-64.png` usa un diseño distinto al de `icon-16/32/128.png`
   (una "F" sólida frente a una de contorno). Están así por decisión pendiente
   de confirmar — el sidebar y el favicon se verán distintos entre sí.
