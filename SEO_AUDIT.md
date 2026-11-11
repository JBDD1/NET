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
