# Verificación y envío en Google Search Console — Finova

Guía para que **tú** des de alta Finova en Google Search Console (GSC), verifiques
la propiedad, envíes el sitemap y vigiles la indexación. Yo no puedo ejecutar
estos pasos: requieren acceso a tu cuenta de Google y al DNS del dominio.

> ⚠️ **ANTES DE EMPEZAR — PLACEHOLDER DE DOMINIO.** Todo el proyecto usa el
> placeholder **`https://TU-DOMINIO-REAL`** porque aún no hay dominio real
> configurado. **Sustitúyelo por tu dominio** (una sola línea: `SITE_URL` en
> `vite.config.js`), reconstruye y despliega **antes** de verificar nada aquí. Si
> verificas con el placeholder, nada de esto funcionará.

> ⚠️ **LA INTERFAZ DE GSC CAMBIA.** Los nombres de menús, botones y el orden de
> los pasos de Google se modifican con frecuencia. **Verifica cada paso en la
> consola real** (https://search.google.com/search-console) antes de seguir esta
> guía al pie de la letra. Lo de abajo es correcto a fecha de escribirlo, pero
> puede haber cambiado cuando lo leas.

---

## 1. Añadir la propiedad

En https://search.google.com/search-console → **Añadir propiedad**. Google ofrece
dos tipos:

| Tipo | Qué cubre | Verificación |
|---|---|---|
| **Dominio** (recomendado) | Todo el dominio: `http`+`https`, con y sin `www`, y **todos los subdominios** | **Solo DNS (registro TXT)** |
| Prefijo de URL | Solo ese origen exacto (p. ej. `https://tudominio.com/`) | DNS, **archivo HTML**, etiqueta meta, Google Analytics o Tag Manager |

**Recomendación para Finova:** usa la propiedad **Dominio** con registro TXT en
el DNS (método 2A). Es la más robusta y no depende de un fichero que haya que
mantener en el repositorio. Si no tienes acceso al DNS, usa el archivo HTML
(método 2B) con una propiedad de tipo «Prefijo de URL».

---

## 2A. Verificación por DNS (registro TXT) — RECOMENDADO

1. Al crear la propiedad **Dominio**, GSC te da un valor tipo
   `google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXX`.
2. Entra en el panel DNS de tu **registrador/proveedor del dominio** (donde
   compraste el dominio, o Cloudflare/Vercel DNS si delegaste ahí los nameservers).
3. Crea un registro **TXT**:
   - **Host / Nombre:** `@` (la raíz del dominio) — algunos paneles lo dejan vacío.
   - **Tipo:** `TXT`
   - **Valor:** el string completo `google-site-verification=XXXX...` (tal cual,
     entre comillas si el panel lo exige).
   - **TTL:** el que venga por defecto (p. ej. 3600).
4. Guarda y **espera la propagación** (de minutos a varias horas; normalmente < 1 h).
5. Vuelve a GSC y pulsa **Verificar**. Si falla por propagación, espera y reintenta.

> El TXT de verificación **no sustituye** a tus registros DNS existentes (A/CNAME
> que apuntan a Vercel). Es un registro TXT adicional; no toca el resto.

---

## 2B. Verificación por archivo HTML — ALTERNATIVA

Para una propiedad de tipo **Prefijo de URL**. **Importante para este proyecto:**
Vite tiene `publicDir: false` (en `vite.config.js`), así que **NO copia ficheros
sueltos a `dist/` automáticamente**. Si solo dejas el archivo en la raíz, **no
llegará a `dist/` y la URL de verificación dará 404.** Hay que registrarlo:

1. Descarga de GSC el archivo, con nombre tipo `google1a2b3c4d5e6f7g8h.html`.
2. Colócalo en la **raíz del proyecto** (junto a `index.html`, `sitemap.xml`…).
3. Edita **`vite.config.js`** → función **`copyStaticAssets`** → array
   **`staticFiles`** (está junto a `'robots.txt', 'sitemap.xml'`). Añade el nombre
   exacto del fichero:

   ```js
   const staticFiles = [
     'manifest.json', 'sw.js', 'robots.txt', 'sitemap.xml',
     'privacidad.html', 'privacy.html', 'terminos.html', 'terms.html', 'faq.html',
     'google1a2b3c4d5e6f7g8h.html',   // ← verificación Search Console (copiado sin procesar)
   ];
   ```

   Se copia **verbatim** (sin minificar ni tocar), que es justo lo que Google exige.
4. `npm run build` y **despliega**. Comprueba en el navegador que
   `https://TU-DOMINIO-REAL/google1a2b3c4d5e6f7g8h.html` **se abre y muestra el
   contenido de Google** (no un 404 ni el HTML de la app).
5. En GSC, pulsa **Verificar**.

> Si más adelante quieres quitarlo, basta con borrar la línea del array y el
> fichero. No lo necesitas una vez verificada la propiedad, pero Google
> recomienda **dejarlo** para no perder la verificación.

---

## 3. Enviar el sitemap

Una vez **verificada** la propiedad:

1. GSC → menú lateral **Sitemaps** (o «Sitemaps e indexación»).
2. En «Añadir un sitemap», escribe: **`sitemap.xml`** (GSC le antepone tu dominio;
   si pide la URL completa, usa `https://TU-DOMINIO-REAL/sitemap.xml` ya con el
   dominio real).
3. **Enviar.** Debe quedar en estado **«Correcto»** («Success») con **4 URLs
   descubiertas** (landing, faq, privacidad, terminos). Si sale «No se ha podido
   obtener», revisa que el sitemap es accesible en esa URL y que no quedó el
   placeholder.

> El sitemap NO incluye `index.html` (es `noindex`) ni `privacy.html`/`terms.html`
> (duplicados `noindex` con canonical a las versiones completas). Es intencionado.

---

## 4. Qué revisar las primeras dos semanas

Google tarda días o semanas en rastrear e indexar. Revisa periódicamente:

1. **Indexación de páginas** (menú **Páginas** / «Indexación»):
   - Que **`landing.html`** (y `faq`, `privacidad`, `terminos`) acaben en
     **«Indexada»**.
   - Que **`index.html`** aparezca como **«Excluida por etiqueta noindex»** — eso
     es **correcto** (la app no debe indexarse).
   - Que **`privacy.html`** y **`terms.html`** salgan como **«Excluida por noindex»**
     o **«Página alternativa con la etiqueta canónica adecuada»**. También correcto.

2. **Errores de rastreo:** vigila 404, 5xx o redirecciones inesperadas. La
   redirección a https de `server.cjs` y el rewrite SPA de Vercel no deberían
   generar errores; si aparecen bucles de redirección, avísame.

3. **Señal de alarma del canonical (importante):** si en el informe de páginas
   `privacy.html` o `terms.html` aparecen como
   **«Duplicada: Google eligió una canónica distinta de la del usuario»** o
   **«Duplicada sin canónica seleccionada por el usuario»**, significa que el
   `rel="canonical"` que pusimos hacia `privacidad.html`/`terminos.html` **no se
   está respetando** (o entra en conflicto con el `noindex`). En ese caso hay que
   revisar: que el canonical apunte a la URL exacta ya con el dominio real, que la
   página canónica sea `index/follow` y accesible, y plantear si conviene dejar
   solo `noindex` sin canonical en las duplicadas. **Avísame si lo ves.**

4. **Rendimiento:** en «Resultados de búsqueda», a partir de la 2ª-3ª semana
   empezarás a ver impresiones y clics de la landing. No esperes datos antes.

---

## 5. Recordatorio final

- **Sustituye el placeholder `TU-DOMINIO-REAL`** (en `SITE_URL` de `vite.config.js`)
  **antes** de desplegar y de verificar aquí. Es el requisito previo a todo.
- **Confirma en la consola real** que los nombres de menús y los pasos no han
  cambiado: Google reestructura GSC con frecuencia.
