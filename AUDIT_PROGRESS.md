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

Ver `FEEDBACK_SETUP.md` para la configuración manual.

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

11. **Dos políticas de privacidad.** `privacidad.html` (la que enlazan la
    landing y `terminos.html`) y `privacy.html` (que enlaza `terms.html`) son
    documentos distintos, los dos en español, con estructura y contenido
    diferentes, y los dos se publican. Ahora ambos describen el borrado de
    cuenta, pero conviene quedarse con uno solo: mantener dos políticas
    legales en paralelo acaba en contradicciones.
