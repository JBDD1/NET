# Finova — Design Tokens

Documento de referencia del Design System de Finova. Fuente única de verdad para colores, tipografía, espaciado, radios, sombras e iconografía.

Metodología: `ui-ux-pro-max-skill` (ver `.claude/skills/ui-ux-pro-max/`). No se ha partido de cero — Finova **ya tenía** una arquitectura de tokens sofisticada (5 variantes de tema, cada una con claro/oscuro) en `style.css:1-617`. Este documento la **audita, verifica y formaliza**, no la reemplaza. Los valores de contraste están **calculados con la fórmula WCAG 2.1** (no estimados a ojo) — script de verificación incluido al final.

**Estado: propuesta para revisión. Ningún token de este documento se ha aplicado todavía a las páginas — `style.css` sigue exactamente igual que antes de este documento.**

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
- **Neutral** → **no existe todavía como token dedicado.** Hoy `.badge-pending` reutiliza `--accent-soft`/`--accent` (ver `style.css:2861`), lo que mezcla "estado neutral/pendiente" con "color de marca". Funciona porque el dorado/latón se lee como "atención, en curso" — pero es una decisión implícita, no un token con nombre.
  **Propuesta:** añadir `--neutral` y `--neutral-soft`, derivados de la rampa de gris de cada variante (`text-secondary`/`border-strong`), para estados verdaderamente neutrales (borrador, sin categorizar, informativo) sin tocar el significado de `--accent`. `--accent` se queda reservado para "pendiente/en curso" tal y como está, que es una lectura correcta para una fintech.
  Regla `color-not-only` de la skill: en toda la app, positivo/negativo/neutral **nunca dependen solo del color** — ya se combinan con signo (+/−), flecha (`icon-arrow-up-right`/`down-right`) o texto ("Pagado"/"Pendiente"). Mantener esa disciplina al propagar.

### 1.3 Paleta recomendada por defecto: **Obsidian & Brass**

De las 5 variantes existentes, recomiendo mantener **`obsidian-brass`** (ya es la variante por defecto en el código, `style.css:108`) como identidad principal de Finova. Motivo, con datos:
- Es la única que en `data/colors.csv` de la skill corresponde literalmente a "Banking/Traditional Finance" (`Trust navy + premium gold`) y "Financial Dashboard" (`Dark bg + green/red alerts + trust blue`) — el perfil que el propio catálogo de la skill asocia a producto financiero serio, no a SaaS genérico.
- Cumple el brief: base oscura casi negra + acento latón/oro, cero gradientes decorativos, cero colores chillones.
- Mejor contraste medido de las 5 (ver tabla abajo): `text-primary` sobre `bg-surface` da **18.49:1** en claro y **14.26:1** en oscuro — muy por encima de AAA.

Las otras 4 variantes (`linen-editorial`, `midnight-emerald`, `soft-mono`, `terracotta-warmth`) se mantienen como personalización opcional del usuario (selector ya existente en el dropdown de perfil) — es una función real de la app y no se elimina, solo se documenta su rol secundario.

### 1.4 Verificación de contraste (WCAG 2.1, calculado)

Pares medidos: `text-primary`/`text-secondary`/`text-muted` sobre `bg-surface`; texto de botón (`accent-ink`) sobre `accent`; `up`/`down` sobre `bg-surface`; `sidebar-text` sobre `sidebar-bg`.

| Variante | primary/surface | secondary/surface | **muted/surface** | accent-ink/accent | up/surface | down/surface | sidebar |
|---|---|---|---|---|---|---|---|
| obsidian-brass · light | 18.49 AAA | 6.08 AA | **2.66 FAIL** | 3.55 AA-large | 4.89 AA | 6.76 AA | 14.59 AAA |
| obsidian-brass · dark | 14.26 AAA | 5.40 AA | **2.39 FAIL** | 8.63 AAA | 7.78 AAA | 5.83 AA | 15.91 AAA |
| linen-editorial · light | 15.64 AAA | 6.33 AA | **2.70 FAIL** | 8.43 AAA | 5.59 AA | 7.89 AAA | 14.04 AAA |
| linen-editorial · dark | 13.78 AAA | 5.20 AA | **2.25 FAIL** | 4.35 AA-large | 6.86 AA | 4.01 AA-large | 15.84 AAA |
| midnight-emerald · light | 14.52 AAA | 5.64 AA | **2.63 FAIL** | 5.91 AA | 5.48 AA | 5.91 AA | 12.56 AAA |
| midnight-emerald · dark | 12.53 AAA | 5.26 AA | **2.75 FAIL** | 9.84 AAA | 7.15 AAA | 5.42 AA | 14.58 AAA |
| soft-mono · light | 19.80 AAA | 6.91 AA | **2.50 FAIL** | 3.18 AA-large | 5.32 AA | 5.25 AA | 17.81 AAA |
| soft-mono · dark | 16.85 AAA | 5.41 AA | **2.39 FAIL** | 7.10 AAA | 8.95 AAA | 6.33 AA | 18.89 AAA |
| terracotta-warmth · light | 15.41 AAA | 6.12 AA | **2.61 FAIL** | 4.19 AA-large | 4.44 AA-large | 5.90 AA | 14.22 AAA |
| terracotta-warmth · dark | 13.96 AAA | 4.06 AA-large | **2.10 FAIL** | 6.18 AA | 7.71 AAA | 5.78 AA | 16.00 AAA |

**Hallazgo 1 — `--text-muted` no pasa WCAG AA en ninguna de las 10 combinaciones** (rango 2.10:1–2.75:1; el mínimo AA para texto normal es 4.5:1, y hasta el umbral más permisivo de "no-texto"/UI es 3:1). `--text-muted` se usa hoy para metadatos, timestamps, ayudas de formulario — texto real, no decoración — a menudo en 11–12px. Es un defecto **preexistente**, no introducido por este rediseño.
**Propuesta:** oscurecer `--text-muted` en claro / aclarar en oscuro hasta cruzar 4.5:1 en las 10 variantes (ajuste de luminosidad, no de matiz — mismo tono, más contraste). Puedo traer valores concretos calculados variante por variante si confirmas esta dirección.

**Hallazgo 2 — `accent-ink` sobre `accent` falla AA de texto normal en 5 de las 10 combinaciones** (marcadas "AA-large": 3.18–4.35:1, por debajo de 4.5:1). Es el texto de `.btn-primary` (`style.css:1619`), tipografía 13px/600 — no cumple el umbral de "texto grande" de WCAG (18px normal o ~18.7px negrita), así que necesita 4.5:1 completo.
**Propuesta:** mismo tratamiento — ajustar `accent-ink` o `accent` en las 5 variantes afectadas (`obsidian-brass·light`, `linen-editorial·dark`, `midnight-emerald·light`, `soft-mono·light`, `terracotta-warmth·light`) hasta 4.5:1.

Ambos hallazgos son ajustes **de valor de token**, no de layout — bajo impacto visual (misma familia de color, ligero cambio de luminosidad), alto impacto de accesibilidad. Recomiendo aplicarlos junto con el resto de tokens en el siguiente paso, no ahora.

---

## 2. Tipografía

### 2.1 Familias

- `--font-serif`: **Playfair Display** — reservada a momentos editoriales/display: cifras grandes (`.kpi-hero`, `.highlight-value`), títulos de modal (`.modal-title`). Aporta el carácter "banca privada" que pide el brief.
- `--font-sans`: **Inter** — todo lo demás (UI, tablas, formularios, navegación). Buena legibilidad en tamaños pequeños, ideal para dashboard denso.

Es una pareja deliberada (display serif + UI sans), no un accidente — coincide con el patrón `Minimal Swiss`/`Premium Sans` que la skill recomienda para dashboards financieros. Se mantiene.

### 2.2 Escala (existente, `style.css:96-102`)

| Token | Tamaño | Uso actual |
|---|---|---|
| `--fs-xs` | 11px | meta, captions, badges, ALL-CAPS labels |
| `--fs-sm` | 13px | body, texto UI, filas de tabla, botones |
| `--fs-md` | 15px | nombres de tarjeta, subtítulos |
| `--fs-lg` | 18px | valores de display, importes pequeños |
| `--fs-xl` | 24px | KPI secundario, títulos de modal |
| `--fs-2xl` | 30px | h1 de sección, KPI principal |
| `--fs-3xl` | 40px | KPI hero (patrimonio neto) |

**Punto a decidir — no lo cambio unilateralmente:** la regla `readable-font-size` de la skill pide mínimo 16px para texto de cuerpo en móvil (evita el auto-zoom de iOS en inputs y mejora legibilidad). Aquí `--fs-sm` (13px) es el tamaño de body/UI. Esto es **intencional**, no descuido — es el patrón "dashboard denso" (Bloomberg Terminal, Mercury, Ramp) que prioriza densidad de información sobre tamaño de texto, algo razonable en una app financiera con muchas cifras en pantalla. Pero es una tensión real con la guía de accesibilidad para móvil.
**Opciones:**
1. Mantener 13px en desktop (dashboard denso) pero subir a 16px los `<input>`/`<select>` específicamente en viewport móvil (evita el auto-zoom sin tocar la densidad de las tablas).
2. Subir `--fs-sm` a 14px como punto intermedio en toda la app.
3. Dejarlo como está y asumir la tensión conscientemente.
Te lo dejo para decidir junto con la paleta — no es una corrección de bug, es una decisión de producto.

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

## 7. Breakpoints (propuesta — hoy inconsistente)

Auditoría inicial: 13 valores distintos de `max-width` en `style.css` (380/420/480/500/560/600/640/680/700/1000/1024/1200), sin escala formal. Propuesta para el paso de aplicación:

| Token | Valor | Uso |
|---|---|---|
| `--bp-sm` | 480px | móvil pequeño |
| `--bp-md` | 768px | tablet |
| `--bp-lg` | 1024px | laptop / sidebar completo |
| `--bp-xl` | 1280px | desktop grande |

No se aplica todavía — requiere revisar cada uno de los 13 valores actuales para decidir a cuál de los 4 colapsa, componente por componente, en el paso siguiente.

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
