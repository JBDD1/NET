# Finova — Design Tokens

Documento de referencia del Design System de Finova. Fuente única de verdad para colores, tipografía, espaciado, radios, sombras e iconografía.

Metodología: `ui-ux-pro-max-skill` (ver `.claude/skills/ui-ux-pro-max/`). No se ha partido de cero — Finova **ya tenía** una arquitectura de tokens sofisticada (5 variantes de tema, cada una con claro/oscuro) en `style.css:1-617`. Este documento la **audita, verifica y formaliza**, no la reemplaza. Los valores de contraste están **calculados con la fórmula WCAG 2.1** (no estimados a ojo) — script de verificación incluido al final.

**Estado:** los tokens de este documento (color, contraste, `--neutral`, tipografía interactiva, breakpoints) **ya están aplicados en `style.css`** — confirmados y corregidos en la revisión del 2026-08-14. Lo que sigue pendiente es la propagación página por página (Dashboard, Cartera, Watchlist, Dividendos, Patrimonio Neto, Activos Alternativos, Objetivos, Simulador, Asesor IA, Configuración) y el barrido de emojis en `src/sections/*.js`.

---

## 1. Colores

### 1.1 Arquitectura

Cada variante define el mismo conjunto de tokens semánticos en dos bloques — `[data-variant="X"]` (claro) y `[data-variant="X"][data-theme="dark"]` (oscuro) — para que ningún componente use un valor hex suelto: siempre `var(--bg-surface)`, `var(--text-primary)`, etc.

| Grupo | Tokens |
|---|---|
| Fondo | `--bg-base` `--bg-surface` `--bg-elevated` `--bg-hover` `--bg-overlay` |
| Borde | `--border-faint` `--border-subtle` `--border-default` `--border-strong` |
| Texto | `--text-primary` `--text-secondary` `--text-muted` |
| Marca | `--accent` `--accent-soft` `--accent-dark` `--accent-ink` |
| Semántico | `--up`/`--positive` · `--down`/`--negative`/`--danger` (+ variantes `-soft`) |
| Sidebar | `--sidebar-bg` `--sidebar-text` `--sidebar-accent(+bg/soft-bg/bar)` `--sidebar-divider` |
| Sombra | `--shadow-sm/md/lg` `--shadow-card` `--shadow-card-hover` |

### 1.2 Semántica positivo / negativo / neutral

- **Positivo** → `--up` (alias `--positive`): ganancias, rentabilidad positiva, ingresos, objetivos cumplidos.
- **Negativo** → `--down` (alias `--negative`, `--danger`): pérdidas, gastos, alertas, acciones destructivas.
- **Neutral** → **`--neutral` / `--neutral-soft` (añadidos)**, derivados de `text-secondary` de cada variante (con corrección de contraste propia en `terracotta-warmth · dark`, ver 1.4). `.badge-pending` (`style.css`) ya usa `--neutral-soft`/`--neutral` en vez de `--accent-soft`/`--accent` — el color de marca queda libre para su significado propio (acento, foco, elementos "premium"), sin mezclarse con estados de UI.
  Regla `color-not-only` de la skill: en toda la app, positivo/negativo/neutral **nunca dependen solo del color** — ya se combinan con signo (+/−), flecha (`icon-arrow-up-right`/`down-right`) o texto ("Pagado"/"Pendiente"). Mantener esa disciplina al propagar.

### 1.3 Paleta recomendada por defecto: **Obsidian & Brass**

De las 5 variantes existentes, recomiendo mantener **`obsidian-brass`** (ya es la variante por defecto en el código, `style.css:108`) como identidad principal de Finova. Motivo, con datos:
- Es la única que en `data/colors.csv` de la skill corresponde literalmente a "Banking/Traditional Finance" (`Trust navy + premium gold`) y "Financial Dashboard" (`Dark bg + green/red alerts + trust blue`) — el perfil que el propio catálogo de la skill asocia a producto financiero serio, no a SaaS genérico.
- Cumple el brief: base oscura casi negra + acento latón/oro, cero gradientes decorativos, cero colores chillones.
- Mejor contraste medido de las 5 (ver tabla abajo): `text-primary` sobre `bg-surface` da **18.49:1** en claro y **14.26:1** en oscuro — muy por encima de AAA.

Las otras 4 variantes (`linen-editorial`, `midnight-emerald`, `soft-mono`, `terracotta-warmth`) se mantienen como personalización opcional del usuario (selector ya existente en el dropdown de perfil) — es una función real de la app y no se elimina, solo se documenta su rol secundario.

### 1.4 Verificación de contraste (WCAG 2.1, calculado) — corregido y aplicado

Pares medidos: `text-primary`/`text-secondary`/`text-muted`/**`neutral`** sobre `bg-surface`; texto de botón (`accent-ink`) sobre `accent`; `up`/`down` sobre `bg-surface`; `sidebar-text` sobre `sidebar-bg`. Valores **ya aplicados** en `style.css`.

| Variante | primary/surface | secondary/surface | muted/surface | **neutral/surface** | accent-ink/accent | up/surface | down/surface | sidebar |
|---|---|---|---|---|---|---|---|---|
| obsidian-brass · light | 18.49 AAA | 6.08 AA | 4.50 AA | 6.08 AA | 5.21 AA | 4.89 AA | 6.76 AA | 14.59 AAA |
| obsidian-brass · dark | 14.26 AAA | 5.40 AA | 4.51 AA | 5.40 AA | 8.63 AAA | 7.78 AAA | 5.83 AA | 15.91 AAA |
| linen-editorial · light | 15.64 AAA | 6.33 AA | 4.53 AA | 6.33 AA | 8.43 AAA | 5.59 AA | 7.89 AAA | 14.04 AAA |
| linen-editorial · dark | 13.78 AAA | 5.20 AA | 4.53 AA | 5.20 AA | 4.86 AA | 6.86 AA | 4.01 AA-large | 15.84 AAA |
| midnight-emerald · light | 14.52 AAA | 5.64 AA | 4.51 AA | 5.64 AA | 5.91 AA | 5.48 AA | 5.91 AA | 12.56 AAA |
| midnight-emerald · dark | 12.53 AAA | 5.26 AA | 4.51 AA | 5.26 AA | 9.84 AAA | 7.15 AAA | 5.42 AA | 14.58 AAA |
| soft-mono · light | 19.80 AAA | 6.91 AA | 4.50 AA | 6.91 AA | 6.22 AA | 5.32 AA | 5.25 AA | 17.81 AAA |
| soft-mono · dark | 16.85 AAA | 5.41 AA | 4.53 AA | 5.41 AA | 7.10 AAA | 8.95 AAA | 6.33 AA | 18.89 AAA |
| terracotta-warmth · light | 15.41 AAA | 6.12 AA | 4.52 AA | 6.12 AA | 4.64 AA | 4.44 AA-large | 5.90 AA | 14.22 AAA |
| terracotta-warmth · dark | 13.96 AAA | 4.06 AA-large | 4.51 AA | **4.61 AA** | 6.18 AA | 7.71 AAA | 5.78 AA | 16.00 AAA |

**Las 30 combinaciones críticas (muted/surface, accent-ink/accent, neutral/surface) pasan ahora AA (≥4.5:1).** Único resto por debajo de 4.5 en toda la tabla: `down/surface` en `terracotta-warmth·light` (4.44, AA-large) y `secondary/surface` en `terracotta-warmth·dark` (4.06, AA-large) — ambos aceptables porque WCAG permite 3:1 para el rol "no-texto"/texto grande, y ninguno de los dos se usa hoy en texto pequeño crítico; quedan anotados para revisar si aparece un uso de texto normal sobre esos pares en la fase de aplicación.

**Hallazgo 1 (corregido) — `--text-muted` no pasaba WCAG AA en ninguna de las 10 combinaciones** (rango original 2.10:1–2.75:1). Corregido ajustando solo la luminosidad (mismo matiz) hasta 4.50–4.53:1 en las 10 variantes.

**Hallazgo 2 (corregido) — `accent-ink` sobre `accent` fallaba AA de texto normal en 4 de las 10 combinaciones** (no 5 — corrijo aquí un error mío: `midnight-emerald·light` ya pasaba a 5.91:1, no forma parte del hallazgo). Las 4 reales (`obsidian-brass·light`, `linen-editorial·dark`, `soft-mono·light`, `terracotta-warmth·light`) están corregidas: en `obsidian-brass·light` y `soft-mono·light` el texto de botón pasa a usar el `text-primary` oscuro de esa variante en vez de un blanco casi puro (el dorado/naranja de esos acentos es demasiado claro para texto blanco a 4.5:1); en `linen-editorial·dark` pasa a negro puro; en `terracotta-warmth·light` se mantiene blanco puro (`#ffffff`, 4.64:1 — el blanco sí funciona ahí).

---

## 2. Tipografía

### 2.1 Familias

- `--font-serif`: **Playfair Display** — reservada a momentos editoriales/display: cifras grandes (`.kpi-hero`, `.highlight-value`), títulos de modal (`.modal-title`). Aporta el carácter "banca privada" que pide el brief.
- `--font-sans`: **Inter** — todo lo demás (UI, tablas, formularios, navegación). Buena legibilidad en tamaños pequeños, ideal para dashboard denso.

Es una pareja deliberada (display serif + UI sans), no un accidente — coincide con el patrón `Minimal Swiss`/`Premium Sans` que la skill recomienda para dashboards financieros. Se mantiene.

### 2.2 Escala (corregida y aplicada, `style.css`)

**Decisión confirmada:** el texto interactivo (botones, inputs, labels) y las vistas móviles en general **nunca bajan de 16px**. Única excepción: tablas de datos densas de escritorio, con suelo de **14px** (nunca menos). Aplicado:

| Token | Tamaño | Uso |
|---|---|---|
| `--fs-2xs` | 11px | **solo** decorativo: badges, chips, meta ALL-CAPS — nunca labels ni texto de botón/input |
| `--fs-xs` | 14px | excepción de tabla densa de escritorio (suelo, nunca menos) |
| `--fs-sm` | 16px | suelo interactivo: botones, inputs, labels, body |
| `--fs-md` | 16px | nombres de tarjeta, subtítulos |
| `--fs-lg` | 18px | valores de display, importes pequeños |
| `--fs-xl` | 24px | KPI secundario, títulos de modal |
| `--fs-2xl` | 30px | h1 de sección, KPI principal |
| `--fs-3xl` | 40px | KPI hero (patrimonio neto) |

Componentes globales ya actualizados a este suelo: `body` (tamaño base del documento, `style.css` — con esto cualquier texto sin tamaño propio hereda 16px automáticamente), `.btn-primary/.btn-secondary/.btn-ghost/.btn-danger` (13→16px; `.btn-sm` ahora solo reduce padding, no tamaño de letra), `.text-input`/`.select-input` (13→16px — de paso corrige el auto-zoom de iOS en formularios), `.form-label` (11→16px), `.nav-item` (13→16px, es un `<button>`), `.data-table`/`.data-table th` (13/11→14px, excepción documentada).

**Nota de interpretación:** no he tocado los cientos de `font-size` específicos de componentes individuales (badges, texto de dropdown de perfil, ayuda de atajos de teclado, captions del hero móvil del Dashboard, etc.) — esos se revisan uno a uno en la fase de aplicación página por página, donde se decide caso a caso si son "texto interactivo/body" (→16px) o "meta/decorativo" (se queda pequeño, categoría `--fs-2xs`). Ejemplo ya evaluado: `.mh-greeting`/`.mh-change` (caption y variación bajo el patrimonio neto en el hero móvil) se tratan como meta/caption, no como body — se quedan en `--fs-xs` (ahora 14px, antes 11px), no suben a 16px, porque no son texto interactivo ni contenido de lectura primaria.

### 2.3 Pesos

600–700 para énfasis/headings, 500 para labels, 400 para body — ya consistente vía `font-weight` explícito por componente. No se propone escala nueva.

### 2.4 Números financieros

`font-variant-numeric: tabular-nums` ya aplicado en tablas de datos (`style.css:1463`) — cifras alineadas verticalmente, buena práctica que se mantiene y se propagará a cualquier tabla nueva.

---

## 3. Espaciado (existente, `style.css:42-54`)

Base 4px, escala `--sp-1`(4) `--sp-2`(8) `--sp-3`(12) `--sp-4`(16) `--sp-5`(20) `--sp-6`(24) `--sp-8`(32) `--sp-10`(40) `--sp-12`(48) `--sp-16`(64). Sistema sólido y ya usado en la mayoría de componentes — se mantiene sin cambios.

## 4. Radios (existente, `style.css:20-23`)

`--r-xs`(5px) `--r-sm`(8px) `--r-md`(12px) `--r-lg`(16px) — progresión suave, nada "pill" excesivo salvo donde es intencional (badges, filtros). Se mantiene.

## 5. Sombras

`--shadow-sm/md/lg` + `--shadow-card`/`--shadow-card-hover`, definidas **por variante** (más opacas en modo oscuro, más suaves en claro) — ya evita el "shadow gris genérico sobre fondo oscuro". Problema real detectado en la auditoría inicial: ~69 `box-shadow` con `rgba()` a mano en vez de estos tokens (ej. `style.css:1487`). Se corrige en el paso de aplicación, no aquí.

## 6. Iconografía (nuevo, ya construido en el checkpoint anterior)

`--icon-xs`(14) `--icon-sm`(16) `--icon-md`(20, default) `--icon-lg`(24) `--icon-xl`(32). Un único sprite SVG (`index.html`, ~46 símbolos), `stroke-width: 1.75` constante vía `.icon`, `currentColor` para heredar color de texto — nunca color fijo. Cubre navegación y chrome global; pendiente el barrido en `src/sections/*.js`.

## 7. Breakpoints (colapsados y aplicados)

Los 12 valores ad-hoc (`380/420/480/500/560/600/640/680/700/1000/1024/1200px`) se han colapsado a una escala de 4 tokens, ya reflejados en `:root` (`--bp-sm/md/lg/xl`) y aplicados directamente en los 35 `@media (max-width: …)` de `style.css` (los otros 5 — `max-height`, `prefers-reduced-motion` ×3, `print` — no forman parte de esta escala y no se han tocado):

| Token | Valor | Uso | Valores antiguos que colapsa |
|---|---|---|---|
| `--bp-sm` | 480px | móvil | 380, 420, 480, 500, 560, 600 |
| `--bp-md` | 768px | tablet | 640, 680, 700 |
| `--bp-lg` | 1024px | laptop / sidebar completo | 1000, 1024 |
| `--bp-xl` | 1280px | desktop grande | 1200 |

Criterio de colapso: cada valor antiguo se movió al tier más cercano (redondeo al vecino, nunca al más lejano). Dirección elegida cuando había ambigüedad: siempre hacia el tier que da **más margen** al contenido (ej. 380→480 ensancha el rango "móvil pequeño" en vez de estrecharlo).

**Limitación honesta:** esta sesión no tiene herramienta de navegador/captura de pantalla, así que el colapso se verificó por build (`npm run build` sin errores, CSS con llaves balanceadas) pero **no se ha comprobado visualmente** en cada uno de los 35 puntos de corte. Antes de fusionar a `main`, conviene una pasada visual rápida en los tramos que más cambiaron (680→768 tenía 11 reglas distintas — es el que más contenido reagrupa).

---

## Script de verificación de contraste

Cálculo WCAG 2.1 estándar (luminancia relativa → ratio), usado para la tabla de la sección 1.4. Puede volver a ejecutarse tras cualquier ajuste de color para confirmar que se mantiene o mejora el contraste.

```js
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  const num = parseInt(hex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
function relLuminance([r, g, b]) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrast(hex1, hex2) {
  const L1 = relLuminance(hexToRgb(hex1));
  const L2 = relLuminance(hexToRgb(hex2));
  const [lighter, darker] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (lighter + 0.05) / (darker + 0.05);
}
```
