# Monitorización — configuración manual

Todo está implementado y **funciona con las variables vacías**: sin configurar
nada, la app no envía nada a ningún sitio y no se rompe. Este documento es lo
que tienes que hacer tú, en orden.

> **Dos avisos antes de empezar.**
>
> 1. **No doy por cierto ningún precio ni ningún límite de plan.** Cambian, y
>    equivocarme ahí te costaría dinero. Todo lo que afecta a tu factura está
>    marcado **[VERIFICAR]** con el sitio donde comprobarlo.
> 2. **Los nombres de los menús de estos servicios cambian.** Los que escribo
>    son los que tenían al documentar esto. Si algo no está donde digo, dime
>    qué ves y lo ajusto en vez de buscar a ciegas.

**Última actualización:** 31 de octubre de 2026

---

## Orden recomendado

| # | Tarea | Tiempo | ¿Imprescindible para lanzar? |
|---|---|---|---|
| 1 | Crear proyecto de Sentry (navegador) y poner `VITE_SENTRY_DSN` | 15 min | **Sí** |
| 2 | Crear proyecto de Sentry (servidor) y poner `SENTRY_DSN_SERVER` | 10 min | **Sí** |
| 3 | Monitores en UptimeRobot | 15 min | **Sí** |
| 4 | Elegir y configurar la analítica | 20 min | Recomendable |
| 5 | `HEALTH_DEEP_SECRET` para el health profundo | 2 min | No |
| 6 | Subida de source maps a Sentry | 30 min | **No** — ver el apartado 6 |

---

## 1. Sentry para el navegador

### 1.1 Crear el proyecto

1. Crea una cuenta en <https://sentry.io>.
2. **Elige la región de la Unión Europea** al crear la organización.
   Esto importa: si eliges Estados Unidos, los informes de error salen del
   territorio europeo y pasa a ser una transferencia internacional que hay que
   documentar en la política de privacidad con su base jurídica. La región
   **no se puede cambiar después** sin crear otra organización.
3. Crea un proyecto con plataforma **Browser → JavaScript**.
4. Copia el **DSN**. Tiene esta forma:
   `https://[COMPLETAR]@o[COMPLETAR].ingest.de.sentry.io/[COMPLETAR]`

> El DSN es **público por diseño** (viaja en el código que se descarga el
> navegador). No es un secreto, pero tampoco va escrito en el repositorio: va
> en una variable para poder cambiarlo y para que el código funcione sin él.

### 1.2 Ponerlo en Vercel

**Vercel** → tu proyecto → **Settings** → **Environment Variables**:

```
VITE_SENTRY_DSN = <el DSN que acabas de copiar>
VITE_RELEASE    = $VERCEL_GIT_COMMIT_SHA
```

`VITE_RELEASE` hace que cada despliegue sea una «release» distinta en Sentry.
Sin eso, Sentry agrupa todo junto y no puedes saber si un error es nuevo o si
venía de antes — que es justo la pregunta que querrás responder.

Vuelve a desplegar: son variables de build, no de ejecución.

### 1.3 Apretar la CSP (opcional, recomendado)

La aplicación ya permite en su Content Security Policy los comodines
`https://*.ingest.sentry.io` y `https://*.ingest.de.sentry.io`. Son hosts
controlados por Sentry, así que es mucho más estrecho que abrir `https:`
entero, pero se puede apretar más.

Cuando tengas tu DSN, en **Railway** → **Variables**:

```
SENTRY_INGEST_ORIGIN = https://o[TU-NUMERO].ingest.de.sentry.io
```

Y en `vercel.json`, sustituye los dos comodines por ese mismo host.

> **El dominio exacto depende de tu DSN.** Es la parte entre la `@` y la `/`.
> Dímelo cuando lo tengas y aprieto `vercel.json` por ti.

### 1.4 Lo que YA está configurado (no toques nada)

| Ajuste | Valor | Por qué |
|---|---|---|
| `sendDefaultPii` | `false` | Ni IP, ni cookies, ni cabeceras |
| Session Replay | **no instalado** | Graba la pantalla del usuario; aquí la pantalla *es* el dato |
| `tracesSampleRate` | `0` | Cada traza lleva URL y tiempos de cada petición |
| Migas de consola | desactivadas | Pueden llevar cualquier cosa que alguien imprimiera al depurar |
| Migas de clic y tecla | desactivadas | El texto del elemento pulsado puede ser un importe o un nombre |
| Integración `HttpContext` | quitada | Añade la URL completa, las cabeceras y el user agent |
| Variables locales | borradas | Es donde con más facilidad aparecería una cifra del usuario |
| Usuario | solo un hash de 16 caracteres | Calculado en el navegador: el uid no sale nunca |
| En `localhost` | no envía | Los errores se ven en la consola y no se gasta cuota |
| Do Not Track / GPC | se respetan | Si están activados, no se envía nada |

Y antes de enviar cualquier cosa, el evento pasa por un **filtro de
redacción** que sustituye importes, IBAN, tarjetas, correos, tokens y claves de
API. Los patrones están en `src/core/redact-patterns.json`, son la **misma
fuente** que usa el servidor, y hay 16 tests que los comprueban.

> **[VERIFICAR]** El plan gratuito de Sentry tiene un límite de eventos al mes.
> Míralo en <https://sentry.io/pricing/>. Si lo superas, Sentry deja de aceptar
> eventos hasta el mes siguiente (no cobra de más sin avisar, pero pierdes
> visibilidad). Si te pasa, se baja la tasa de muestreo o se amplía la lista de
> `ignoreErrors`.

---

## 2. Sentry para el servidor

**Crea un proyecto SEPARADO**, con plataforma **Node.js**. No reutilices el del
navegador: mezclarlos hace imposible distinguir «falla el móvil de un usuario»
de «se ha caído el servidor», que son dos problemas con urgencias distintas.

En **Railway** → tu servicio → **Variables**:

```
SENTRY_DSN_SERVER = <el DSN del proyecto de Node>
SENTRY_ENV        = production
SENTRY_RELEASE    = ${{RAILWAY_GIT_COMMIT_SHA}}
```

El servidor lo confirma al arrancar:

```
[FINOVA/Sentry] Monitorización de errores activa — production
```

### Lo que ya está desactivado en el servidor

Tres integraciones de Sentry están quitadas a propósito, y una de ellas importa
mucho:

- **`LocalVariablesAsync`** captura los **valores de las variables locales** de
  cada nivel de la pila. En una aplicación de finanzas eso significa importes,
  identificadores y tokens dentro del informe de error. Es la más peligrosa de
  todas para este proyecto.
- **`RequestData`** mete la petición completa: cabeceras (incluida
  `Authorization`), cookies, parámetros y cuerpo.
- **`Console`** captura los logs, que llevan rutas e identificadores.

Cada error 500 se reporta con **el método y la ruta sin parámetros**, el uid
hasheado y nada más. El cuerpo de la petición nunca se envía.

---

## 3. UptimeRobot

### 3.1 Los tres monitores

| # | Qué vigilar | URL | Palabra clave esperada |
|---|---|---|---|
| 1 | El servidor (API) | `https://[TU-DOMINIO]/api/health` | `ok` |
| 2 | La aplicación | `https://[TU-DOMINIO]/index.html` | `Finova` |
| 3 | La landing | `https://[TU-DOMINIO]/landing.html` | `Finova` |

**Usa el tipo de monitor con palabra clave, no solo «HTTP(s)».** Un monitor que
solo mira el código 200 no detecta el fallo más común: que el proxy responda
200 con una página de error, o que la aplicación cargue en blanco. La palabra
clave es lo que distingue «el servidor contesta» de «el servidor sirve».

El endpoint `/api/health` devuelve exactamente esto, y nada más:

```json
{"ok":true,"ts":"2026-10-31T19:52:44.627Z"}
```

Sin versiones, sin uptime, sin rutas internas, sin variables. Es público a
propósito y no revela nada que sirva a quien quiera atacarte.

### 3.2 Dos cosas que arreglé para que esto funcione

Vale la pena que las sepas, porque sin ellas los monitores habrían dado falsas
alarmas:

1. **El health check va ahora ANTES del chequeo del secreto del proxy.** Si
   tienes `FINOVA_PROXY_SECRET` configurada, cualquier petición a `/api/*` que
   no venga del proxy de Vercel recibe un **403**. Un monitor apuntando
   directamente a Railway habría reportado una caída permanente. Ahora
   `/api/health` se responde antes de esa comprobación; el resto de endpoints
   siguen protegidos igual.
2. **El health check no pasa por el limitador de peticiones.** Un monitor hace
   una petición cada pocos minutos desde la misma dirección y acabaría
   agotando su propio cubo.

Comprobado con curl: `/api/health` responde 200 con el secreto del proxy
configurado, y `/api/ai-status` sigue devolviendo 403 sin la cabecera.

> El agente de UptimeRobot **no** está en la lista de agentes bloqueados del
> servidor (que solo corta escáneres: sqlmap, nikto, nmap y similares).
> Comprobado en el código.

### 3.3 Monitorizar Railway Y Vercel

Te recomiendo **dos monitores para la API**, no uno:

- Uno a `https://[TU-DOMINIO]/api/health` → pasa por Vercel y su proxy. Prueba
  la cadena completa, que es lo que vive el usuario.
- Uno directo al dominio que te da Railway (lo ves en su panel; tiene la forma
  `https://[TU-SERVICIO].up.<dominio-de-railway>/api/health`) → aísla el
  servidor. Si el primero falla y este no, el problema está en Vercel.

Sin el segundo, una caída de Vercel y una caída de Railway te llegan como la
misma alerta.

### 3.4 Alertas

Configura al menos dos canales, porque si el correo falla te quedas sin aviso:

1. **Correo** a `MyFinova1@gmail.com`.
2. **Un webhook a Discord o Telegram.** Si ya has creado el webhook de Discord
   para el feedback (ver `FEEDBACK_SETUP.md`), reutiliza el mismo servidor con
   otro canal, por ejemplo `#finova-alertas`.

> En la interfaz de UptimeRobot esto estaba en «My Settings → Alert Contacts» y
> luego se asigna a cada monitor. **Verifícalo**: han reorganizado el panel
> varias veces. Dime qué ves si no lo encuentras.

### 3.5 ⚠️ Lo que tienes que comprobar antes de depender de esto

Esto es importante y no lo puedo verificar yo:

**Si tu plan de Railway suspende el servicio por inactividad**, un monitor que
haga ping cada 5 minutos lo mantendrá despierto — lo cual suena bien, pero
significa que **el servidor estará activo 24/7 y consumirá horas de ejecución
del plan** en vez de dormir cuando nadie lo usa. Con un plan gratuito por horas,
eso puede agotar la cuota a mitad de mes y dejarte el servicio caído de verdad.

**Qué comprobar en tu panel de Railway, antes de crear los monitores:**

1. ¿Tu plan tiene límite de horas de ejecución al mes, o se factura por uso?
2. ¿El servicio se duerme por inactividad?
3. ¿Cuánto consumiría estando despierto todo el mes?

Según la respuesta:

- **Plan por horas con suspensión:** pon el monitor cada 15 o 30 minutos en vez
  de cada 5, o acepta que el servidor esté siempre despierto y ajusta el plan.
- **Plan de pago sin suspensión:** cada 5 minutos sin problema.

> **[VERIFICAR]** También la frecuencia mínima que te permite tu plan de
> UptimeRobot. El plan gratuito históricamente permitía intervalos de 5
> minutos, pero confírmalo en <https://uptimerobot.com/pricing/>.

### 3.6 Página de estado pública: opcional

**A favor:** si se cae, la gente lo ve sin escribirte, y da una impresión de
seriedad.

**En contra:** publica tu historial de caídas para siempre, incluidas las del
primer mes mientras ajustas cosas. Y con pocos usuarios, nadie la va a mirar.

**Mi recomendación:** no la pongas todavía. Cuando tengas varios cientos de
usuarios y un historial decente, entonces sí.

---

## 4. Analítica sin cookies

### 4.1 La comparación, con honestidad

He descartado una opción por un motivo concreto antes de comparar las demás:

> **Cloudflare Web Analytics queda fuera.** Es gratuita y respetuosa con la
> privacidad, pero **no admite eventos personalizados**, y el encargo necesita
> ocho (registro completado, primera transacción, etc.). Sin eventos no se
> puede medir el embudo, que es justo lo que interesa en un lanzamiento.

| | Coste | Dónde se alojan los datos | ¿Cookies? | Eventos propios | Esfuerzo |
|---|---|---|---|---|---|
| **Umami Cloud** | Tiene plan gratuito **[VERIFICAR]** | UE **[VERIFICAR]** la región de tu cuenta | No | Sí, con propiedades | Muy bajo: un script |
| **Umami autoalojado** | Solo tu servidor | Donde tú lo pongas | No | Sí | Alto: base de datos y mantenimiento |
| **Plausible Cloud** | Solo de pago **[VERIFICAR]** | UE (Alemania) | No | Sí, «goals» | Muy bajo |
| **Plausible autoalojado** | Solo tu servidor | Donde tú lo pongas | No | Sí | Alto |
| **GoatCounter** | Gratis para uso no comercial **[VERIFICAR]** si Finova califica | UE (Irlanda) **[VERIFICAR]** | No | Limitados | Bajo |

**[VERIFICAR] en cada caso:** el precio, los límites del plan gratuito y la
región de alojamiento, en la página de cada herramienta. No me fío de lo que
recuerdo de sus precios y tú tampoco deberías.

**Licencias:** Umami es MIT y Plausible es AGPL-3.0. Para usarlas como servicio
da igual; solo importaría si modificaras el código de Plausible y lo
distribuyeras. **[VERIFICAR]** si alguna vez te planteas el autoalojado.

### 4.2 Mi recomendación: Umami Cloud

Por tres razones, en este orden:

1. **Tiene plan gratuito**, y en un lanzamiento sin ingresos eso decide.
2. **Eventos personalizados con propiedades**, que es el requisito que descarta
   a Cloudflare y limita a GoatCounter.
3. **Sin cookies por diseño**, que es lo que permite no poner banner.

**Si puedes pagar desde el principio, Plausible es mejor producto**: mejor
documentación, panel más claro y alojamiento en Alemania sin ambigüedad. La
integración es idéntica — el código ya detecta cuál de las dos está cargada y
llama a la que haya (`track()` en `src/core/analytics.js`), así que cambiar es
tocar dos variables.

### 4.3 Configurarla

1. Crea una cuenta en Umami Cloud y añade tu dominio como «website».
2. Copia el **Website ID**.
3. En **Vercel** → **Environment Variables**:
   ```
   VITE_ANALYTICS_SRC = https://cloud.umami.is/script.js
   VITE_ANALYTICS_ID  = [COMPLETAR con tu Website ID]
   ```
4. En **Railway** → **Variables** (para la CSP que sirve el servidor):
   ```
   ANALYTICS_ORIGIN = https://cloud.umami.is
   ```
5. Vuelve a desplegar.

`vercel.json` ya incluye `https://cloud.umami.is` en la CSP. **Si autoalojas o
eliges Plausible, hay que cambiarlo a mano** en `script-src` y `connect-src`.
Dime el dominio y lo cambio.

### 4.4 Lo que se envía, y lo que no puede enviarse

El script envía lo normal de una analítica: página visitada, referente, tipo de
navegador y país aproximado. **Sin cookies y sin almacenar nada en el
dispositivo.**

Los ocho eventos propios pasan por una función única, `track()`, con **dos
listas blancas cerradas**: una de nombres de evento y otra de nombres de
propiedad. Todo lo que no esté en ellas se descarta en silencio. Además:

- **Los números no se envían nunca.** Un número es lo único que puede ser un
  importe, así que `track()` los tira sin mirar.
- Un valor que *parezca* una cifra (con decimales, con €, con tres dígitos
  seguidos) también se descarta.
- Los valores con lista cerrada (`metodo`, `origen`, `proveedor`) que llegan con
  algo inesperado se convierten en `otro`, para que un valor nuevo no se
  convierta en una fuga por la puerta de atrás.

Hay 11 tests que lo comprueban, incluido uno que verifica que un evento
inventado se descarta.

**Un detalle del evento de importación:** la propiedad se llama `banco` por
coherencia con el encargo, pero lleva el **formato detectado** (`CSV`, `Excel`,
`OFX/QFX`). La aplicación no identifica al banco: detecta la estructura del
fichero de forma genérica, así que no hay nombre de banco que enviar.

### 4.5 Retención: qué se puede medir y qué no

**Lo que te da la propia herramienta:** visitantes únicos por día, visitas
recurrentes y de dónde vienen. Con eso ves si la gente vuelve, pero no quién.

**Lo que ya tiene el servidor:** el panel de administración calcula retención
**D1, D7 y D30** a partir de `data/analytics.json`, que se indexa por un
identificador de dispositivo generado en el cliente, no por usuario. Está en
**Admin → Retención de usuarios**.

> **Aviso:** ese fichero está en el disco del servidor, que es **efímero** si no
> tienes un volumen montado en Railway (el mismo problema que explico en
> `FEEDBACK_SETUP.md`). La retención se reinicia en cada despliegue. Y además
> el envío de esos datos está limitado a `localhost` por una guarda en el
> código, así que **en producción no se está recogiendo nada** — está anotado
> como pendiente en `AUDIT_PROGRESS.md`.

**Lo que no se puede medir, y es a propósito:** el embudo por usuario concreto.
Puedes ver «50 registros y 30 primeras transacciones» pero no cuáles de esos 50
pasaron al siguiente paso. Saberlo requeriría identificar al usuario en la
analítica, y eso es exactamente lo que no vamos a hacer.

---

## 5. Health check profundo (opcional)

Comprueba que el servidor puede **escribir y leer en disco de verdad**, que
Firebase Admin está inicializado y que hay clave de IA configurada. Es lo que
distingue «el proceso responde» de «el proceso sirve».

En **Railway** → **Variables**:

```
HEALTH_DEEP_SECRET = [COMPLETAR con una cadena larga y aleatoria]
```

Genérala con: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

Uso:

```bash
curl -H "x-health-secret: TU-SECRETO" https://[TU-DOMINIO]/api/health/deep
```

Respuesta:

```json
{"ok":true,"checks":{"disco":"ok","auth":"ok","ia":"ok"},"ts":"..."}
```

Devuelve **503** si el disco falla. `auth` y `ia` pueden salir `degradado` o
`sin-configurar` sin tumbar el estado general: sin Firebase Admin la aplicación
sigue funcionando con su verificación propia, y sin IA solo falta una función.

**Nunca llama a servicios de pago.** Solo mira si las claves están
configuradas, no si funcionan: un ping cada cinco minutos a un proveedor que
cobra por llamada sale caro.

**Sin el secreto configurado el endpoint responde 404**, no 403, para no
confirmar que existe. Con secreto incorrecto, también 404. Comparación en
tiempo constante.

Si lo pones en UptimeRobot, necesitas un monitor que permita cabeceras
personalizadas. **[VERIFICAR]** si tu plan lo permite.

---

## 6. Source maps: por qué lo dejo como opcional

Sin source maps, las trazas de un bundle minificado son ilegibles. Pero este
proyecto es un caso especial y conviene explicarlo antes de que inviertas media
hora:

**Los nombres de función se conservan en producción.** `vite.config.js` usa
Terser con `mangle.toplevel: false` (porque el HTML llama a las funciones por
nombre con `onclick="..."`), así que en `dist/` siguen apareciendo
`_txCreate`, `renderFiscalidad`, `openFeedbackModal`… Lo he comprobado.

Es decir: **las trazas de Sentry ya van a ser legibles** sin hacer nada. Vas a
ver el nombre de la función y el mensaje del error. Lo que perderás es el
número de línea exacto, porque todo el fichero va en una sola línea.

En mi experiencia, con el nombre de la función y el mensaje del error se
localiza el problema el 90 % de las veces. **Mi recomendación: lanza sin source
maps y añádelos si echas de menos el número de línea.**

### Si decides hacerlo

Está implementado y listo:

```bash
SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=... npm run build:sentry
```

El script (`scripts/upload-sourcemaps.sh`):

1. Construye con `VITE_SOURCEMAP=1`.
2. Sube los mapas a Sentry con `@sentry/cli`.
3. **Los borra de `dist/`** y quita las referencias `sourceMappingURL`.
4. **Aborta si queda alguno.** Esto es lo importante: un `.map` publicado deja
   tu código fuente original descargable desde el navegador.

Comprobado: build normal → 0 mapas; con `VITE_SOURCEMAP=1` → 3 mapas; tras el
borrado → 0.

El `SENTRY_AUTH_TOKEN` **nunca va en el repositorio**: se pasa por variable de
entorno.

**En Vercel** hay un problema práctico: el build lo ejecuta Vercel, no tú, así
que el borrado tendría que ocurrir dentro de su build. Eso significa cambiar el
comando de build del proyecto a `npm run build:sentry` y añadir las tres
variables en su panel. **No lo he configurado** porque no tengo acceso a tu
Vercel y porque un fallo ahí rompe el despliegue.

**La alternativa más simple**, si quieres números de línea sin tocar el
despliegue: hacer el build con mapas en tu máquina y subirlos tú tras cada
despliegue, con `npm run build:sentry`. Es un paso manual, pero no puede romper
producción.

---

## 7. Comprobar que todo funciona

Cuando tengas los DSN puestos y desplegado:

### Sentry

**Admin → Monitorización** (en el panel de administrador de la app) tiene dos
botones: **«Probar error (navegador)»** y **«Probar error (servidor)»**. Solo
visibles para administradores.

Los dos lanzan un error que lleva a propósito un importe, un correo, un IBAN y
un token **falsos**. Cuando aparezca en Sentry, debes ver esto:

```
Error de prueba de Finova — importe [importe], correo [correo],
IBAN [iban], token [token]
```

**Si ves los datos sin redactar, algo va mal: dímelo.**

### El resto

```bash
# Health público
curl https://[TU-DOMINIO]/api/health

# Health profundo
curl -H "x-health-secret: TU-SECRETO" https://[TU-DOMINIO]/api/health/deep

# Que no hay source maps publicados
curl -s -o /dev/null -w "%{http_code}\n" https://[TU-DOMINIO]/assets/[hash].js.map
# Debe dar 404
```

**Y mira la consola del navegador** con la app desplegada: si la CSP bloquea
algo, aparece un error `Refused to connect to...` con el dominio exacto. Si
pasa, dime qué dominio es y lo añado.

---

## 8. Resumen de variables

### Vercel (frontend)

| Variable | Obligatoria | Valor |
|---|---|---|
| `VITE_SENTRY_DSN` | Para tener errores | DSN del proyecto Browser |
| `VITE_RELEASE` | Recomendable | `$VERCEL_GIT_COMMIT_SHA` |
| `VITE_ANALYTICS_SRC` | Para tener analítica | `https://cloud.umami.is/script.js` |
| `VITE_ANALYTICS_ID` | Para tener analítica | Tu Website ID |

### Railway (servidor)

| Variable | Obligatoria | Valor |
|---|---|---|
| `SENTRY_DSN_SERVER` | Para tener errores | DSN del proyecto **Node** |
| `SENTRY_ENV` | Recomendable | `production` |
| `SENTRY_RELEASE` | Recomendable | `${{RAILWAY_GIT_COMMIT_SHA}}` |
| `SENTRY_INGEST_ORIGIN` | No | Aprieta la CSP a tu host exacto |
| `ANALYTICS_ORIGIN` | Si hay analítica | `https://cloud.umami.is` |
| `HEALTH_DEEP_SECRET` | No | Cadena aleatoria larga |

**Todas vacías, la app funciona igual.** Está probado: el servidor arranca, el
health responde, y el navegador no intenta contactar con nadie.

---

## 9. Un aviso sobre `npm audit`

Al instalar `@sentry/node` aparecen avisos de vulnerabilidad. Los he mirado uno
a uno para que no te alarmes ni los ignores a ciegas:

Las tres raíces son **`deepmerge`, `glob` y `minimatch`**, y llegan a través de
`@sentry/bundler-plugins`, que `@sentry/node@11` arrastra como dependencia de
ejecución (algo discutible por su parte, pero es así). Ese paquete solo se usa
para **subir source maps en tiempo de build**: el servidor en marcha no lo
llama nunca, así que el riesgo práctico sobre el servicio es nulo.

`npm audit fix` propone **bajar a `@sentry/node@10`**, que es un cambio de
versión mayor. **No lo he hecho**: cambiar de versión mayor un SDK por un aviso
en una herramienta de build que no se ejecuta en producción es peor negocio que
el aviso.

**Lo que sí deberías hacer:** volver a mirarlo en un par de meses. Si Sentry
saca una v11 con esas dependencias actualizadas, `npm update @sentry/node` lo
arregla sin más.
