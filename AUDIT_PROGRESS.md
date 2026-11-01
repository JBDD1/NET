# AUDITORÍA FINOVA — PROGRESO

> Archivo de retoma. Si se interrumpe la auditoría, leer esto y continuar
> desde la primera fase marcada como PENDIENTE.

**Última actualización:** 30 de octubre de 2026 (login y registro)
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

## FASE 5b — Login y registro · ✅ COMPLETA

Auditados **los dos** sistemas de autenticación que conviven en el proyecto:
el de dentro de la app (`src/auth/auth.js`) y el de la landing
(`landing.js` + `landing.html`). Son implementaciones independientes, y la
divergencia entre ellas es justo donde estaban los fallos.

### Bug 1 — el registro perdía el nombre escrito (solo dentro de la app)

`createUserWithEmailAndPassword()` dispara `onAuthStateChanged` **de
inmediato**, y en ese instante `user.displayName` todavía es `null` porque
`updateProfile()` aún no ha corrido. Como el listener hace
`APP.userName = APP.userName || user.displayName || ''`, el nombre recién
escrito se perdía y la app mostraba **el trozo del correo** en su lugar.

La landing **no** tenía el fallo: encadena `updateProfile` *antes* de navegar
a `index.html`.

*Corregido* fijando `APP.userName` antes de crear la cuenta y refrescando la
UI tras `updateProfile`. Y en el `catch`: si la creación falla (correo ya en
uso, red…) el nombre se **deshace**, porque si no quedaba pegado en `APP` y
al iniciar sesión después con otra cuenta se mostraba ese nombre ajeno.

### Bug 2 — el spinner podía quedarse colgado para siempre

`_hideLoginScreen()` vuelve a **mostrar** `#app-loading`, y es `init()`
quien lo oculta **en su última línea**. El listener de `onAuthStateChanged`
es `async` y **nada recogía su rechazo** (el `try` del fichero envuelve el
*registro* del listener, no su ejecución). Si `init()` reventaba a mitad
—datos corruptos en localStorage, una sección que falla al pintar— el spinner
se quedaba fijo a `z-index: 9999` tapando la app entera: inicio de sesión
correcto y un «cargando» eterno, sin ningún aviso.

*Corregido* con un `try/catch` alrededor de `init()` que oculta el spinner y
avisa con un toast. `_loadUserDataFromServer()` ya se comía sus propios
errores, así que no podía romper la cadena.

### Bug 3 — Enter no enviaba el formulario (en ambos sistemas)

**No hay ningún `<form>`** envolviendo los campos de login, ni en
`index.html` ni en el modal de `landing.html`: el `onkeydown` de Enter
estaba solo en el campo de contraseña. Pulsar Enter en el correo (o en el
nombre) no hacía absolutamente nada. Añadido a los 3 campos de los 2 sistemas
(5 sustituciones).

### Bug 4 — el mensaje de error no se anunciaba

`#login-error` y `#lpFormError` se rellenan dinámicamente pero no tenían
`role`, así que un lector de pantalla no anunciaba «Contraseña incorrecta».
Añadido `role="alert"` a ambos. Coherente con el arreglo de los toasts de la
Fase 7.

### Bug 5 — el botón de Google no daba señal de carga (landing)

`lpSignInGoogle()` no llamaba a `_setLoading()`: se podía pulsar repetidas
veces y abrir varios popups. Añadido, con `_setLoading(false)` también al
cerrar el popup a mano (`auth/popup-closed-by-user`), que no es un error que
mostrar pero sí tiene que devolver el botón a su sitio.

### Verificado, sin cambios

| Comprobación | Resultado |
|---|---|
| `Cross-Origin-Opener-Policy: same-origin-allow-popups` en `server.cjs` | ✅ curl real |
| Misma COOP en `vercel.json` (es la ruta de producción) | ✅ |
| CSP `frame-src https://*.firebaseapp.com https://accounts.google.com` | ✅ ambos |
| CSP `script-src` con `apis.google.com` + `www.gstatic.com` | ✅ ambos |
| CSP `connect-src` con `identitytoolkit` + `securetoken` | ✅ ambos |
| `_authErrMsg` / `_lpErrMsg` | 18 y 12 códigos, con fallback ✅ |
| `_submitLogin` rechaza correo o contraseña vacíos | ✅ (hace segura la lectura de `password.length`) |
| Contraseña < 6 se rechaza **antes** de tocar la red | ✅ en ambos |
| `?signup=1` abre registro y se consume una sola vez | ✅ `history.replaceState` |
| `main.inert` mientras el overlay está arriba | ✅ sin doble landmark `main` |
| `authLogout` recarga a `location.pathname` | ✅ limpia el query string |
| Los `onkeydown` sobreviven a Terser (`_submitLogin` es global) | ✅ comprobado en `dist/` |

**Tests nuevos:** `src/tests/auth-signup.test.js`, 9 casos. Cada uno se
validó **retirando el arreglo** y comprobando que el test se pone rojo de
verdad: el del nombre falla sin la asignación previa, los dos de contaminación
fallan sin el `catch` que lo deshace, y los tres de arranque fallan sin el
`try/catch` de `init()`. Se descartó además un test estructural que seguía
en verde con el bug presente —`indexOf('try {')` enganchaba otro `try`
cualquiera del archivo—; ahora la extracción exige encontrar `await init()`
dentro del bloque.

**Suite: 537 en verde, 23 suites. Build correcto.**

**Pendiente de navegador:** el popup real de Google contra el dominio de
producción. Lo que se ha podido verificar sin navegador son las cabeceras que
lo hacían fallar, y están todas correctas.

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

## FASE 10 — Borrado de cuenta (RGPD art. 17) · ✅ COMPLETA

### PASO 1 — Inventario de datos · ✅ COMPLETO

Hecho leyendo el codigo, no asumiendo. Lo que no este en esta lista no se
borra, asi que incluye tambien almacenes que el encargo no mencionaba.

#### Servidor — por uid (ruta directa)

| Dato | Ruta | Contenido |
|---|---|---|
| Blob de datos | `data/users/<uid>.json` | Todo el dataset, **cifrado** AES-256-GCM si `FINOVA_ENC_KEY` esta puesta |
| Metadatos | `data/users/<uid>.meta.json` | **email, displayName, lastAccess, createdAt** — en claro |
| Marca de bloqueo | `data/users/<uid>.blocked` | Fichero vacio, lo pone el panel admin |
| Rol | `data/roles.json` | Objeto `{ uid: 'free'|'premium'|'admin' }` |
| Cubos de rate limit | `data/ratelimit.json` | Claves `ai-uid:<uid>`, persistidas entre reinicios |
| Cubos en memoria | `_buckets` (Map) | `ai-uid:<uid>` vivo en el proceso |
| Requisitions bancarias | `data/bank_requisitions.json` | `{ requisitionId: { uid, createdAt } }` — conexion GoCardless |

#### Servidor — por uid (ruta indirecta, hay que resolverla)

| Dato | Ruta | Por que no es directo |
|---|---|---|
| Admin extra | `data/extra_admins.json` | Indexado por **email**, no por uid. Se saca el email de `.meta.json` antes de borrarlo |
| Lista de espera | `data/waitlist.json` | Indexada por **email**. Igual: hay que leer meta primero |
| Backups de sync | `data/sync/<code>.json` | **No existe ninguna relacion code -> uid.** Ver el problema de abajo |
| Analitica | `data/analytics.json` | Indexada por `clientId` (UUID del dispositivo, generado en cliente). El servidor **no puede** mapear uid -> clientId |

#### Problema encontrado: los codigos de sync no tienen dueno

`data/sync/<code>.json` se escribe solo con el codigo. **El servidor no sabe
de quien es cada codigo**, asi que al borrar una cuenta no puede invalidar sus
backups: seguirian accesibles indefinidamente. El encargo lo pedia
explicitamente («un codigo de sync que siga activo sigue dando acceso»).

Y al mirarlo aparecio algo peor, preexistente: `handleSyncDownload` exige
**un** token valido pero **no comprueba propiedad**, y `syncUpload` sube
`JSON.stringify(exportable)` — el dataset completo **en texto plano**, sin el
cifrado que si tiene `data/users/`. Cualquier usuario autenticado que conozca
un codigo de 12 hex se descarga la economia completa de otro. El codigo viaja
ademas en una cookie `finova_sync` (30 dias).

#### Firebase

Comprobado con grep: **no hay Firestore, ni Realtime Database, ni Storage**.
Solo **Authentication**. Las coincidencias de `getStorage` en el codigo son
`getStorageKey`/`getStorageUsage`, de localStorage.

Por tanto en Firebase solo hay: el usuario de Auth (uid, email, displayName,
photoURL, proveedor, fechas) y sus refresh tokens.

#### Navegador

| Tipo | Clave | Contenido |
|---|---|---|
| localStorage | `finova_<uid>_data_v1` | Dataset del usuario autenticado |
| localStorage | `finova_data_v1` | Dataset legacy / modo sin cuenta |
| localStorage | `finova_last_uid` | Ultimo uid, lo lee el boot-script del tema |
| localStorage | `finova_history_v2` + `finova_history_v1` | Historial de versiones (snapshots del dataset) |
| localStorage | `finova_tour_step` | Paso del tour guiado |
| localStorage | `finova_ai_consent_v1` | Consentimiento de envio de datos a la IA |
| localStorage | `finova_api_key`, `finova_openai_key`, `finova_gemini_key`, `finova_groq_key` | API keys en claro (version antigua) |
| localStorage | los 4 anteriores con sufijo `_enc` | API keys cifradas AES-GCM |
| localStorage / sessionStorage | `finova_enc_k` | Material de clave de versiones antiguas |
| IndexedDB | `finova_photos` | Fotos de tickets y recibos |
| IndexedDB | `finova_state` | Copia de respaldo del estado completo |
| Cookie | `finova_sync` | Codigo de sincronizacion, 30 dias |
| Cache SW | `finova-api-v1` | Respuestas de `/api/yahoo` y `/api/fx`; **las URL revelan los tickers de la cartera** |
| Cache SW | `finova-v27` | Shell estatico — sin datos personales, se puede quedar |

#### Bug encontrado en el borrado local que ya existia

`resetAllData()` (dashboard.js) hace `localStorage.removeItem(STORAGE_KEY)`,
y `STORAGE_KEY` es la clave **legacy** `finova_data_v1`. Un usuario
autenticado guarda en `finova_<uid>_data_v1`, que es lo que devuelve
`_getStorageKey()`. Es decir: el boton **«Eliminar todo» no borraba nada**
para quien habia iniciado sesion — tras el reload los datos seguian ahi.
Tampoco toca IndexedDB, ni el historial, ni las API keys.

---

### PASO 2 — Endpoint del servidor · ✅ COMPLETO

**`POST /api/account/delete`** (no `DELETE`). El método es una decisión, no una
comodidad: el servidor aplica la comprobación de origen (CSRF), la de
Content-Type y el límite de tamaño **solo a POST**, y
`Access-Control-Allow-Methods` no incluye DELETE. Un DELETE se habría saltado
las tres. *Verificado con curl:* `DELETE` → 404, `POST` con
`Origin: https://evil.com` → 403.

| Requisito | Cómo queda |
|---|---|
| Autenticación | `_requireAuth` — el uid sale **siempre** del token, nunca del body ni de la URL |
| Rate limit estricto | 3/hora **por uid** (`acctdel-uid:<uid>`) + 5/hora por IP antes de verificar el token |
| Login reciente | `auth_time` con margen de 5 min → 401 `REAUTH_REQUIRED` |
| Idempotente | Ningún borrado lanza por algo que ya no existe |
| Logs | Solo fecha + `sha256(uid)` truncado a 12 chars. Nunca email, uid en claro ni datos |
| Respuestas | `200 {ok:true, authDeleted}` · `REAUTH_REQUIRED` · `RATE_LIMITED` · `INTERNAL_ERROR` |

**Firebase Auth:** `revokeRefreshTokens(uid)` **antes** de `deleteUser(uid)`,
para que si el borrado falla los tokens que queden vivos ya no sirvan.
`auth/user-not-found` se trata como éxito (es el caso del reintento).

Ambas funciones existen **solo con el Admin SDK**. Sin service account
configurada el servidor no puede tocar la cuenta de Auth, así que responde
`authDeleted: false` y el cliente la borra con `user.delete()`, que puede
porque acaba de reautenticarse. Así la cuenta desaparece en las dos
configuraciones.

**GoCardless:** la requisition vive en el proveedor, que es un encargado del
tratamiento. Borrar solo nuestra referencia dejaría la conexión con el banco
viva allí, así que se pide también `DELETE /api/v2/requisitions/<id>/`. Un 404
cuenta como éxito. Si no hay credenciales configuradas no se llama — no se
activa ni contrata nada.

#### Arreglado de paso: el agujero de los códigos de sync

Para poder invalidar los backups de un usuario hacía falta saber de quién son,
así que se añadió `data/sync_owners.json` (`code → {uid}`). Eso cierra además
el agujero preexistente:

- **Al subir:** el código queda atado al uid. Si ya es de otro → **403** (antes
  se le sobrescribía el backup a su dueño).
- **Al descargar:** si el código tiene dueño y no es el solicitante → **403**.

Los códigos anteriores a este registro no tienen dueño anotado y se siguen
permitiendo, para no romper a quien ya los use. **Queda un hueco conocido:**
esos códigos legacy siguen siendo descargables por cualquier usuario
autenticado que los conozca. Ver los pendientes al final.

---

### PASO 3 — Interfaz en Ajustes · ✅ COMPLETO

Fila nueva en la tarjeta **«Zona de peligro» que ya existía** — no se creó otra
sección ni se tocó el diseño. Reutiliza `openModal`, `btn-danger`,
`modal-danger-box` y los toasts actuales.

Carga diferida (`_LAZY_SCRIPTS.accountDelete` + `_withAccountDelete`), igual
que el escáner de tickets: 12 KB que no se descargan si nadie pulsa el botón.

| Requisito | Cómo queda |
|---|---|
| Explica qué se borra | Transacciones, cartera, objetivos, viajes, bizums, patrimonio, fotos, API keys, copias del servidor y códigos de sync |
| Descargar copia antes | Reutiliza `downloadBackup()`, el mismo de Ajustes |
| Escribir ELIMINAR | Sí, y el botón exige **las dos** cosas: texto exacto **y** cuenta atrás cumplida |
| Cuenta atrás de 5 s | Sí, y el intervalo se limpia si el modal se cierra |
| Reautenticación | `reauthenticateWithCredential` (contraseña) o `reauthenticateWithPopup` (Google), según `providerData` |
| `requires-recent-login` | Se vuelve a pedir la confirmación en vez de fallar |
| Estados de carga | Botón deshabilitado + texto ("Confirmando…", "Eliminando…", "Limpiando este dispositivo…"), la convención del proyecto |
| Errores concretos | 10 códigos traducidos: contraseña incorrecta, sin conexión, límite de intentos, popup bloqueado, cuenta distinta… |
| Sin `alert()` | Verificado con un test |
| Accesibilidad | `role="dialog"` + `aria-modal` + foco atrapado + Escape ya los da `openModal`; los errores van en `role="alert"` con `aria-live="assertive"` |
| Modo demo | Diálogo distinto: avisa de que **no hay cuenta que borrar** y solo limpia lo local |

Si ambos proveedores están vinculados se pide **la contraseña**, no el popup:
es menos intrusivo y no depende de que el navegador permita ventanas.

---

### PASO 4 — Limpieza en el cliente · ✅ COMPLETO

**La regla que gobierna el orden:** nada local se borra hasta que el servidor
responde 200. Si se limpiara antes y el servidor fallara, el usuario se
quedaría sin datos **y** con la cuenta viva, sin forma de reintentar. En
cualquier error se muestra el motivo y **no se toca nada**.

Tras el 200: `user.delete()` si el servidor no pudo → `signOut()` → limpieza →
`landing.html?deleted=1`.

Se barren las claves **recorriendo** el almacenamiento, no con una lista fija:
la del dataset lleva el uid dentro (`finova_<uid>_data_v1`) y las versiones
antiguas dejaron claves que ya no están en el código.

**Dos cosas que faltaban y se encontraron repasando el flujo:** Firebase guarda
la sesión en `firebase:authUser:<apiKey>:[DEFAULT]` (localStorage) y en la base
`firebaseLocalStorageDb` (IndexedDB), y **ambas contienen el correo y el uid**.
Solo se barría lo que empieza por `finova`, así que tras borrar la cuenta
quedaba ahí un dato personal. Ahora se borran las dos.

Se deja a propósito la caché `finova-v27` (css, js, iconos: sin datos
personales) y se borra `finova-api-v1`, porque las **URL** de
`/api/yahoo?symbols=…` revelan los tickers de la cartera.

Nada de esto lanza: una base bloqueada por otra pestaña se reporta y se sigue,
en vez de dejar `localStorage` a medias.

---

### PASO 5 — Documentación legal · ✅ COMPLETO

`privacidad.html`: apartado **7 «Eliminación de cuenta y datos»** nuevo, con 6
subapartados (cómo funciona, qué se borra del servidor, de la cuenta de acceso,
de este dispositivo, en qué plazo, y cómo pedirlo por correo). Renumerados 7-9
→ 8-10 e índice actualizado. Escrito contra lo que **de verdad** hace el
código: menciona los 5 segundos, los 5 minutos de `auth_time`, la invalidación
de los códigos de sync, el corte en GoCardless, y que en los logs solo queda un
hash irreversible.

**Encontrado:** `privacy.html` no es la versión inglesa — es una **segunda
política, también en español**, con estructura distinta, que también se publica
(`vite.config.js` la copia y `terms.html` la enlaza). Dejarla sin la sección la
habría puesto en contradicción con la otra, así que lleva su propio apartado 8
equivalente. **La duplicidad en sí sigue ahí** — ver pendientes.

---

### PASO 6 — Pruebas · ✅ COMPLETO (con dos excepciones honestas)

**Emulador de Firebase Auth: no disponible** (no está instalado y no se instaló
para no alterar el árbol de dependencias). Por eso la lógica de borrado se
extrajo a `_deleteAccountData(uid, { dirs })`, que acepta el directorio: **17
tests** la ejecutan de verdad contra un directorio temporal con datos falsos,
extrayendo la función **real** de `server.cjs`.

**Con curl, contra el servidor arrancado:**

| Prueba | Resultado |
|---|---|
| Sin token | **401** ✅ |
| Token basura | **401** ✅ |
| `DELETE /api/account/delete` | **404** (la ruta es POST a propósito) ✅ |
| `Origin: https://evil.com` | **403** ✅ |
| El blob del usuario tras cada fallo | **intacto** ✅ |
| Borrado completo | **200**, y `users/`, `sync/`, `sync_owners`, `roles`, `extra_admins` y `waitlist` vacíos ✅ |
| Borrar **dos veces** seguidas | **200 y 200**, sin 500 ✅ |
| 4º y 5º intento en la misma hora | **429 `RATE_LIMITED`** ✅ |

**Bug que solo apareció al ejecutarlo:** el límite de 3/hora **no se aplicaba**.
Mi propia limpieza de cubos usaba `k.endsWith(':' + uid)`, que también casa con
`acctdel-uid:<uid>`: cada borrado se reseteaba su propio contador. Comprobado:
5 borrados seguidos devolvían 200. Ahora solo se borra `ai-uid:<uid>`, y el
cubo del borrado se deja vivo a propósito.

**No se pudo probar con curl el camino `REAUTH_REQUIRED`**, porque hace falta un
token firmado por Firebase y no se puede falsificar (la verificación comprueba
la firma RS256 contra las claves públicas de Google). Por eso la comprobación
se extrajo a `_isReauthFresh(authTime, nowSec)`, una función pura con **7
tests**: el límite exacto de 300 s, un segundo por encima, una hora, `auth_time`
ausente / no numérico / en el futuro, y como cadena.

**Tampoco se probó con un token de otro usuario**, por la misma razón. Lo que sí
está cubierto es lo que importa de eso: **9 tests** verifican que borrar el uid
A no toca blob, meta, rol, cubo, backup de sync ni requisition del uid B.

**Flujo de UI:** no hay navegador (sin Playwright/Puppeteer). Se recorrió en el
código y se cubrió con **18 tests** en jsdom que cargan el fichero real: que no
queda ninguna clave de Finova ni de Firebase, que **no se tocan** las de otras
apps del mismo origen, que se borran las 3 bases de IndexedDB, que se borra la
caché de API pero **no** el shell, y que la cookie caduca.

**Total: 579 tests en verde, 25 suites. Build correcto.**

#### Dos bugs más, corregidos de paso

1. **`resetAllData()` no borraba nada si habías iniciado sesión.** Hacía
   `removeItem(STORAGE_KEY)`, que es la clave **legacy** `finova_data_v1`, pero
   un usuario autenticado guarda en `finova_<uid>_data_v1`. El botón «Eliminar
   todo» era un no-op: tras el reload los datos seguían ahí. Tampoco tocaba el
   historial ni las API keys, pese a anunciarlas en el diálogo.

2. **Test que fallaba los días 29, 30 y 31.** El helper `_monthsAgoYM` hacía
   `setMonth(getMonth() - 1)` sobre el día de hoy: un 31 de octubre pedía el
   «31 de septiembre», que no existe, y JS lo desbordaba a 1 de octubre, con lo
   que «el mes anterior» acababa siendo el mes actual. Salió al ejecutar la
   suite hoy. Se fija el día a 1 antes de restar meses.

---

### Hallazgo que afecta al alcance en producción

`_saveUserMeta()` (auth.js) y el envío de analítica están **limitados a
localhost** por una guarda de hostname. En producción, por tanto, **no se
escriben** `data/users/<uid>.meta.json` ni `data/analytics.json`. Consecuencias:

- El borrado sigue siendo correcto e idempotente: borra lo que exista.
- Pero en producción no hay `.meta.json` del que sacar el email, así que la
  limpieza de `extra_admins.json` y `waitlist.json` **no se dispara** por esa
  vía. Si alguien se apuntó a la lista de espera, su correo y su IP
  sobrevivirían al borrado de cuenta.
- Como efecto colateral, `_isAdminUid()` depende del meta: el panel de admin
  tampoco debería funcionar en producción.

No se ha tocado esa guarda: quitarla cambiaría **qué datos personales se envían
al servidor en producción**, y eso es una decisión de producto y de política de
privacidad, no un detalle de implementación. Ver pendientes.

---

## FASE 11 — Feedback en la app y FAQ · ✅ COMPLETA

### Lo implementado

| Pieza | Dónde |
|---|---|
| Botón de feedback | Sidebar (junto a Ajustes), menú móvil, Ajustes → Ayuda, búsqueda global |
| Formulario | `src/utils/feedback.js` (carga diferida), modal con el sistema de diseño actual |
| FAQ en la app | Mismo módulo, acordeón `<details>` con buscador |
| FAQ como página | `faq.html`, con el estilo de `privacidad.html` |
| Fuente única | `src/data/faq.js` — 14 preguntas, la usan la app y la página |
| Endpoint | `POST /api/feedback` en `server.cjs` |
| Panel de admin | Tarjeta «Feedback de usuarios» con filtro y marcar como leído |
| Buffer de errores | `src/core/utils.js` — últimos 5, en memoria |

**Sin botón flotante a propósito:** taparía contenido y los botones táctiles
de la barra inferior en móvil. Va en el menú, que es donde se busca.

**Sin atajo de teclado nuevo:** `n`, `i`, `g`, `t`, `p`, `/` y `Ctrl+K` están
ocupados, y el encargo pedía no chocar con ellos.

### La invariante que gobierna todo

**Nunca sale un dato financiero del navegador**, ni con la casilla técnica
marcada. Lista blanca en los dos niveles: los campos del cuerpo y los del
informe técnico. Si mañana alguien añade un campo con datos dentro, el
servidor lo descarta antes del disco. Hay 6 tests que fallan si se rompe.

El informe técnico solo toca **tres** claves de `APP`: `activeSection`,
`variant` y `theme`. Un test lo comprueba enumerando los accesos `APP.*` de
la función.

### Hallazgo importante: el disco es efímero

No hay `railway.json` ni volumen declarado, y `data/` está en `.gitignore`.
Sin volumen montado, Railway da un disco **efímero**: `data/feedback.jsonl`
desaparece en cada despliegue. **El webhook es el canal fiable, no el
fichero.** El servidor lo avisa al arrancar y el panel de admin lo muestra en
rojo. Afecta también a `data/users/<uid>.json`, que ya existía.

No se puede verificar desde el repositorio si hay volumen añadido desde el
panel de Railway: la detección usa `RAILWAY_VOLUME_MOUNT_PATH`.

### Decisiones que merecen explicación

**El texto no se escapa al guardar.** Se guarda tal cual (en JSON no se
ejecuta nada) y se escapa **en cada punto de renderizado**: el panel de admin
usa `textContent`, y el webhook lo manda como campo JSON, que ni Discord ni
Slack interpretan como HTML. Escapar al guardar dejaría `&lt;` literal en el
fichero y un usuario que escriba «a < b» vería basura. Lo que sí se quita son
los caracteres de control y los invisibles de ancho cero, que sirven para
falsear líneas de log y esconder texto.

**El honeypot responde 200.** Decirle al bot que ha fallado solo le enseña a
afinar el siguiente intento. El mensaje se descarta y queda un `console.warn`.

**El banner de los 7 días se marca como mostrado al pintarlo**, no al
cerrarlo: si el usuario recarga sin tocarlo, tampoco debe volver a verlo.
Preguntamos una vez; si la ignora, la respuesta es no. Y solo en el
dashboard, nunca con un modal, la búsqueda, el tour o el login abiertos.

**Una tarjeta en admin, no una pestaña.** El panel entero está hecho con
tarjetas; meter un sistema de pestañas solo para esto rompería el patrón.

### Pruebas

**27 tests nuevos** (`src/tests/feedback.test.js`). Con curl, contra el
servidor arrancado y un webhook local que recibía los envíos:

| Prueba | Resultado |
|---|---|
| Los 4 tipos, con y sin técnica, con y sin email | **200**, 4 en el fichero y 4 en el webhook ✅ |
| Autenticado | guarda `uidHash`, y el uid en claro **no** aparece ✅ |
| Mensaje vacío / 9 caracteres | **400** ✅ |
| Tipo inválido | **400** ✅ |
| Campo extra (`balance`) | **400** — rechazado, no ignorado ✅ |
| Honeypot relleno | **200** y **no** se guarda (4 entradas siguen siendo 4) ✅ |
| Sin `openMs` / 500 ms | **400** ✅ |
| Valoración 9 / email inválido | **400** ✅ |
| Mensaje de 5.000 caracteres | **200**, guardado recortado a **2.000** ✅ |
| Body de 1 MB | **413** ✅ |
| 6ª petición en una hora | **429** ✅ |

**Un falso positivo que merece contarse:** mi primera comprobación de «no hay
datos financieros» buscaba la cadena `"transactions"` en el fichero y saltó.
Era `"section":"transactions"` — el nombre de la pantalla, que es justo lo que
el informe técnico debe llevar. La comprobación era demasiado burda; el test
definitivo verifica la lista blanca real en vez de buscar cadenas.

**Lo que NO se pudo probar:** el webhook contra la API real de Discord (hace
falta una URL del usuario) y el flujo de interfaz en un navegador (no hay
navegador en este entorno). Queda pendiente revisar el modal en los 5 temas y
a 375 px, y que el foco vuelve al botón de origen al cerrar.

**`faq.html` se renderiza con JavaScript** desde la fuente única, que es lo
que evita que las dos versiones divergan. Efecto secundario: un buscador que
no ejecute JS no indexa las respuestas. Se arregla con un paso de build que la
pre-renderice.

### Parte D completada después (lo que quedó pendiente)

La Parte D del encargo quedó a medias. Lo que faltaba era lo que marqué
«requiere navegador», pero una parte sí era verificable estáticamente, y ahí
aparecieron **tres cosas reales**:

1. **`.fv-pw-toggle` medía 30×30 px**, por debajo del mínimo táctil de 44.
   Es el botón de mostrar/ocultar contraseña. Subido a 44×44: el icono sigue
   siendo de 18 px y el botón no tiene fondo hasta el hover, así que no
   cambia el aspecto — solo deja de ser un objetivo imposible de acertar con
   el pulgar. El campo mide ~44 px de alto, así que encaja exacto.
   **El de la landing (`.lp-pw-toggle`) tenía el mismo problema,
   preexistente**, y se ha corregido igual.

2. **El medidor de contraseñas usaba `var(--warn, #d08a2a)`, y `--warn` no
   está definido en ningún tema.** Siempre caía al ámbar fijo, que desentona
   en las paletas que no son cálidas (en `soft-mono`, negro y coral, canta).
   Cambiado a `var(--accent)`, que sí existe en los 5 y encaja por
   construcción.

3. **La FAQ se había quedado desactualizada por el trabajo de
   monitorización.** La respuesta de «¿dónde se guardan mis datos? ¿quién
   puede verlos?» describía el modelo local-first y el blob cifrado, pero
   **no mencionaba Sentry ni la analítica** — y la FAQ promete estar
   verificada contra el código. Añadido un párrafo que lo dice y remite a
   Ajustes → Privacidad.

**Verificado estáticamente, sin navegador:**

| Comprobación | Resultado |
|---|---|
| Los 14 tokens CSS que uso sin respaldo existen en los **5 temas** | ✅ (los radios están en el `:root` global, no por tema) |
| Objetivos táctiles ≥ 44 px | ✅ tras corregir el toggle |
| Sin anchos fijos > 340 px que desborden a 375 px | ✅ |
| `prefers-reduced-motion` neutraliza mis 3 transiciones | ✅ en `style.css` y en `faq.html` |
| Todos los enlaces internos resuelven | ✅ incluidas las anclas `privacidad.html#s8` y `#s9`, que sobrevivieron a **dos** renumeraciones |
| `faq.html` define los 5 temas y su propio `min-height: 44px` | ✅ (no carga `style.css`) |

**Probado con el fichero real en jsdom (13 tests nuevos):**

- **Fallo de red:** el texto escrito **sigue en el formulario**, aparece el
  botón de enviar por correo, y el `mailto` lleva asunto y mensaje pero
  **no** el informe técnico (un JSON dentro de un `mailto` se rompe en medio
  cliente de correo).
- **Error 500:** mismo plan B.
- **429:** se avisa del límite pero **no** se ofrece el `mailto` — reenviar
  por correo cuando el problema es haber mandado demasiados mensajes solo
  traslada el exceso a la bandeja.
- El botón se rehabilita para poder reintentar; tras un éxito el borrador se
  limpia.
- `closeModal` devuelve el foco al elemento de origen, el modal atrapa el
  foco con Tab y Shift+Tab, y cierra con Escape.
- La FAQ usa `<details>`, que da el acordeón accesible y el teclado sin JS.

**Lo que sigue necesitando navegador:** mirarlo con los ojos. La geometría,
los contrastes y el comportamiento real del teclado están verificados por
código, pero nadie ha visto el modal en los 5 temas ni lo ha pulsado a 375 px.

Suite: **713 en verde**, 28 suites.

Ver `FEEDBACK_SETUP.md` para la configuración manual.

---

## FASE 12 — Monitorización para el lanzamiento · ✅ COMPLETA

Sentry (navegador y servidor), health checks para UptimeRobot y analítica sin
cookies. **Todo funciona con las variables vacías**: sin configurar nada no se
envía nada a ningún tercero y la app no cambia.

### El problema de arquitectura que había que resolver primero

El proyecto son **scripts clásicos**, no módulos ES: `@sentry/browser` no se
puede cargar con un `<script defer src>`. La solución fue hacer de
`src/core/monitoring.js` el **único módulo ES del proyecto**, cargado con
`<script type="module">` desde `index.html` y `landing.html` — que son inputs
de Rollup, así que lo empaqueta junto al SDK. Expone una API mínima en
`window.fvMonitor`, y los scripts clásicos la llaman con guarda
(`window.fvMonitor?.capture(...)`).

Hizo falta además:
- Excluir `monitoring.js` del copiado de scripts clásicos en `vite.config.js`,
  o habría quedado en `dist/` un fichero muerto con un `import` sin resolver.
- Que el middleware de desarrollo **salte los módulos de verdad**: solo
  existe para sustituir `import.meta` en los clásicos, y a un módulo le
  rompería los *bare imports*.

### Efecto secundario inesperado y bueno

Con `VITE_SENTRY_DSN` vacía, Terser demuestra que `_enabled` es siempre
`false` y **elimina el SDK entero**: el bundle queda en 16 KB. Con DSN sube a
96 KB (33 KB comprimido). Es decir, **coste cero mientras no se configure**.

### Privacidad: la pieza central

Los patrones de redacción viven en `src/core/redact-patterns.json`, que es
**fuente única** — la importa `monitoring.js` (módulo ES, vía Vite) y la lee
`server.cjs` (CommonJS, vía require). Está en JSON precisamente porque es el
único formato que los dos pueden leer sin duplicar código.

Redacta importes (con € y sin él), formato español e inglés, IBAN, tarjetas,
correos, JWT, cabeceras Authorization, las claves de los 4 proveedores de IA
y los uid de Firebase. **El mensaje del error sigue siendo legible**, que es
la condición para que Sentry sirva de algo.

| Desactivado | Por qué |
|---|---|
| Session Replay | Graba la pantalla; aquí la pantalla **es** el dato |
| `tracesSampleRate` | Cada traza lleva URL y tiempos |
| Migas de consola y de clic | El texto pulsado puede ser un importe o un nombre |
| `HttpContext` (navegador) | Añade URL completa, cabeceras y user agent |
| `RequestData` (servidor) | Cabeceras con Authorization, cookies, query y cuerpo |
| `LocalVariablesAsync` (servidor) | **Los valores de las variables locales**: importes, uid, tokens |
| `Console` (los dos) | Logs con rutas e identificadores |

El usuario se identifica solo con un hash de 16 caracteres calculado **en el
navegador**: el uid no sale nunca.

### Fuga real encontrada al probarlo

Monté un receptor falso de Sentry y disparé el error de prueba. El mensaje
salía redactado, pero `pre_context`, `context_line` y `post_context` —las
líneas de código que adjunta la integración `ContextLines`— llevaban **el
IBAN y el token en claro**, porque están escritos literalmente en el fuente
del propio error de prueba. El frontend ya las borraba; el servidor no.

Se decidió **redactarlas en vez de borrarlas**: sin source maps en el
servidor son lo que hace legible una traza, pero si alguien deja una cadena
con pinta de token escrita en el código, saldría tal cual. Verificado después:
8 redacciones aplicadas, 0 fugas.

### Dos bugs del servidor corregidos

1. **`/api/health` era inalcanzable para un monitor externo.** El chequeo de
   `FINOVA_PROXY_SECRET` corre para todo `/api/*` **antes** del enrutado, así
   que UptimeRobot apuntando directamente a Railway habría recibido un 403 y
   reportado una caída permanente. Ahora la salud se responde antes de esa
   comprobación; el resto de endpoints siguen protegidos (verificado con
   curl: health 200, `/api/ai-status` 403). Se quitó además el `uptime` que
   exponía, que es estado interno.
2. **No había apagado ordenado ni manejadores de proceso.** El encargo decía
   «mantén el graceful shutdown» dando por hecho que existía: no existía. En
   cada despliegue de Railway se cortaban las peticiones en vuelo y se perdía
   hasta **5 minutos** de estado del rate limit (`_saveRateLimits` corre cada
   300 s). Ahora: cerrar → guardar → `flush` de Sentry → salir, en ese orden,
   y un test fija el orden. `uncaughtException` sale por ahí para que el error
   llegue a Sentry antes; `unhandledRejection` **no** tumba el servidor,
   porque suele venir de una petición concreta.

Y una tercera, menor: `_isAdminUid` rechazaba `dev-uid` por `_UID_RE`, así que
**el panel de admin era imposible de probar en local**. Se acepta solo cuando
`FINOVA_DISABLE_AUTH=true`, es decir cuando ya no hay autenticación en
absoluto.

### Source maps: por qué quedan OPCIONALES

Hallazgo que cambia la recomendación: `vite.config.js` usa
`mangle.toplevel: false` (el HTML llama a las funciones por nombre con
`onclick`), así que **los nombres de función se conservan en producción** —
comprobado en `dist/`: `_txCreate`, `renderFiscalidad`, `openFeedbackModal`.

Las trazas de Sentry van a ser legibles sin hacer nada. Lo que se pierde es el
número de línea. Implementado como paso opcional (`npm run build:sentry`), que
genera, sube y **borra** los mapas, y **aborta si queda alguno**. Verificado:
build normal 0 mapas, con `VITE_SOURCEMAP=1` 3 mapas, tras el borrado 0.

### Analítica

**Cloudflare Web Analytics descartada**: no admite eventos personalizados, y
el encargo necesita 8. Recomendada **Umami Cloud** (plan gratuito, eventos con
propiedades, sin cookies), con Plausible como alternativa de pago. El código
detecta cuál está cargada, así que cambiar son dos variables.

`track()` tiene **dos listas blancas cerradas** (nombres de evento y de
propiedad) y, además, **descarta todos los números**: un número es lo único
que puede ser un importe. Un valor con pinta de cifra también se tira, y los
valores con lista cerrada que llegan con algo inesperado pasan a `otro`.

Respeta Do Not Track, Global Privacy Control, localhost, modo demo y el
interruptor de Ajustes.

### Pruebas

**51 tests nuevos** (`src/tests/monitoring.test.js`). Con un receptor falso de
Sentry y curl contra el servidor arrancado:

| Prueba | Resultado |
|---|---|
| Importe, IBAN, correo y token en el error de prueba | **los 4 redactados**, 0 fugas ✅ |
| El evento no lleva `request`, `server_name` ni correo | ✅ |
| `user` solo con el hash de 16 caracteres | ✅ |
| `tags` solo con método y ruta sin query | ✅ |
| `/api/health` con `FINOVA_PROXY_SECRET` puesta | **200** (antes 403) ✅ |
| `/api/ai-status` sin la cabecera del proxy | **403** (sigue protegido) ✅ |
| `/api/health/deep` sin secreto / con secreto malo | **404** las dos ✅ |
| `/api/health/deep` con secreto correcto | **200** con los 3 chequeos ✅ |
| CSP servida sin variables / con `SENTRY_INGEST_ORIGIN` | comodines / host exacto ✅ |
| La app con TODAS las variables vacías | arranca y responde 200 ✅ |
| `find dist -name "*.map"` | **0** ✅ |

### Lo que NO se pudo verificar

1. **El apagado ordenado con una señal real.** Windows no tiene SIGTERM
   POSIX: `taskkill` es una muerte dura y el `kill -INT` de Git Bash no llegó
   al proceso de Node. La lógica está cubierta con tests que fijan el orden
   (cerrar → guardar → flush → salir) y la idempotencia, pero **el
   comportamiento real solo se verá en Railway**, que es Linux.
2. **Sentry de verdad.** Todo se probó contra un receptor local que capturaba
   los *envelopes*. No hay cuenta de Sentry, así que no se ha visto un evento
   en su panel ni se ha probado la subida de source maps.
3. **La analítica de verdad.** Sin cuenta de Umami no se ha cargado su script
   ni se ha visto un evento llegar.
4. **La CSP en un navegador.** Se verificó la cabecera que se sirve, no que un
   navegador real no bloquee nada. Hay que mirar la consola tras desplegar.
5. **Los precios y límites de los planes.** Marcados `[VERIFICAR]` en
   `MONITORING_SETUP.md` con el sitio donde comprobarlos. No los doy por
   ciertos.

### Aviso de `npm audit`

`@sentry/node@11` arrastra `@sentry/bundler-plugins` como dependencia de
**ejecución**, y de ahí vienen avisos en `deepmerge`, `glob` y `minimatch`.
Ese paquete solo se usa para subir source maps en tiempo de build: el servidor
en marcha no lo llama nunca. `npm audit fix` propone **bajar a la v10** (cambio
de versión mayor), que es peor negocio que el aviso. **No se ha hecho**, queda
documentado para revisar en un par de meses.

Ver `MONITORING_SETUP.md` (configuración manual) y `MONITORING_CHECKLIST.md`
(rutina diaria de 10 minutos para los primeros 30 días).

---

## FASE 13 — Ficha de historial de una transacción · ✅ COMPLETA

Al pulsar una transacción se abre una ficha que cruza esa compra con todas
las anteriores: establecimiento, categoría, productos y tickets.

### Lo que había de verdad en los datos (se comprobó antes de escribir)

| Dato | ¿Existe? |
|---|---|
| Importe, fecha, descripción, categoría | Sí |
| `receipt.merchant` (nombre limpio del establecimiento) | Sí, **solo** si vino del escáner |
| `receipt.items[]` con `{name, qty, unitPrice, total}` | Sí — los productos son reales |
| `receipt.taxBase / taxAmount / taxRate` | Sí — el IVA es real |
| `receipt.receiptNumber`, `taxId`, `paymentMethod`, `time` | Sí |
| Foto del justificante (IndexedDB vía `loadPhoto`) | Sí |
| **Subcategorías** | **NO existen** |

**Las subcategorías no existen en ninguna parte:** ni en el modelo de datos,
ni en la interfaz, ni en el escáner (su propio prompt dice «no uses
subcategorías»). El encargo pedía estadísticas de subcategoría; la ficha dice
explícitamente que Finova no las usa en vez de inventar un nivel que no hay.

### El problema central: identificar el establecimiento

Ya existía `txPatternKey` en `script.js`, y la tentación era reutilizarla.
**No sirve**, y comprobarlo fue el trabajo que evitó el peor fallo posible:
esa función está hecha para CATEGORIZAR, donde sobre-agrupar es inofensivo
(dos farmacias distintas son las dos «Salud»). Para IDENTIDAD sobre-agrupar
es una mentira que enseña al usuario estadísticas de un negocio en el que no
ha estado.

Medido contra 9 pares reales: **5 mal agrupados**.

```
FARMACIA LOPEZ      / FARMACIA RUIZ       → farmacia   / farmacia    ✗
RESTAURANTE EL FARO / RESTAURANTE LA MINA → restaurante/ restaurante ✗
PANADERIA SOL       / PANADERIA LUNA      → panaderia  / panaderia   ✗
GASOLINERA REPSOL   / GASOLINERA CEPSA    → gasolinera / gasolinera  ✗
CLINICA DENTAL NORTE/ CLINICA DENTAL SUR  → clinica    / clinica     ✗
```

La clave propia (`mhMerchantKey`) usa **tres listas de datos** en vez de
heurística pura:

- **Genéricos** (`farmacia`, `bar`, `restaurante`, `hotel`, `clinica`… 70
  términos): no identifican a nadie, exigen la palabra siguiente.
- **Marcas cortas** (`dia`, `zara`, `ikea`, `lidl`, `bp`… ): sí identifican
  solas. Sin esta lista, una regla de «5 letras o más» habría partido
  «ZARA GRAN VIA» de «ZARA CALLAO», que son la misma tienda.
- **Ruido de extracto** (`compra`, `tpv`, `redsys`, `tarj`…).

**Sin coincidencia difusa, a propósito.** Solo igualdad exacta de la clave
normalizada. El encargo pedía no agrupar sin confianza suficiente, y es la
única regla que no inventa relaciones. El coste es quedarse corto alguna vez
(dos grafías muy distintas del mismo sitio no se juntan), que es el error
barato: el usuario ve dos fichas en vez de una mentira.

### Dos bugs propios encontrados probando

1. **«HOTEL 4» y «HOTEL 55» daban la misma clave.** Los números puros se
   descartaban siempre (en un extracto suelen ser el número de terminal), así
   que en un nombre genérico desaparecía lo único que distinguía. «BAR 100» y
   «BAR 200» igual. «PARKING 24H» se salvaba de casualidad, porque «24h» es
   alfanumérico. Ahora, si el genérico no tiene otra palabra detrás, el número
   vale como discriminador.

2. **El prefijo `TARJ`/`TARJETA` impedía agrupar.** «COMPRA TARJ. 1234
   MERCADONA» no se juntaba con «MERCADONA», y es una de las formas más
   habituales en los extractos españoles.

Los dos tienen test de regresión.

### Decisiones que merecen explicación

**Las devoluciones no se suman al total gastado.** Una devolución de Mercadona
es un ingreso; meterla en «total gastado» daría un total menor que el real y
una media falseada. Se cuentan aparte y la ficha lo dice.

**La frecuencia se divide entre los INTERVALOS, no entre las compras.** Del 4
de julio al 30 de octubre con 6 compras son 118 días y 5 intervalos → 24 días.
Dividir entre 6 daría 20, que es el error clásico. Con una sola compra la
frecuencia es `null`, no 0.

**La comparación devuelve `null` cuando no hay con qué comparar**, en vez de
un 0 % que parecería un dato.

**El índice se memoiza y se invalida por importe, no solo por longitud.**
Editar un importe sin añadir transacciones también tiene que recalcular.

**Los gráficos se pintan al abrir su bloque**, no al abrir la ficha: montar
dos Chart.js que nadie va a mirar es tiempo regalado, y el canvas de un
`<details>` cerrado tiene altura 0, así que se dibujaría mal.

**La fila se cablea con delegación en el `<tbody>`**, no con un listener por
fila: la tabla usa scroll virtual y reescribe el HTML en cada desplazamiento.
Y las filas, que ya tenían `tabindex="0"`, ahora responden a Enter — antes
eran alcanzables con Tab pero no hacían nada.

### Pruebas

**48 tests nuevos** (`src/tests/tx-history.test.js`), con los valores
esperados calculados a mano, no copiados de la salida. Más una prueba de
render que monta la ficha completa con un historial realista y comprueba **24
cosas** en el HTML resultante.

Las cuentas, verificadas de forma independiente:

| Dato | A mano | En pantalla |
|---|---|---|
| Total de 6 compras | 292,45 € | 292,45 € ✅ |
| Media | 48,74 € | 48,74 € ✅ |
| Frente a la media de las otras (45,41 €) | +44,0 % | «un 44 % más» ✅ |
| Frente a la anterior (18,40 €) | +255,4 % | +255.43% ✅ |
| Frecuencia (118 d / 5 intervalos) | 23,6 d | «cada 24 d» ✅ |
| Precio medio de la leche (0,95/0,99/1,05) | 0,9967 € | 1,00 € ✅ |

Rendimiento: el índice de **5.000 transacciones** se construye en menos de
1,5 s y se memoiza.

### Tres cosas corregidas de paso

1. **«Este mes: 0,00 €» desconcertaba.** Al abrir una transacción del 30 de
   octubre un 1 de noviembre, el dato es correcto pero parece roto. Ahora la
   fila se llama «Noviembre (este mes)».

2. **Dos fuentes distintas de «qué mes es».** `_expCatScaleCutoff` usaba su
   propio `new Date()` mientras `_expCatInScale`, dos líneas más abajo, usaba
   `getCurrentMonth()`. En producción dan lo mismo, pero la divergencia hacía
   la escala imposible de fijar en una prueba: al cruzar a noviembre, tres
   tests del reparto por categorías se pusieron rojos. Ahora hay una sola
   fuente. **No lo causó esta fase** — es la misma clase de bug que el
   `_monthsAgoYM` de la Fase 11.

3. **Incoherencia de formato que NO se ha tocado:** el proyecto formatea el
   dinero con coma decimal y los porcentajes con punto (`formatPct` da
   «+44.00%»). La ficha reutiliza `formatPct` para no inventar una tercera
   convención, pero **conviene resolverlo de una vez en toda la app**: afecta
   al dashboard, la cartera y el patrimonio, y cambiarlo solo aquí habría
   dejado dos estilos conviviendo. Queda en los pendientes.

### Lo que no se pudo verificar

No hay navegador en este entorno. La ficha se ha renderizado de verdad y se
ha leído su HTML y su texto, pero **nadie la ha visto**: quedan por comprobar
a ojo los dos gráficos de Chart.js (el render se probó con `Chart`
indefinido, así que la rama de dibujo no se ha ejecutado), la imagen del
justificante desde IndexedDB, los 5 temas y el comportamiento a 375 px.

Suite: **761 en verde**, 29 suites. Build correcto.

---

## FASE 14 — Comparador universal de precios · ✅ COMPLETA

Un único motor que responde a «¿dónde he pagado menos por lo mismo?» para
cualquier sector. Documentado aparte en [PRICE_COMPARE.md](PRICE_COMPARE.md).

- Motor: `src/utils/price-compare.js` (sin interfaz, sin dependencias)
- Interfaz: bloque «Comparador de precios» de la ficha de una transacción
- Tests: `src/tests/price-compare.test.js` — **80 casos**

### La regla que gobierna el diseño

Antes de comparar dos precios hay que **poder afirmar** que son comparables.
Cada par se clasifica en `identico` / `equivalente` / `similar` /
`no-comparable`, y **solo los dos primeros se comparan en precio**. El cuarto
nivel es lo que lo mantiene honesto: una comparación de menos es una
molestia, una comparación falsa es un número inventado que el usuario se cree.

### Lo que había de verdad en los datos

| Dato | ¿Existe? |
|---|---|
| `receipt.items[].name`, `qty`, `unitPrice`, `total` | Sí |
| `receipt.items[].brand`, `size`, `sizeUnit` | **Añadidos** al escáner con esta fase |
| Importe, fecha, categoría, comercio | Sí |
| Código de barras, referencia, modelo, SKU | **NO** |
| Especificaciones, duración, condiciones de un servicio | **NO** |
| Noches de hotel, coberturas de seguro, kilómetros | **NO** |
| Importador de facturas aparte del escáner | **NO existe** |

El encargo mencionaba casi todo lo de la mitad inferior. No se ha inventado
ninguno: donde falta el dato, el motor **no compara, dice que no puede**. Por
eso un hotel se compara por importe por operación y con la advertencia a la
vista, y no por €/noche, que es lo que haría falta y no se puede calcular.

### Los tres campos nuevos del escáner

`brand`, `size` y `sizeUnit`, con instrucciones explícitas de **preferir
`null` a inventar**: un tamaño inventado produce una comparación falsa, que es
peor que no tener comparación. Las unidades se validan contra una lista
cerrada (`kg g l ml cl ud m cm`) y cualquier otra se descarta. `size` es el
contenido de UNA unidad, no del lote.

**Los tickets escaneados antes de esta versión no los llevan**, y el motor
funciona igual con menos precisión: cae al tamaño escrito en el nombre
(«LECHE SEMI 1 L») y, si tampoco está, trata el producto por unidad.

### Cuatro bugs de precisión encontrados probando

1. **«iPhone 15 128GB» y «iPhone 16 128GB» salían IDÉNTICOS.** Los tokens de
   menos de 3 caracteres se descartaban, así que los números de modelo
   desaparecían y los dos núcleos quedaban en `iphone 128gb`. Igual «Nike Air
   90» y «Nike Air 95». Ahora los números se conservan siempre: son
   discriminadores de modelo, versión o año.

2. **El núcleo recortado a las primeras palabras fundía configuraciones.**
   «IdeaPad 15 16GB» y «IdeaPad 15 8GB» daban el mismo núcleo, perdiendo justo
   lo que explica los 30 € de diferencia. El núcleo usa ahora todas las
   palabras.

3. **La lista de «productos parecidos» estaba SIEMPRE vacía.** La comparación
   solo miraba dentro del grupo del propio núcleo, donde por definición todo
   comparte núcleo, así que el nivel `similar` era inalcanzable entre
   productos distintos. Era un campo que mentía por omisión. Se arregló con un
   segundo índice por familia (magnitud + primera palabra del núcleo).

4. **Una `qty` de 0 con un total positivo producía un precio.** El salto a «el
   total es el precio de una unidad» está pensado para una `qty` DESCONOCIDA
   (`null`); un 0 explícito contradice un total positivo, y de un dato
   contradictorio no sale un precio, sale un invento. Lo encontró un test.

Los cuatro tienen test de regresión.

### Dos fallos de presentación corregidos tras leer el render

**Decimales incoherentes en la misma columna.** «0,890 €/l» junto a
«1,05 €/l» hacía ilegible justo lo que la tabla existe para comparar. Ahora
los decimales se deciden **una vez por columna**. Y los precios y las
diferencias son **dos** columnas con decisiones separadas: con una sola, una
diferencia de 0,85 € forzaba tres decimales sobre precios de 9,80 €.

**La tabla pintaba un valor y ordenaba por otro.** Los productos se ordenan
por su último precio y los servicios por su importe medio; la tabla pintaba
siempre el último. En un servicio eso podía poner la etiqueta «más barato»
sobre el número más alto de la columna.

### Lo que nunca se afirma

**Ningún precio se presenta como actual.** La procedencia viaja con el dato
(`linea-ticket`, `importe-total`, y `externa`/`estimada` reservadas), y cada
cifra de ahorro lleva la fecha y el comercio del precio con el que compara:
«es el precio que tú pagaste allí el 05/08/2026, no una oferta de hoy».

**La periodicidad se mide, no se deduce de la categoría.** Una suscripción se
reconoce porque se repite cada ~30 días con desviación menor del 25 %. Si las
cadencias están mezcladas (uno mensual de 12 € y otro anual de 120 €), no se
presenta un coste mensual: cae a `€/operación`.

**El combustible se deduce del NOMBRE, no de la categoría.** «Transporte»
incluye gasolina (litros) y abonos de metro (viajes): tratar la categoría
entera como litros daría un €/l inventado.

**Cada cifra dice cuántos precios la sostienen.** Con uno solo pone «1 solo
precio», resaltado: una media de un dato no es una media.

**Las comparaciones de servicio llevan advertencia visible:** el importe es
real, pero Finova no guarda las condiciones de lo contratado, así que la
equivalencia no está verificada.

### Pruebas

80 tests con los valores calculados a mano, cubriendo los once sectores que
pedía el encargo: supermercados, restaurantes, gasolineras, tecnología, ropa,
hoteles, transporte, seguros, gimnasios, suscripciones y servicios
profesionales. Más un render real del bloque con un historial de seis
sectores, leído entero.

Aritmética verificada de forma independiente:

| Dato | A mano | Obtenido |
|---|---|---|
| Lidl 500 ml a 0,49 € → €/l | 0,49 / 0,5 = 0,98 | 0,980 ✅ |
| Ahorro de la leche por litro | 1,05 − 0,89 = 0,16 | 0,160 ✅ |
| Ahorro en esa compra (6 × 1 L) | 6 × 0,16 = 0,96 | 0,960 ✅ |
| Variación del precio de la leche | 0,16 / 0,89 = 17,98 % | 17,98 ✅ |
| Ahorro de 42 l de gasolina | 42 × 0,20 = 8,40 | 8,400 ✅ |
| Cadencia (08/05→08/10, 5 intervalos) | 153 / 5 = 30,6 d | 30,6 ✅ |
| Aceite Lidl 750 ml a 6,99 € → €/l | 6,99 / 0,75 = 9,32 | 9,32 ✅ |
| Ahorro total de la compra | 0,96 + 0,85 = 1,81 | 1,81 ✅ |

Rendimiento: 5.000 transacciones (10.000 líneas) se indexan en menos de
200 ms, y se memoiza.

### La limitación de fondo, dicha claramente

**Todo lo que dice el comparador es histórico.** «Pagaste menos allí», no
«hoy cuesta menos allí». Quitar esa limitación necesita un proveedor externo
de precios de mercado, que no está contratado ni activado. La arquitectura
está preparada (la fuente `externa` ya existe con `verificado: true,
actual: true` y la interfaz distingue las fuentes al pintar), pero la
integración no se ha hecho.

En `PRICE_COMPARE.md` están las cuatro integraciones que lo ampliarían, con
lo que resolvería cada una y su coste real. La de mejor relación
coste/beneficio **no necesita ningún servicio externo**: leer el €/kg o €/l
que muchos tickets españoles ya imprimen en la línea.

### Lo que no se pudo verificar

No hay navegador. El bloque se ha renderizado de verdad y se ha leído su HTML
y su texto, pero **nadie lo ha visto**: quedan por comprobar a ojo el gráfico
de evolución con Chart.js cargado (el render se probó con `Chart` indefinido,
así que se ejecutó la rama de texto), los 5 temas, el comportamiento a 375 px
y los destinos táctiles de 44 px en un dispositivo real.

Suite: **841 en verde**, 30 suites, 23 omitidos. Build correcto.

---

## FASE 15 — Auditoría de exposición de ficheros estáticos · ✅ COMPLETA

Documentado en [SECURITY.md](SECURITY.md), sección «Ficheros estáticos».

### Lo primero: el fallo descrito NO estaba abierto

El encargo partía de que `server.cjs` servía estáticos con
`path.join(ROOT, url)` sin validar. **No era así.** Ya había un allowlist
explícito (`_PUBLIC_ROOT_FILES`) y una comprobación de confinamiento. Se
reprodujo antes de tocar nada, con `curl --path-as-is` y la cabecera `Host`
puesta a mano, y las 31 rutas sensibles del guion ya devolvían 404:
`data/users/*.json`, `server.cjs`, `.git/config`, `.env.*`, `package.json`,
`node_modules/`, y todas las variantes de salida de directorio (`../`,
`%2e%2e`, `..%2f`, `%252e%252e`, `..%5c`, `C:/`, `::$DATA`, `%00`).

Decirlo importa porque el resto del trabajo no es «cerrar una brecha
crítica», es endurecer algo que ya estaba razonablemente bien. La diferencia
entre esas dos cosas cambia qué hay que rotar y qué hay que contarle a
quien dependa de esto.

### Lo que SÍ estaba mal, y se ha corregido

**1. `/src/tests/*.js` se servía con 200.** La regla era
`startsWith('src/') && endsWith('.js')`, así que la suite de tests entera
era descargable: `/src/tests/calc.test.js` devolvía 11.983 bytes. No
contiene secretos, pero sí la lógica de cálculo y los casos límite — un mapa
de dónde apretar. **Es el único cambio de código 200 → 404 de toda la
auditoría.**

**2. Cualquier método HTTP servía el fichero.** `POST`, `PUT`, `DELETE` y
`PATCH` sobre `/index.html` devolvían los 170.716 bytes de la página con un
200. Inofensivo de por sí, pero confunde a las cachés intermedias y no tiene
ningún motivo para existir. Ahora solo `GET` y `HEAD`.

**3. `HEAD` devolvía el cuerpo completo.** Que es exactamente lo que `HEAD`
existe para evitar. Ahora responde las mismas cabeceras con `Content-Length`
y sin cuerpo.

**4. No había forma de apagar los estáticos.** En producción el frontend lo
sirve Vercel, pero este proceso seguía exponiendo el allowlist desde la raíz
del proyecto. Ahora `SERVE_STATIC` es `false` por defecto cuando
`NODE_ENV=production`: todo lo que no sea `/api/*` responde el mismo 404
genérico, y la API sigue igual.

**5. No se resolvían los enlaces simbólicos.** Un enlace dentro de la raíz
que apunte fuera pasaba la comprobación de confinamiento, porque se hacía
solo sobre la ruta construida. Ahora se repite después de `fs.realpathSync`.

**6. Los intentos denegados no dejaban rastro.** Ahora se registran con la
ruta truncada a 120 caracteres, sin cabeceras y con la IP recortada
(`127.0.x.x`), y pasan por un cubo de 30 por IP: un 404 suelto no ensucia el
log y un escaneo deja de escribir en cuanto lo agota. Lo que entra en el log
acaba en Sentry, y un escaneo mete ahí lo que le dé la gana.

**7. `PORT` era la cadena cruda del entorno.** `process.env.PORT || 3000` da
un string cuando la variable está puesta, y se colaba en la cabecera
`Location` de la redirección y en la lista de orígenes permitidos. Funcionaba
por coincidencia.

**8. Cada arranque abría una pestaña del navegador.** Encontrado al escribir
las pruebas, que arrancan el servidor una vez por escenario: la suite abría
tres pestañas en la máquina de quien la ejecutara. Ahora no se abre con
`NODE_ENV=test` ni con `FINOVA_NO_OPEN=1`.

### Las cinco capas

Una petición tiene que pasarlas todas: método (solo GET/HEAD), forma de la
URL (ni byte nulo, ni `\`, ni `:`, ni `//`, ni segmentos `..` o que empiecen
por `.`), lista blanca, extensión + lista negra, y confinamiento con
`path.resolve` **y otra vez** tras `realpathSync`.

La lista blanca es la que de verdad protege, y es a propósito una lista de lo
**permitido**: una lista negra falla en silencio cada vez que alguien añade
un fichero al proyecto. Las otras cuatro están para que un fallo en ella no
sea explotable.

**Una decisión que conviene conocer:** el guion pedía sustituir el allowlist
por una lista de extensiones más una denylist. Eso habría sido *más*
permisivo que lo que ya había — `faq.html`, `docs/`, `ejemplos/` y
`branding/` habrían pasado a ser servibles. Se ha hecho al contrario: el
allowlist se mantiene como puerta principal y la denylist se añade encima,
de modo que hay que pasar las dos.

### Entradas de usuario en rutas de fichero (paso 2)

Auditados todos los `path.join` / `readFileSync` / `writeFileSync` /
`existsSync` que tocan datos del cliente. **La validación en el borde ya
estaba bien:** `_UID_RE` (`/^[a-zA-Z0-9]{20,128}$/`) y `_SYNC_CODE_RE`
(`/^[a-f0-9]{8,16}$/`) se aplican antes de construir cualquier ruta, también
al `targetUid` de los dos endpoints de admin, y ninguna admite `.`, `/` ni
`\`.

Lo que se ha añadido es `_safeJoin(base, nombre)` **en el punto de uso**:
`_metaPath`, `_blockedPath`, el fichero de datos de usuario y los dos
extremos de sync. Así la garantía deja de depender de que cada llamante se
acuerde de validar; un endpoint nuevo que lo olvide se topa con esto igual.

### Pruebas

`tests/static-guard.test.cjs`, con `node:test` y **sin dependencias nuevas**.
**52 comprobaciones** en tres escenarios: desarrollo, producción y
`SERVE_STATIC=false` forzado.

Tres cosas las hacen valer algo:

1. **Arrancan el servidor de verdad**, como proceso aparte, y le hablan por
   HTTP. Llamar a `_resolveStatic` directamente probaría la función, no el
   camino completo donde vive el fallo.
2. **La ruta se envía tal cual**, sin normalizar. Usar `new URL()` probaría
   justamente la versión ya saneada de lo que se quiere rechazar.
3. **Se mira el CUERPO, no solo el código.** Se busca el contenido concreto
   que no debe salir: el cebo de datos de usuario, `createServer`,
   `repositoryformatversion`, `root:x:`, `devDependencies`.

Hay un test que compara cuerpo y código de un fichero **denegado** con uno
**inexistente** y exige que sean idénticos: un 403 o un mensaje distinto le
confirmarían a quien escanea que el fichero existe.

Los datos falsos (`data/users/zz-test-uid.json`, `data/sync/zzzztest.json`)
se crean y se borran en `after`, más un `process.on('exit')` por si un test
revienta o alguien corta la ejecución.

`npm test` sigue siendo solo jest: `jest.config.js` limita `testMatch` a
`src/tests/**`, así que `tests/*.test.cjs` no lo recoge. El nuevo script es
`npm run test:security`.

### Higiene

`.gitignore` ya cubría `firebase-service-account.json` y
`*service-account*.json`. Se han añadido `backups/`, `*.tar.gz`, `*.tgz`,
`*.zip`, `*.enc`, `*.dump` y `*.sql`: un volcado del dataset dentro del
repositorio es el mismo problema que esta auditoría venía a cerrar, pero
publicado en GitHub, que es peor porque no se puede retirar.

### Lo que no se pudo verificar

**No se ha probado contra un despliegue real de Railway.** Todo está medido
en local, con `NODE_ENV=production` simulado. Si el proxy de Railway
normaliza o reescribe rutas antes de llegar al proceso, el comportamiento
ante una URL rara puede diferir.

**No se ha auditado si el servidor estuvo accesible públicamente con la
versión anterior.** No tengo acceso a los logs de Railway ni a su
configuración de red, así que no puedo decir si alguien pidió alguna de
estas rutas ni desde dónde. Lo que sí se puede afirmar es que las rutas
sensibles **ya devolvían 404 antes** de este trabajo: lo único que estuvo
servible de más es `src/tests/*.js`, que no contiene secretos.

**Sin navegador.** La app se ha probado por HTTP (códigos, cabeceras,
cuerpos), pero nadie ha cargado la página para comprobar que no falta ningún
recurso. El riesgo concreto es que el frontend pida en desarrollo algún
fichero que no esté en el allowlist y que antes se colara por la regla de
`src/**/*.js`; los siete recursos principales se han verificado con 200.

Suite: **942 en verde** (jest, 31 suites) + **52 en verde** (seguridad).

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
5. **Popup de Google en producción** (Fase 5b): las cabeceras que lo rompían
   (COOP y CSP) están verificadas con curl, pero el popup real contra el
   dominio desplegado no se puede probar sin navegador. Al probarlo, mirar
   también que el dominio esté en Firebase Console → Authentication →
   Authorized domains: si falta, el error que sale es
   `auth/unauthorized-domain` y la app ya lo explica con el hostname dentro
   del mensaje.
6. **Eyebrow de la landing**: el `<title>` ya no dice "para la comunidad
   FIRE", pero el texto sobre el titular del hero todavía pone "Para la
   comunidad FIRE española". Solo se pidió cambiar el título, así que se ha
   dejado — decir si también sale.

### Del borrado de cuenta (Fase 10)

7. **Probar el borrado de verdad, en producción.** Es lo único que cierra el
   círculo: hace falta Firebase real (service account) para ver
   `revokeRefreshTokens` + `deleteUser` ejecutándose, y un navegador para el
   popup de reautenticación de Google. Al probarlo, comprobar que tras borrar
   un token anterior ya no vale y que la cuenta no aparece en Firebase
   Console → Authentication.

8. **Decidir si `FIREBASE_*` va a estar configurada en producción.** Si no lo
   está, el servidor no puede borrar la cuenta de Auth y lo hace el cliente
   con `user.delete()`. Funciona, pero depende de que el navegador complete
   el proceso: si el usuario cierra la pestaña justo ahí, los datos del
   servidor ya no existen pero la cuenta de Auth sigue viva (huérfana, sin
   datos). Con el Admin SDK configurado esa ventana no existe.

9. **La guarda de localhost en `_saveUserMeta` y la analítica.** Mientras
   siga ahí, en producción no hay `.meta.json`, así que el borrado no puede
   resolver el email y no limpia `waitlist.json` ni `extra_admins.json`. Es
   una decisión de producto: o se quita la guarda (y se envía el email al
   servidor también en producción, lo que hay que reflejar en la política),
   o se acepta que la entrada en la lista de espera sobreviva al borrado y se
   quite a mano cuando alguien lo pida.

10. **Códigos de sync antiguos (anteriores a `sync_owners.json`).** No tienen
    dueño anotado, así que se siguen permitiendo para no romper a quien los
    use, y por tanto cualquier usuario autenticado que conozca uno puede
    descargarlo. Opciones: caducarlos (borrar los `data/sync/*.json`
    huérfanos pasados N días), o exigir dueño siempre y asumir que quien
    tenga un código viejo tenga que generar uno nuevo. **Recomendado:** lo
    segundo, porque la función ya está oculta en la interfaz para usuarios
    autenticados (`syncCard` se esconde en `_injectAuthUI`), así que el
    impacto es mínimo.

12. **Porcentajes con punto, dinero con coma.** `formatPct` (utils.js) da
    «+44.00%» y `formatCurrency` da «1.234,56 €». En español los decimales
    van con coma en los dos casos. Afecta al dashboard, la cartera, el
    patrimonio y la ficha de historial. Es un cambio de una línea en
    `formatPct` más revisar que nadie dependa del formato antiguo, pero toca
    muchas pantallas a la vez: dime si lo hago.

13. **Ver la ficha de historial en un navegador.** Está probada por código
    (48 tests + un render completo verificado), pero los dos gráficos de
    Chart.js no se han dibujado nunca de verdad (el render se probó con
    `Chart` indefinido). Al abrirla, comprobar los gráficos, la imagen del
    justificante, los 5 temas y 375 px.
14. **Ver el comparador de precios en un navegador** (Fase 14). Está probado
    por código (80 tests + un render de seis sectores leído entero), pero el
    gráfico de evolución del precio no se ha dibujado nunca de verdad: el
    render se probó con `Chart` indefinido, así que se ejecutó la rama de
    texto. Comprobar también los 5 temas, 375 px y que los destinos táctiles
    lleguen a 44 px.
15. **Escanear tickets nuevos para que el comparador gane precisión**
    (Fase 14). Los campos `brand`, `size` y `sizeUnit` se han añadido al
    escáner con esta fase: **los tickets escaneados antes no los llevan**. El
    comparador funciona igual sin ellos, pero con menos precisión (cae al
    tamaño escrito en el nombre y, si no está, trata el producto por unidad).
    Al probar el escáner de verdad, mirar si la IA rellena bien los tres
    campos nuevos o si hay que afinar el prompt.
16. **Decidir si se quiere una fuente externa de precios actuales**
    (Fase 14). Es la única limitación de fondo del comparador: todo lo que
    dice es histórico («pagaste menos allí», no «hoy cuesta menos allí»). La
    arquitectura ya está preparada y `PRICE_COMPARE.md` lista las cuatro
    integraciones posibles con su coste. **Ninguna está contratada ni
    activada.** La de mejor relación coste/beneficio no necesita servicio
    externo: leer el €/kg o €/l que muchos tickets españoles ya imprimen.
11. **Dos políticas de privacidad.** `privacidad.html` (la que enlazan la
    landing y `terminos.html`) y `privacy.html` (que enlaza `terms.html`) son
    documentos distintos, los dos en español, con estructura y contenido
    diferentes, y los dos se publican. Ahora ambos describen el borrado de
    cuenta, pero conviene quedarse con uno solo: mantener dos políticas
    legales en paralelo acaba en contradicciones.
