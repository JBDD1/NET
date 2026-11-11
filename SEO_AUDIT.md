# Auditoría de SEO técnico — Finova

**Fecha:** 11 de noviembre de 2026
**Alcance:** `index.html`, `landing.html`, `faq.html`, `privacidad.html`,
`privacy.html`, `terminos.html`, `terms.html`.
**Reglas aplicadas:** sin tocar diseño visual ni lógica JS; descripciones y
títulos precisos y sin superlativos vacíos; antes/después de cada etiqueta.

> **Dominio base:** provisional `https://jbdd1.github.io/NET` (el dominio propio
> aún no se ha comprado). Centralizado en una sola constante — ver Paso 5.

---

## Paso 1 — Titles y descriptions

Todos los títulos ahora son únicos, 50–60 caracteres y con la marca al final;
todas las descripciones son únicas y de 140–160 caracteres.

| Página | Title nuevo | Long. | Description nueva (resumen) | Long. | Acción |
|---|---|---|---|---|---|
| index.html | Tu panel de patrimonio, inversiones y objetivos \| Finova | 56 | Panel privado: patrimonio, cuentas, inversiones, transacciones, fiscalidad y objetivos; datos en el dispositivo | 154 | Reescritos (antes 34 y 117, genéricos) |
| landing.html | Finanzas personales, inversiones e IRPF en España \| Finova | 58 | Patrimonio, inversiones e IRPF en una app; gratis, sin anuncios, Asesor IA, datos en el dispositivo; alternativa a Finary | 157 | Title acortado (64→58); descr. ampliada (130→157) |
| faq.html | Preguntas frecuentes: datos, banco y cuenta \| Finova | 52 | (sin cambios: ya era específica y de 155) | 155 | Solo title (antes 29) |
| privacidad.html | Política de privacidad: tus datos en tu dispositivo \| Finova | 60 | Qué datos se tratan, por qué viven en el dispositivo y no en servidores, y derechos RGPD | 153 | Reescritos (antes 31 y 113) |
| privacy.html | Privacidad: dónde viven tus datos financieros \| Finova | 54 | Datos financieros en el dispositivo, no en servidores, borrables; derechos RGPD | 159 | Title distinto + **descr. creada** (no tenía) |
| terminos.html | Términos de uso: condiciones y avisos legales \| Finova | 54 | Condiciones del servicio, limitación de responsabilidad y cálculos de IRPF solo orientativos | 149 | Reescritos (antes 24 y 140) |
| terms.html | Términos del servicio y responsabilidad legal \| Finova | 54 | Qué ofrece el servicio, responsabilidades y por qué las estimaciones no sustituyen a un asesor | 157 | Title distinto + **descr. creada** (no tenía) |

**Antes/después de cada etiqueta** (title + description):

```
index.html
- <title>Finova — Gestión Financiera Personal</title>
+ <title>Tu panel de patrimonio, inversiones y objetivos | Finova</title>
- description="Finova — Gestión financiera personal. Controla tu patrimonio, inversiones, transacciones y objetivos en un solo lugar."
+ description="Panel privado de Finova para controlar tu patrimonio, cuentas, inversiones, transacciones, fiscalidad y objetivos. Tus datos se guardan en tu dispositivo."

landing.html
- <title>Finova — App de finanzas personales, inversiones e IRPF en España</title>
+ <title>Finanzas personales, inversiones e IRPF en España | Finova</title>
- description="Controla tu patrimonio, inversiones e IRPF en una sola app. Gratis, sin anuncios y con Asesor IA. La alternativa española a Finary."
+ description="Controla tu patrimonio, inversiones e IRPF en una sola app. Gratis, sin anuncios, con Asesor IA y tus datos en tu dispositivo. Alternativa española a Finary."

faq.html
- <title>Preguntas frecuentes — Finova</title>
+ <title>Preguntas frecuentes: datos, banco y cuenta | Finova</title>
  (description sin cambios)

privacidad.html
- <title>Política de Privacidad — Finova</title>
+ <title>Política de privacidad: tus datos en tu dispositivo | Finova</title>
- description="Política de privacidad de Finova. Tus datos financieros se almacenan en tu dispositivo, no en nuestros servidores."
+ description="Política de privacidad de Finova: qué datos tratamos, por qué tus finanzas se guardan en tu dispositivo y no en nuestros servidores, y tus derechos RGPD."

privacy.html
- <title>Política de Privacidad — Finova</title>   (idéntico a privacidad.html → DUPLICADO)
+ <title>Privacidad: dónde viven tus datos financieros | Finova</title>
+ description="Cómo protege Finova tu privacidad: tus datos financieros viven en tu dispositivo, no en nuestros servidores, y puedes borrarlos cuando quieras. Derechos RGPD."
  (antes NO tenía description)

terminos.html
- <title>Términos de Uso — Finova</title>
+ <title>Términos de uso: condiciones y avisos legales | Finova</title>
- description="Términos de uso de Finova. Condiciones de uso, limitación de responsabilidad y naturaleza orientativa de los cálculos financieros y fiscales."
+ description="Términos de uso de Finova: condiciones del servicio, limitación de responsabilidad y por qué los cálculos de IRPF y fiscalidad son solo orientativos."

terms.html
- <title>Términos de Uso — Finova</title>   (idéntico a terminos.html → DUPLICADO)
+ <title>Términos del servicio y responsabilidad legal | Finova</title>
+ description="Condiciones de uso de Finova: qué ofrece el servicio, tus responsabilidades y por qué las estimaciones de IRPF y patrimonio no sustituyen a un asesor fiscal."
  (antes NO tenía description)
```

---

## Paso 2 — Un solo H1 por página

| Página | nº `<h1>` antes | Corrección |
|---|---|---|
| index.html | **17** | 1 h1 (Dashboard, `#dash-greeting`) + los otros 16 → `<h2>`. CSS preservado (ver abajo). |
| landing.html | 1 | Ninguna (correcto) |
| faq.html | 1 | Ninguna |
| privacidad.html | 1 | Ninguna |
| privacy.html | 1 | Ninguna |
| terminos.html | 1 | Ninguna |
| terms.html | 1 | Ninguna |

**index.html — las 16 secciones degradadas a `<h2>`:** Ingresos & Gastos,
Recurrentes, Viajes, Bizums, Cartera, Watchlist, Dividendos, Patrimonio Neto,
Pasivos & Deudas, Activos Alternativos, Objetivos, Simulador, Fiscalidad,
Asesor IA, Panel de administrador, Ajustes. Se mantiene **Dashboard** como
único `<h1>` (es la vista por defecto al abrir la app).

**Preservación visual (clave):** los títulos de sección se estilaban por
descendencia `.section-header h1` en **10 reglas** de `style.css` (tamaño,
subrayado animado `::after`, tamaños responsive). Para que los nuevos `<h2>` se
vean **idénticos** sin tocar el diseño, se cambió el selector a
`.section-header :is(h1,h2)` en las 10 reglas. `:is(h1,h2)` tiene la misma
especificidad que `h1`, así que la cascada no cambia. Antes/después:

```
- .section-header h1 { ... }                         (×10 reglas)
+ .section-header :is(h1,h2) { ... }
- .section-header h1::after { ... }
+ .section-header :is(h1,h2)::after { ... }
- .section.active .section-header h1::after { ... }
+ .section.active .section-header :is(h1,h2)::after { ... }
```

---

## Paso 3 — Jerarquía de encabezados

Árbol de cada página (orden del DOM). **Las páginas indexables ya eran
correctas** (sin saltos); solo cambió index.html.

```
landing.html     h1 → h2 → h3×4 → h2 → h3×4 → h2 → h3×6 → h2 → h2 → h3×4 → h2…   OK (sin saltos)
faq.html         h1 (las preguntas van en <details>/<summary>, no en encabezados)  OK
privacidad.html  h1 → h2 → h2 → h3 → h3 → h3 → h2 → …                              OK
privacy.html     h1 → h2 → h2 → h3 → h3 → h3 → h2 → …                              OK
terminos.html    h1 → h2×16                                                        OK
terms.html       h1 → h2×11                                                        OK

index.html  ANTES:  h1(Dashboard) → h3×14 → h1(Ingresos) → h3… → h1(Cartera) → …   (17 h1, caótico)
index.html  DESPUÉS: h1(Dashboard) → h3×14 → h2(Ingresos) → h3… → h2(Cartera) → …  (1 h1 + 16 h2)
```

**Salto conocido y aceptado (index.html):** dentro de la vista Dashboard,
`h1 → h3` (las 14 tarjetas-widget son `<h3>`, sin `<h2>` intermedio). **No se
corrige** porque: (a) index.html es **noindex** (impacto SEO nulo); (b) forzar
los widgets del Dashboard a `<h2>` los dejaría semánticamente inconsistentes con
tarjetas idénticas de las demás secciones (que son `<h3>` bajo un `<h2>`); y
(c) tocar 14 encabezados más arriesgaría el diseño sin beneficio. Es una SPA
donde cada sección es una vista; el resto de secciones no salta (`h2 → h3`).

---

## Paso 4 — Texto alternativo en imágenes

Solo `index.html` tiene `<img>` (4). El resto de páginas no tiene ninguna, y los
iconos SVG de botones ya llevaban `aria-label`/`aria-hidden` (p. ej.
`sidebar-toggle` → `aria-label="Contraer panel lateral"`; los `<svg>` decorativos
→ `aria-hidden="true"`). No hay `background-image` con valor informativo.

| Página | Imagen | alt antes | alt después |
|---|---|---|---|
| index.html | logo pantalla login (`icon-128`, 60px) | `Finova` | `Finova — gestión financiera personal` |
| index.html | logo `app-loading` (`icon-128`, 68px) | `Finova` | `""` (el contenedor es `aria-hidden="true"`) |
| index.html | logo sidebar (`icon-64`, 34px) | `Finova` | `Finova — gestión financiera personal` |
| index.html | icono `.logo-f` sidebar (`icon-64`, 34px) | `""` | `""` (sin cambios: decorativo, ya correcto) |

---

## Paso 5 — Canonical y dominio base

**Constante única (sin edición manual al cambiar de dominio):** se añadió a
`vite.config.js` (plugin `finova-build-scripts`) la constante **`SITE_URL`**. El
build reescribe la base de todas las URLs canónicas / `og:url` / `og:image` /
`twitter:image` desde esa sola línea. En el código fuente las URLs usan la base
provisional `SRC_BASE` (válida tal cual); al comprar el dominio basta cambiar
`SITE_URL` y reconstruir.

**Canonicals por página:**

| Página | Canonical | Decisión |
|---|---|---|
| landing.html | self → `/NET/landing.html` | Ya existía · correcto (página de marketing indexable) |
| faq.html | self → `/NET/faq.html` | Ya existía · correcto |
| privacidad.html | **self** → `/NET/privacidad.html` | **Añadido.** Versión canónica del par (43 KB, más completa) |
| privacy.html | → `/NET/privacidad.html` | **Añadido** apuntando a la principal (14 KB, duplicado) |
| terminos.html | **self** → `/NET/terminos.html` | **Añadido.** Versión canónica del par (32 KB, más completa) |
| terms.html | → `/NET/terminos.html` | **Añadido** apuntando a la principal (10 KB, duplicado) |
| index.html | **ninguno** | Ver decisión abajo |

**index.html — decisión documentada:** es la **app**, no una landing de
marketing. Ya estaba marcada `robots: noindex, follow` (correcto). **No se añade
canonical:** combinar `noindex` con `canonical` envía señales contradictorias a
los buscadores (Google desaconseja mezclarlos). La landing indexable es
`landing.html`. Se deja `og:url` (sirve para compartir en redes, no es canonical).

**Par duplicado — por qué `privacidad`/`terminos` son las canónicas:** son los
documentos más completos (privacidad 43 KB vs 14 KB; términos 32 KB vs 10 KB) y
las que enlazan la landing y los términos entre sí. `privacy.html`/`terms.html`
son copias más cortas; no se borran (regla), solo consolidadas vía canonical.

---

## Paso 6 — HTTPS forzado

- **HTML:** grep final de `http://` (excluyendo `w3.org` y `localhost`) →
  **0 resultados**. Ningún enlace, canonical, `og:url`, `script src` ni `link
  href` usa `http://`.
- **vercel.json (verificado, NO duplicado):** ya existe `Strict-Transport-Security`
  (HSTS) y la CSP incluye `upgrade-insecure-requests`. Vercel **ya fuerza
  http→https automáticamente** en el dominio de producción, por lo que **no se
  añade una regla de redirect redundante** (según la instrucción).
- **server.cjs (añadido):** para el tráfico HTTP **directo** fuera de Vercel
  (p. ej. Railway), se añadió una redirección **301 a https** en el handler
  principal, guardada: solo si `_IS_PROD`, `req.method` es GET/HEAD y
  `x-forwarded-proto: http`. Sin riesgo de bucle (el edge sirve el https) ni de
  perder el cuerpo de un POST. Antes/después:

```
  // (tras la redirección 127.0.0.1 → localhost existente)
+ if (_IS_PROD && (req.method === 'GET' || req.method === 'HEAD')
+     && req.headers['x-forwarded-proto'] === 'http' && req.headers.host) {
+   res.writeHead(301, { 'Location': `https://${req.headers.host}${req.url}`, ..._SEC });
+   return res.end();
+ }
```

---

## Resumen por página

| Página | Title | Descr. | H1 | Jerarquía | Alt | Canonical |
|---|---|---|---|---|---|---|
| index.html | ✅ reescrito | ✅ reescrito | ✅ 17→1 | ⚠️ salto Dashboard (noindex, aceptado) | ✅ 3 mejorados | ➖ noindex (sin canonical, justificado) |
| landing.html | ✅ acortado | ✅ ampliado | ✅ ya ok | ✅ ya ok | ➖ sin img | ✅ ya ok |
| faq.html | ✅ reescrito | ➖ ya ok | ✅ ya ok | ✅ ya ok | ➖ sin img | ✅ ya ok |
| privacidad.html | ✅ reescrito | ✅ reescrito | ✅ ya ok | ✅ ya ok | ➖ sin img | ✅ añadido (self) |
| privacy.html | ✅ nuevo (distinto) | ✅ creado | ✅ ya ok | ✅ ya ok | ➖ sin img | ✅ añadido → privacidad |
| terminos.html | ✅ reescrito | ✅ reescrito | ✅ ya ok | ✅ ya ok | ➖ sin img | ✅ añadido (self) |
| terms.html | ✅ nuevo (distinto) | ✅ creado | ✅ ya ok | ✅ ya ok | ➖ sin img | ✅ añadido → terminos |

**Verificación final:** `grep http://` → 0 · `npm run build` → «dist/ es
desplegable» · 992 jest + 115 seguridad en verde.

---

## Pendiente de tu decisión

1. **Dominio definitivo.** Todo usa el provisional `https://jbdd1.github.io/NET`.
   Cuando lo compres, cambia **solo** `SITE_URL` en `vite.config.js` y
   reconstruye: se reescriben todas las URLs canónicas y sociales. (Ese cambio no
   toca el código fuente; si además quieres actualizar el fuente, hay más
   referencias listadas en la memoria del proyecto.)

2. **Pareja duplicada: ¿mantener las dos o redirigir?** Elegí `privacidad.html` y
   `terminos.html` como canónicas por ser las más completas, y dejé
   `privacy.html`/`terms.html` consolidadas vía canonical (sin borrar, según la
   regla). Si prefieres, lo más limpio a medio plazo sería un **redirect 301**
   de `privacy.html`→`privacidad.html` y `terms.html`→`terminos.html` y dejar de
   mantener dos documentos legales en paralelo (riesgo de que se contradigan).
   No lo hago sin tu visto bueno porque implica decidir si esas rutas cortas se
   enlazan desde algún sitio externo.

3. **Salto de encabezados en el Dashboard (index.html).** Lo dejé como está por
   ser `noindex` y para no arriesgar el diseño. Si quieres jerarquía perfecta
   también ahí, habría que decidir si los 14 widgets del Dashboard pasan a `<h2>`
   (y revisar que su CSS no dependa del tag `h3`).

---

# Parte 2 — sitemap.xml, robots.txt, meta robots y Search Console

**Fecha:** 11 de noviembre de 2026

> 🔴 **FALTA SUSTITUIR EL DOMINIO. NO HAY DOMINIO REAL CONFIGURADO EN NINGÚN
> SITIO** (ni variable de entorno ni archivo de config; solo existía el
> provisional `jbdd1.github.io` y el backend de Railway). Todo usa el placeholder
> **`https://TU-DOMINIO-REAL`**. **ANTES DE DESPLEGAR: cambia `SITE_URL` en
> `vite.config.js` por tu dominio real y reconstruye.** Es el ÚNICO sitio a tocar.

## Dominio centralizado (una sola constante)

La constante única **`SITE_URL`** vive en **`vite.config.js`** (plugin
`finova-build-scripts`). En el build, reescribe el dominio en **los HTML
(canonical/og/twitter) + `sitemap.xml` + `robots.txt`** de una vez. Las bases de
origen del código fuente (`jbdd1.github.io/NET` en los HTML, `TU-DOMINIO-REAL` en
sitemap/robots) se mapean todas a `SITE_URL`. Verificado: el build reescribió 14
URLs y `dist/` queda 100 % con el dominio de `SITE_URL`, **0 `jbdd1`**.

> Nota: `jbdd1.github.io` aún aparece como **allowlist de `img-src` en la CSP** de
> `vercel.json` y `server.cjs`. **No se toca aquí** (es seguridad, no SEO, y
> cambiarlo mal rompe la carga de imágenes). Cuando migres de dominio, actualiza
> también esas dos entradas de CSP.

## Paso 1 — sitemap.xml (reconstruido)

XML bien formado (validado: 4 `<url>`, namespace `sitemaps.org/schemas/sitemap/0.9`,
UTF-8). `<lastmod>` reales según git (`git log -1 --date=short`). **URLs incluidas:**

| URL | lastmod | changefreq | priority |
|---|---|---|---|
| `https://TU-DOMINIO-REAL/landing.html` | 2026-11-11 | weekly | 1.0 |
| `https://TU-DOMINIO-REAL/faq.html` | 2026-11-11 | monthly | 0.7 |
| `https://TU-DOMINIO-REAL/privacidad.html` | 2026-11-11 | yearly | 0.5 |
| `https://TU-DOMINIO-REAL/terminos.html` | 2026-11-11 | yearly | 0.5 |

**Excluidas a propósito:** `index.html` (noindex), `privacy.html` y `terms.html`
(duplicados noindex con canonical), y cualquier ruta de `/api/`, `/data/`, `/src/`.

## Paso 2 — robots.txt (reescrito)

`Allow: /` + Allow explícito de las 4 públicas; `Disallow` de intención para
`/api/`, `/data/`, `/src/`, `/admin`, `.env`, `package.json`, `server.cjs`,
`vite.config.js`; línea `Sitemap:` con el dominio único. Sin reglas
contradictorias.

**index.html NO se bloquea con `Disallow` a propósito** (decisión técnica): un
`Disallow` impediría que Googlebot **rastreara** la página y, por tanto, que
**viera su `<meta name="robots" content="noindex">`**; la URL podría acabar
listada igualmente. La vía correcta para desindexar es el `noindex` (que exige
rastreo), no el `robots.txt`. Mismo criterio para `privacy.html`/`terms.html`.
Queda explicado en un comentario dentro de `robots.txt`.

## Paso 3 — meta robots por página (todas explícitas)

| Página | meta robots | Estado |
|---|---|---|
| index.html | `noindex, follow` | ya estaba |
| landing.html | `index, follow` | ya estaba |
| faq.html | `index, follow` | ya estaba |
| privacidad.html | `index, follow` | ya estaba |
| **privacy.html** | `noindex, follow` | **AÑADIDO** (no tenía) |
| terminos.html | `index, follow` | ya estaba |
| **terms.html** | `noindex, follow` | **AÑADIDO** (no tenía) |

Nota: `privacy.html`/`terms.html` llevan `noindex` **y** el canonical del prompt
anterior. Google puede considerarlo señal mixta (prioriza el `noindex`, que es lo
que queremos: sacarlas del índice). Se mantienen ambos por continuidad con el
prompt 1; si GSC marcara conflicto, se quitaría el canonical (ver Search Console).

## Paso 4 — Search Console

Guía completa en **`SEARCH_CONSOLE_SETUP.md`**: alta de propiedad, verificación
por **DNS TXT** (recomendado) o por **archivo HTML** (con el paso exacto de
añadirlo a `staticFiles` en `vite.config.js`, porque `publicDir:false` no lo
copia solo), envío del sitemap, y qué vigilar las 2 primeras semanas (cobertura,
errores, y la señal de «duplicada sin canónica» como aviso de que el canonical no
se respeta). Incluye el aviso de verificar la UI actual de GSC.

## Decisión sobre index.html

**NO es indexable.** Es la aplicación (una SPA), no una página de marketing. Se
mantiene `noindex, follow` por meta (la vía correcta), **no** se incluye en el
sitemap y **no** se bloquea por robots.txt (para que Google pueda leer el
`noindex`). La página indexable de entrada es `landing.html`. El `/` del sitio
sirve `index.html` vía el rewrite SPA de Vercel, pero su `noindex` evita que el
home se indexe; Google indexará `landing.html` directamente desde el sitemap.

## Verificación final (parte 2)

- `sitemap.xml`: XML bien formado (parseado) · `npm run build` → «dist/ es
  desplegable» · `dist/sitemap.xml` y `dist/robots.txt` copiados y con el dominio
  de `SITE_URL`.
- `grep jbdd1` en `sitemap.xml` y `robots.txt` (fuente y dist) → **0**.
- Suite de seguridad en verde.

## 🔴 RECORDATORIO EN MAYÚSCULAS

**EL DOMINIO ES UN PLACEHOLDER: `https://TU-DOMINIO-REAL`. DEBES SUSTITUIRLO POR
TU DOMINIO REAL EN `SITE_URL` (vite.config.js) ANTES DE DESPLEGAR Y ANTES DE
VERIFICAR EN SEARCH CONSOLE.** Mientras no lo hagas, sitemap, robots y los
canonical del build apuntarán a un dominio que no existe.

---

# Parte 3 — enlazado interno, Schema.org (JSON-LD) y Open Graph

**Fecha:** 11 de noviembre de 2026

## Paso 1 — Auditoría de enlaces internos

**Enlaces internos por página (todos a archivos que existen):**

| Página | Enlaza a |
|---|---|
| index.html (app, noindex) | faq.html · privacidad.html#s9 |
| landing.html | faq.html · privacidad.html · terminos.html · index.html (footer) |
| faq.html | landing.html (breadcrumb + footer) · privacidad.html · terminos.html · index.html#feedback |
| privacidad.html | landing.html · terminos.html · index.html |
| terminos.html | privacidad.html · landing.html · index.html |
| privacy.html (noindex) | privacidad.html (canonical) · index.html · (isla con terms.html) |
| terms.html (noindex) | terminos.html (canonical) · index.html · (isla con privacy.html) |

- **Enlaces rotos: 0.** Todos los destinos `.html` existen. Anclas verificadas:
  `privacidad.html#s2/#s7/#s9` existen; `index.html#feedback` **no es un `id`
  estático pero NO está roto** — lo resuelve el enrutado por hash de la app
  (`src/core/script.js:840-850` escucha `#feedback`/`#faq` desde faq.html y abre
  el modal). Es navegación funcional de la app, no señal SEO.
- **Páginas huérfanas:** `privacy.html` y `terms.html` no reciben enlaces desde
  ninguna página **indexable** — y es **intencionado**: son los duplicados
  `noindex` con canonical a las versiones completas, y la regla es no enlazarlos.
  Forman una isla entre sí. Las 5 páginas indexables (landing, faq, privacidad,
  terminos, index) son todas alcanzables entre sí. **Ninguna página indexable
  enlaza a un duplicado no canónico** (verificado: 0).

## Paso 2 — Mejoras de enlazado

- **Footers** de landing.html y faq.html: ya enlazaban a FAQ, privacidad
  (canónica) y términos (canónica) de forma visible. **No** enlazan a
  privacy/terms. Sin cambios necesarios.
- **FAQ → política de privacidad (enlaces contextuales nuevos, texto
  descriptivo):** en `src/data/faq.js` (fuente única, se refleja en faq.html y
  en la FAQ de la app):
  - Respuesta «¿Dónde se guardan mis datos?» → enlace a
    `privacidad.html#s2` («qué datos tratamos»).
  - Respuesta «¿Cómo borro mi cuenta?» → enlace a `privacidad.html#s7`
    («eliminación de cuenta y datos»).
- **Texto de enlace:** descriptivo en todos los casos (nunca «clic aquí»).

## Paso 3 — Breadcrumb

`faq.html` ya tenía un breadcrumb visible «Finova › Preguntas frecuentes».
**Mejora accesible:** `<div class="doc-breadcrumb">` → `<nav … aria-label="Ruta
de navegación">`, separador `aria-hidden`, y `aria-current="page"` en la actual.
Mismo aspecto visual. Las páginas legales no tienen secciones navegables tipo
breadcrumb (son documentos lineales), así que no se les añade.

## Paso 4 — Schema markup (JSON-LD) — todos validados como JSON

| Página | Schema | Datos | Validez |
|---|---|---|---|
| landing.html | **SoftwareApplication** (ya existía; se le añadió `image`) | name Finova, description real, FinanceApplication, offers price 0 EUR (es gratis, real), featureList real, logo icon-512. **Sin** aggregateRating/review | ✅ parseado |
| faq.html | **FAQPage** | 14 Question/Answer generados en runtime desde `FINOVA_FAQ` (misma fuente que pinta la FAQ) → el marcado coincide SIEMPRE con lo visible, texto exacto | ✅ parseado (14 preguntas) |
| faq.html | **BreadcrumbList** (estático) | 2 items: Finova → landing, Preguntas frecuentes → faq. Coincide con el breadcrumb visible | ✅ parseado |

- **Por qué el FAQPage se genera en JS:** la FAQ se renderiza desde
  `src/data/faq.js`; generar el schema desde esa misma fuente garantiza que
  texto visible y marcado no diverjan (lo contrario de incrustar una 2ª copia
  que se desincroniza). Validado reproduciendo la generación en Node.
- **Sin schema inventado:** no se añadió ningún `aggregateRating`, `review` ni
  campo con datos que no existan.

## Paso 5 — Open Graph y Twitter Card

| Página | Antes | Ahora |
|---|---|---|
| landing.html | completo | + `og:image:width/height` (512×512 reales) |
| faq.html | faltaban og:image y todo twitter | **set completo** (og:image 512×512, locale, site_name, twitter card/title/description/image); og:title alineado al nuevo title |
| privacidad.html | **ninguno** | **set completo** (og:type article, og:url = su canonical) |
| privacy.html | **ninguno** | **set completo** (og:url = canonical → privacidad.html) |
| terminos.html | **ninguno** | **set completo** |
| terms.html | **ninguno** | **set completo** (og:url = canonical → terminos.html) |

Imagen: `icon-512.png` (512×512, existe y resuelve). `og:url` coincide con el
canonical en cada página. Todas las URLs usan la base única (se reescriben a
`SITE_URL` en el build: 31 URLs reescritas, 0 `jbdd1` en `dist`).

## Verificación final (parte 3)

- Los 3 bloques JSON-LD (SoftwareApplication, FAQPage, BreadcrumbList) **parsean
  como JSON válido**. FAQPage: 14 preguntas, texto exacto de `faq.js`.
- `grep`: 0 enlaces relativos rotos; **0 enlaces a páginas legales no canónicas**
  desde páginas indexables; anclas `#s2/#s7/#s9` existen.
- `npm run build` → «dist/ es desplegable». **992 jest + 115 seguridad** en verde
  (se ajustó un enlace contextual para no superar el límite de 900 caracteres de
  respuesta que valida `feedback.test.js`).

## Hallazgo extra (bug que bloqueaba esta ronda): `src/data/faq.js` no estaba en git

Al intentar commitear los enlaces contextuales descubrí que **`src/data/faq.js`
nunca se había trackeado**: el `.gitignore` tenía `data/` sin anclar (pensado para
el `/data/` raíz de runtime de Railway), y ese patrón capturaba también
`src/data/`. Consecuencia real: **en un deploy desde git la FAQ se quedaría sin su
fuente de datos** (FINOVA_FAQ undefined → FAQ vacía y FAQPage sin generar).
**Corregido:** anclé los patrones (`data/` → `/data/`, etc.) para que solo
excluyan el directorio de runtime en la raíz, y añadí `src/data/faq.js` al repo.
Verificado: `src/data/faq.js` ya no se ignora y el `/data/` raíz sigue excluido.

## Enlaces rotos corregidos / huérfanas (resumen)

- **Enlaces rotos corregidos:** ninguno — no había enlaces internos rotos.
- **Huérfanas antes de esta ronda:** `privacy.html` y `terms.html` (sin enlaces
  entrantes desde indexables). **Se mantienen así a propósito** (duplicados
  noindex); no se enlazan desde páginas indexables por diseño.

---

# Parte 4 — Rendimiento (Core Web Vitals) y responsive móvil

**Fecha:** 11 de noviembre de 2026

## Cómo se midió (medición real, no opinión)

No hay Lighthouse CLI en este entorno, **pero sí Chrome + Playwright + la
librería oficial `web-vitals`**. Medí LCP/CLS/INP/FCP en un **navegador real**
renderizando `dist/` servido con `vite preview`, en **móvil emulado con el perfil
de Lighthouse** (CPU 4× más lenta + red Slow 4G: 1.6 Mbps, 150 ms RTT) y en
escritorio. Scripts reproducibles: `scripts/measure-vitals.cjs` y
`scripts/check-responsive.cjs` (requieren `playwright` + `web-vitals`). Resultados
crudos en `lighthouse-before/` y `lighthouse-after/`.

> ⚠️ **Esto NO es el "score" de Lighthouse** (no hay TBT/SI ni la puntuación
> 0-100), son las métricas Web Vitals reales. Son **pasadas únicas** (hay
> variación entre ejecuciones). **DEBES correr PageSpeed Insights / Lighthouse
> sobre la URL real de producción** para confirmar: producción añade CDN,
> compresión Brotli y latencias reales que aquí no se reproducen.

## Métricas antes / después — MÓVIL (throttled, que es donde dolía)

| Página | Métrica | Antes | Después | Objetivo |
|---|---|---|---|---|
| **landing** | **LCP** | **6440 ms** 🔴 | **1144 ms** ✅ | < 2500 ms |
| landing | CLS | 0.035 | 0.000 | < 0.1 |
| landing | FCP | 3376 ms | 492 ms | — |
| **faq** | LCP | 3136 ms 🟠 | 1880 ms ✅ | < 2500 ms |
| index (app) | LCP | 1880 ms ✅ | 1792 ms ✅ | < 2500 ms |
| index | INP | 128 ms ✅ | 104 ms ✅ | < 200 ms |
| index | CLS | 0.000 | 0.000 | < 0.1 |

Escritorio: todo ya estaba en verde (LCP 640–2100 ms, CLS ≤0.005) antes y después;
las variaciones son ruido de medición.

**Honestidad sobre la variación:** la mejora de **landing** (6440→1144 ms) es
**real y atribuible** (quitar el render-blocking de la fuente). La de **faq**
(3136→1880) es en parte **ruido**: no toqué `faq.html` esta ronda (sus fuentes ya
eran no bloqueantes). `index` ya estaba bien. INP de landing/faq salió «—» = no se
registró ninguna interacción lenta.

## LCP — qué se cambió

**Causa raíz en landing e index:** la hoja de estilos de **Playfair Display se
cargaba como render-blocking** (`<link rel="stylesheet">`), mientras que Inter ya
iba con `preload`+`onload` (no bloqueante). En Slow 4G eso retrasaba el primer
render ~3 s. **Corrección:** combinar Inter + Playfair en **una sola petición no
bloqueante** (`preload as=style` + `onload`), con el `<noscript>` de respaldo. El
texto pinta en la fuente de reserva al instante (`display=swap`) y el LCP cae de
6,4 s a 1,1 s. `faq.html` ya lo hacía bien.

**Decisión de fuentes (documentada):** se **mantiene Google Fonts** con
`preconnect` + carga **no bloqueante**, en vez de auto-alojar. Motivo: auto-alojar
Playfair+Inter con todos sus pesos e itálicas correctamente (subsetting, woff2)
no puedo verificarlo con seguridad en este entorno, y la carga no bloqueante ya
elimina el cuello de botella de render. **Recomendación futura:** auto-alojar las
fuentes (woff2 locales + `@font-face` con `font-display:swap` y `size-adjust`)
quita además los round-trips a `fonts.googleapis.com`/`gstatic.com` — mejora
adicional en móvil.

## INP y CLS — medidos buenos, sin cambios forzados

- **INP:** mejor caso medido 104–128 ms (umbral 200). Escaneé los manejadores de
  las páginas públicas (búsqueda FAQ, botones del header): son ligeros, sin
  bucles ni DOM masivo síncrono. La app usa delegación `data-action` en vez de
  miles de listeners. **No había problema medible**, así que no se trocea trabajo
  sin necesidad (evitar cambios de riesgo sin beneficio).
- **CLS:** ≤0.035 antes, 0.000–0.005 después (umbral 0.1). Las imágenes de
  `index.html` ya llevan `width`/`height` (ronda SEO previa); los banners de la
  app van `display:none` hasta tener contenido; las fuentes usan `display=swap`.
  No hay anuncios ni iframes (confirmado).

## Responsive móvil — problemas REALES encontrados y corregidos

Medido con Playwright a **320 / 375 / 430 px**.

| Problema (medido) | Página | Corrección |
|---|---|---|
| **Scroll horizontal** (+150 px a 320) | landing | `html { overflow-x: hidden }` (faltaba; solo estaba en `body`, que no clipa el header `position:fixed`). Resultado: `maxScrollX = 0` (el usuario ya no puede desplazar en horizontal). |
| **Grid que desborda**: `.lp-shots` con `minmax(320px,1fr)` fuerza 320 px por columna | landing | `minmax(min(100%,320px),1fr)` — la columna puede encoger bajo 320 px. |
| **Destino táctil**: hamburguesa 32×32 px | landing | `min-width/height: 44px` (WCAG 2.5.5). Verificado 44×44 y el menú **abre** (smoke test). |
| Tablas | landing | La comparativa `.lp-cmp` ya está en `.lp-cmp-wrap { overflow-x:auto }` y se contiene (288 px a 320) — correcto, sin cambios. |
| Viewport meta | las 3 | Presente y correcto (`width=device-width, initial-scale=1`) en landing/index/faq. |

**Pendiente menor (documentado, no bloqueante):**
- En la emulación, `window.innerWidth` queda en ~352 a 320 px (layout viewport
  ligeramente expandido), lo que recorta ~16 px del borde del header. **No produce
  scroll** (`maxScrollX=0`) y en un móvil real con `overflow-x:hidden` + viewport
  meta el layout viewport se fija a device-width. **Conviene confirmarlo en un
  dispositivo real.**
- `index.html` (la app, noindex) tiene botones de UI densa < 44 px de alto (filas
  de 33 px, toggle del sidebar). **No se fuerzan a 44 px**: es un cambio de diseño
  grande y arriesgado en una app de productividad, con valor SEO nulo (noindex).
  Queda anotado por si se quiere abordar como mejora de accesibilidad aparte.
- `faq.html`: enlaces de texto del footer y «← Volver a inicio» < 44 px de alto
  (patrón común de enlaces de texto). Bajo impacto.

## Verificación

- `npm run build` → «dist/ es desplegable», **sin avisos de tamaño de bundle**.
- Smoke test (Playwright): landing (hero + menú hamburguesa abre), index (login
  presente), faq (14 preguntas renderizadas), **0 errores de JS**. Los cambios son
  CSS/`<head>`; no se tocó ningún JS ni el servidor.

## 🔴 RECORDATORIO

**CONFIRMA LAS CIFRAS CON PAGESPEED INSIGHTS / LIGHTHOUSE SOBRE LA URL REAL DE
PRODUCCIÓN.** Lo de aquí es medición local en un navegador real (no el score de
Lighthouse) y en pasadas únicas; producción (CDN, Brotli, latencia real, y el
dominio definitivo aún por fijar) dará números distintos. La mejora de LCP de
landing (−82 %) debería sostenerse, pero el número exacto hay que verlo en prod.
