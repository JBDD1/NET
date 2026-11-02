# Despliegue de `server.cjs`

Este documento cubre **solo el servidor** (`server.cjs`). El frontend lo
sirve Vercel desde `dist/`; eso está en `IMPORT_ENGINE.md` y `SECURITY.md`.

> Donde pongo **«verifica en la documentación del proveedor»** es porque no
> lo he comprobado desde aquí. Los nombres de menús y de variables de
> Railway, Render y Fly cambian, y preferiría que no te fíes de mí en eso.

---

## Lo mínimo

| Cosa | Valor |
|---|---|
| Comando de arranque | `node server.cjs` |
| Health check | `GET /api/health` → `200 {"ok":true,"ts":<epoch>}` |
| Puerto | El que ponga el proveedor en `PORT`. No lo fijes a mano |
| Versión de Node | La que uses en local (`node -v`). Decláralo en `engines` o en la configuración del proveedor |

El servidor **no necesita build**: es CommonJS y se ejecuta tal cual.

---

## Variables de entorno

Ninguna lleva valores aquí. La plantilla está en `.env.server.example`.

### Obligatorias en producción

| Variable | Para qué |
|---|---|
| `NODE_ENV=production` | Activa el modo producción: apaga los estáticos, escucha en `0.0.0.0`, no abre navegador, banner de una línea |
| `ALLOWED_ORIGIN` | Orígenes permitidos para CORS, separados por comas. **Sin ella el servidor se niega a arrancar en producción**, a propósito |

### Muy recomendables

| Variable | Para qué | Qué pasa si falta |
|---|---|---|
| `DATA_DIR` | Ruta del volumen persistente | Los datos van a `data/` dentro del proyecto, que en la mayoría de los hostings es **efímero**: se pierden en cada despliegue |
| `FINOVA_ENC_KEY` | 64 hex. Cifra los datos de usuario en reposo (AES-256-GCM) | Los datos se guardan **en claro**. Ver `ROTATE_SECRETS.md` antes de rotarla |
| `TRUST_PROXY_HOPS` | Proxies de confianza delante. Ver abajo | Los límites por IP agrupan a todos los usuarios en un cubo |
| `FINOVA_PROXY_SECRET` | Exige que `/api/*` venga del proxy de Vercel | Se puede llamar al servidor directamente, saltándose el proxy |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Firebase Admin: revocación de tokens y borrado de cuenta en servidor | Verificación JWT local sin revocación |

### Opcionales

| Variable | Para qué |
|---|---|
| `HOST` | Interfaz de escucha. Por defecto `0.0.0.0` en producción y `127.0.0.1` en local |
| `SERVE_STATIC` | Si este proceso sirve el frontend. Por defecto `false` en producción |
| `STATIC_DIR` | Desde dónde, si `SERVE_STATIC` está activo |
| `OPEN_BROWSER=false` | No abrir el navegador al arrancar (ya no se abre en producción) |
| `FINOVA_ADMIN_EMAILS` | Correos de administrador, separados por comas |
| `FINOVA_GROQ_KEY`, `FINOVA_CLAUDE_KEY` | Asesor IA del servidor |
| `SENTRY_DSN_SERVER`, `SENTRY_ENV`, `SENTRY_RELEASE` | Errores a Sentry |
| `FEEDBACK_WEBHOOK_URL` | Canal del feedback. **La URL es el secreto** |
| `HEALTH_DEEP_SECRET` | Protege `/api/health/deep` |
| `FINOVA_GC_SECRET_ID`, `FINOVA_GC_SECRET_KEY` | GoCardless (banca abierta) |
| `REQUIRE_EMAIL_VERIFIED` | Exigir email verificado |

El servidor imprime al arrancar **los nombres** de las opcionales que falten.
Nunca imprime valores: ese log acaba en el panel del hosting y en Sentry.

---

## Volumen y `DATA_DIR`

### Por qué importa

`server.cjs` guarda en disco los datos de cada usuario
(`<DATA_DIR>/users/*.json`, cifrados si `FINOVA_ENC_KEY` está puesta), los
backups de sync, los roles, la analítica y los cubos del rate limit.

**En la mayoría de los hostings el disco del contenedor es efímero.** Sin un
volumen, todo eso desaparece en cada despliegue. El servidor lo avisa en los
logs si detecta que `DATA_DIR` ha quedado dentro del proyecto, pero no lo
impide: hay despliegues legítimos sin persistencia (una demo, una preview).

### Qué hacer

1. Declara un volumen persistente y mira **en qué ruta queda montado** —
   verifica en la documentación del proveedor cómo se declara y cuál es esa
   ruta.
2. Pon `DATA_DIR` a esa ruta (o a un subdirectorio suyo).
3. Despliega y comprueba en los logs que la línea de arranque dice
   `data=<tu ruta>` y que **no** aparece el aviso de disco efímero.

El servidor crea `users/` y `sync/` dentro de `DATA_DIR` al arrancar, y
comprueba que puede escribir y leer de verdad con un fichero temporal. **Si
no puede, no arranca** — mejor eso que descubrirlo cuando un usuario guarda
sus datos y recibe un 500.

### Mover datos que ya existen

**El servidor no mueve nada automáticamente**, a propósito: copiar datos de
usuario sin que nadie lo haya pedido es la clase de cosa que sale mal en
silencio. Si ya tenías datos en `data/` y montas un volumen:

```bash
# Con el servicio PARADO, para que no escriba a mitad de la copia.
cp -r data/. "$DATA_DIR"/
ls "$DATA_DIR"/users | wc -l   # comprueba que están todos
```

Si el hosting no te deja ejecutar comandos con el servicio parado, verifica
en su documentación cómo abrir una shell en el contenedor con el volumen
montado.

---

## `TRUST_PROXY_HOPS`

### Qué resuelve

Detrás de un proxy, `socket.remoteAddress` es la IP **del proxy**, no la del
usuario. Si se usa tal cual, todos los usuarios comparten un cubo de rate
limit. Y si se coge `X-Forwarded-For` sin más, cualquiera obtiene un cubo
nuevo mandando una cabecera inventada.

Ese segundo caso **era real en este servidor** y está medido: agotado el cubo
de `/api/waitlist` (5 por IP) hasta recibir 429, bastaba añadir
`X-Forwarded-For: 1.2.3.4` para que la siguiente petición pasara. Afectaba a
todos los límites por IP: IA (que cuesta dinero), sync, borrado de cuenta,
feedback y admin.

### Cómo funciona

- `0` (por defecto): se usa la IP de la conexión y **se ignora
  `X-Forwarded-For` por completo**. Es lo correcto si nada hay delante.
- `N`: se toma el elemento **N contando desde la derecha** de
  `X-Forwarded-For`.

Desde la derecha y nunca desde la izquierda: la cabecera la construyen los
proxies **añadiendo al final**, así que los últimos elementos los puso
infraestructura de confianza y los primeros los puede escribir quien envía la
petición.

Si la cadena tiene menos elementos de los configurados, se cae a la IP de la
conexión: una cadena más corta de lo esperado es justamente la señal de que
alguien la está manipulando.

### Cómo calibrarlo (hazlo tú, desde producción)

1. Despliega con `TRUST_PROXY_HOPS` sin poner (vale 0).
2. Entra con una cuenta de **administrador** y pide:

   ```
   GET /api/admin/whoami
   ```

   Devuelve, con los dos últimos octetos tapados:

   ```json
   {
     "ok": true,
     "ipDerivada": "10.0.x.x",
     "trustProxyHops": 0,
     "fuente": "conexión directa (X-Forwarded-For ignorada)",
     "xffLongitud": 2,
     "xffTapada": ["81.44.x.x", "76.76.x.x"],
     "ipConexion": "10.0.x.x"
   }
   ```

3. Interpreta:
   - `xffLongitud: 0` → no hay proxy. Deja `TRUST_PROXY_HOPS` en 0.
   - `xffLongitud: N` → pon `TRUST_PROXY_HOPS = 1` y vuelve a pedirlo.
     `ipDerivada` debe ser ahora una IP **pública** que se parezca a la tuya
     (compárala con lo que diga cualquier servicio de «cuál es mi IP»).
   - Si `ipDerivada` sigue siendo una IP privada (`10.x`, `172.16–31.x`,
     `192.168.x`) o la del centro de datos, sube a 2 y repite.

4. Comprueba que ha funcionado: desde dos redes distintas (el móvil con
   datos y el wifi), `ipDerivada` debe salir **diferente**. Si sale igual,
   el valor sigue siendo bajo y todos comparten cubo.

**No subas el número «por si acaso».** Cada salto de más es un elemento que
el cliente puede llegar a controlar.

---

## Qué probar tras cada despliegue

| # | Qué | Cómo | Esperado |
|---|---|---|---|
| 1 | Arranque | Logs del hosting | Una línea `[FINOVA] listo · puerto=… host=0.0.0.0 modo=producción data=…` |
| 2 | Disco | Esos mismos logs | **Sin** el aviso de disco efímero |
| 3 | Salud | `curl https://<host>/api/health` | `200 {"ok":true,"ts":…}` |
| 4 | Salud por HEAD | `curl -I https://<host>/api/health` | `200`, sin cuerpo |
| 5 | Estáticos apagados | `curl https://<host>/index.html` | `404 {"error":"Not found"}` |
| 6 | API viva | `curl https://<host>/api/ai-status` | `200` con JSON |
| 7 | IP real | `/api/admin/whoami` con cuenta admin | `ipDerivada` pública y distinta según la red |
| 8 | Persistencia | Guarda algo, **redespliega**, vuelve a mirar | Los datos siguen ahí |
| 9 | Cierre ordenado | Logs durante el redespliegue | `[FINOVA] Apagando — SIGTERM` y ninguna petición cortada |

El 8 es el que más veces se olvida y el único que detecta un volumen mal
montado. El 9 **no he podido verificarlo** (ver abajo).

---

## Lo que no he podido verificar

**El cierre ordenado, de forma conductual.** Windows no implementa las
señales POSIX: `child.kill('SIGTERM')` llama a `TerminateProcess` y el
proceso muere sin ejecutar su manejador. Lo reproduje con un caso mínimo —un
hijo con un manejador de `SIGTERM` que imprime y sale con 0 muere con
`exitCode: null` y sin imprimir nada.

Así que en Windows la prueba solo comprueba que los manejadores están
registrados y que el proceso muere. **La verificación de verdad hay que
hacerla en Linux**, que es donde corre el hosting: mira el punto 9 de la
tabla en el primer redespliegue.

**El hosting real, en general.** Todo está medido en local con
`NODE_ENV=production` simulado. No he desplegado nada.

**Los nombres de variable de los proveedores.** `RAILWAY_ENVIRONMENT` y
`RAILWAY_PROJECT_ID` los tomé del código que ya había; `RENDER` y
`FLY_APP_NAME` de lo que se cita habitualmente. **No los he verificado
contra su documentación.** Lo que sí es fiable es `NODE_ENV=production`, que
la pones tú: si tienes dudas, pon esa y no dependas de la detección
automática.

**Que `/api/health` llegue a través del proxy de Vercel.** `vercel.json`
tiene un `rewrite` catch-all a `/index.html`, pero Vercel resuelve las
funciones de `api/` **antes** de aplicar los rewrites, y
`api/[...path].js` reenvía todo `/api/*` a Railway sin filtrar rutas. Eso es
comportamiento documentado de Vercel, no algo que yo haya comprobado contra
un despliegue: confírmalo con el punto 3 de la tabla la primera vez.
