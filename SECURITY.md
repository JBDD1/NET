# Seguridad — Finova

## Dónde viven los secretos

| Secreto | Dónde está | Quién puede verlo |
|---|---|---|
| Firebase API Key (cliente) | `.env.development`, `.env.production` | Cualquiera — es pública por diseño de Google |
| Firebase Admin Private Key | Railway → Variables | Solo Railway y tú |
| FINOVA_GROQ_KEY | Railway → Variables | Solo Railway y tú |
| FINOVA_CLAUDE_KEY | Railway → Variables | Solo Railway y tú |
| FINOVA_ADMIN_EMAILS | Railway → Variables | Solo Railway y tú |
| Claves IA del usuario | `localStorage` del usuario | Solo el propio usuario |

## Reglas de oro

1. **Nunca** poner secretos reales en el código fuente
2. **Nunca** poner secretos en archivos que van a GitHub (`.env`, `.env.local`, etc.)
3. **Nunca** loguear secretos en consola o en logs
4. **Nunca** enviar secretos en URLs (query params visibles en logs de acceso)
5. **Siempre** usar HTTPS para transmitir cualquier dato sensible
6. **Siempre** rotar una clave si hay la mínima duda de que estuvo expuesta

## Archivos comprometidos con git

| Archivo | ¿Va a GitHub? | Motivo |
|---|---|---|
| `.env.development` | ✅ Sí | Solo Firebase client keys (públicas) |
| `.env.production` | ✅ Sí | Solo Firebase client keys (públicas) |
| `.env.server.example` | ✅ Sí | Plantilla sin valores reales |
| `.env.local` | ❌ NO | Secretos locales del desarrollador |
| `firebase-service-account.json` | ❌ NO | Credencial privada de Firebase Admin |

## ¿Por qué las Firebase client keys son seguras en el código?

Firebase Client API Key no es un secreto tradicional. Google lo diseñó para ser público:
- Solo identifica el proyecto Firebase, no autentica operaciones
- Las operaciones están protegidas por Firebase Security Rules y Firebase Auth
- La documentación oficial de Google documenta este comportamiento
- **Lo que SÍ sería peligroso**: la Firebase Admin Private Key (nunca en frontend)

## Si subes un secreto a GitHub por error

1. **Inmediatamente** revoca la clave en la plataforma:
   - Groq: `console.groq.com` → API Keys → Delete
   - Claude: `console.anthropic.com` → API Keys → Delete
   - Firebase Admin: Firebase Console → Service Accounts → Delete key
   - GoCardless: `bankaccountdata.gocardless.com` → Secrets → Revoke

2. Elimina el secreto del historial de Git:
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch ARCHIVO_CON_SECRETO" \
     --prune-empty --tag-name-filter cat -- --all
   git push origin --force --all
   ```

3. Genera una nueva clave y configúrala en Railway

4. Revisa los logs de Railway para detectar uso no autorizado

## Variables de entorno por plataforma

### Railway (servidor)

Panel: `railway.app` → tu proyecto → Variables

Variables requeridas en producción:
- `FINOVA_GROQ_KEY` o `FINOVA_CLAUDE_KEY`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- `ALLOWED_ORIGIN` (tu dominio de Vercel)
- `FINOVA_FIREBASE_PROJECT` (ID del proyecto Firebase)
- `FINOVA_ADMIN_EMAILS`

### Vercel (frontend)

Panel: `vercel.com` → tu proyecto → Settings → Environment Variables

Variables requeridas:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_SERVER_URL` (dejar vacío — Vercel hace el proxy automáticamente)

### Desarrollo local

1. Crea `.env.local` (está en `.gitignore`)
2. Rellena los valores reales copiando la estructura de `.env.server.example`
3. Verifica que `.env.local` NO aparece en `git status`

## Ficheros estáticos

`server.cjs` puede servir el frontend además de la API. El directorio del
proyecto contiene `data/users/*.json` (datos de usuario cifrados),
`data/sync/*`, `.env.*`, `.git/`, `node_modules/` y `server.cjs`, así que
resolver una ruta arbitraria dentro de él equivale a publicar el repositorio
y la base de datos.

### Las variables

| Variable | Por defecto | Qué hace |
|---|---|---|
| `SERVE_STATIC` | `true` si `NODE_ENV != production`, `false` si lo es | Si se sirve el frontend. Con `false`, todo lo que no sea `/api/*` responde `404 {"error":"Not found"}` |
| `STATIC_DIR` | `dist/` en producción; la raíz del proyecto en desarrollo | Desde dónde se sirve |
| `NODE_ENV` | sin valor (desarrollo) | Con `production` apaga los estáticos y exige `ALLOWED_ORIGIN` para arrancar |

**En producción el frontend lo sirve Vercel**, no este proceso. Por eso
`SERVE_STATIC` es `false` ahí por defecto: servirlo sería superficie de
ataque que no hace falta para nada.

`STATIC_DIR=./dist` es siempre más seguro que la raíz del proyecto, porque
`dist/` solo contiene lo que el build publica. La raíz solo se usa en
desarrollo, y es el caso que exige todas las capas de abajo.

### Las capas, y por qué son cinco

Una petición tiene que pasarlas **todas**:

1. **Método.** Solo `GET` y `HEAD`.
2. **Forma de la URL.** Se rechaza byte nulo, `\`, `:`, `//`, y cualquier
   segmento `..`, `.` o que empiece por `.`.
3. **Lista blanca.** La ruta tiene que estar en `_PUBLIC_ROOT_FILES`, o ser
   un `.js` de la aplicación bajo `src/` (que es lo que el HTML carga en
   desarrollo), excluyendo `src/tests/`.
4. **Extensión y lista negra.** Extensión dentro de la lista permitida, y
   fuera de la lista negra explícita (`data/`, `node_modules/`, `scripts/`,
   `src/tests/`, `.git*`, `.env*`, `server.cjs`, `package*.json`,
   `*.bat`, `*.md`, `*service-account*`…), sin distinguir mayúsculas.
5. **Confinamiento.** `path.resolve` dentro de la raíz, y **otra vez**
   después de `fs.realpathSync`, por si hay un enlace simbólico que apunte
   fuera. Y tiene que ser un fichero, no un directorio.

La capa 3 es la que de verdad protege, y es a propósito una lista de lo
**permitido** y no de lo prohibido: una lista negra falla en silencio cada
vez que alguien añade un fichero nuevo al proyecto. Las capas 2, 4 y 5 están
para que un fallo en la 3 no sea explotable.

### Detalles que importan y son fáciles de perder

**Se decodifica UNA sola vez.** Una ruta doblemente codificada (`%252e`)
queda como `%2e` literal, que no es `..` y no existe en disco: denegada.
Decodificar en bucle hasta que la cadena no cambie es el error clásico que
convierte `%252e%252e` en una salida de directorio.

**Las comprobaciones se hacen sobre la ruta YA decodificada.** Comprobar
antes de decodificar deja pasar `/data%2Fusers%2F…`.

**La barra invertida y los dos puntos se rechazan.** En Windows `\` es
separador (`..\..\server.cjs` sale del directorio en esa máquina y no en
Linux) y `:` cubre las letras de unidad (`/C:/Windows/win.ini`) y los flujos
alternativos de NTFS (`/index.html::$DATA`, que sirve el mismo fichero
esquivando la comprobación de extensión).

**Los dotfiles se bloquean por forma, no por nombre.** Cualquier segmento que
empiece por `.` queda fuera, así que un fichero oculto nuevo queda tapado sin
tocar ninguna lista.

**Todo lo denegado responde el MISMO 404 que un fichero inexistente.** Nunca
403 ni un mensaje distinto: eso le confirmaría a quien escanea que el fichero
existe, que es la mitad de la información que busca. Hay un test que compara
cuerpo y código de un fichero denegado con uno inexistente y exige que sean
idénticos.

**Nunca se listan directorios.** `/` sirve `landing.html` y nada más.

**Los intentos denegados se registran** con la ruta truncada a 120
caracteres, sin cabeceras y con la IP recortada (`127.0.x.x`). Y pasan por un
cubo de 30 intentos por IP: un 404 suelto no ensucia el log, un escaneo deja
de escribir en cuanto lo agota. Lo que entra en el log acaba en Sentry, y un
escaneo automatizado mete ahí lo que le dé la gana.

### Entradas de usuario en rutas de fichero

La misma clase de fallo aparece en la API cada vez que un dato del cliente
entra en una ruta. Dos defensas, y las dos hacen falta:

- **Validación en el borde:** `_UID_RE` (`/^[a-zA-Z0-9]{20,128}$/`) y
  `_SYNC_CODE_RE` (`/^[a-f0-9]{8,16}$/`) se aplican **antes** de construir
  cualquier ruta. Ninguna de las dos admite `.`, `/` ni `\`.
- **`_safeJoin(base, nombre)`** en el punto de uso: resuelve y comprueba que
  el resultado queda dentro de `base`, o devuelve `null`. Lo usan
  `_metaPath`, `_blockedPath`, el fichero de datos de usuario y los dos
  extremos de sync. Así la garantía no depende de que cada llamante se
  acuerde de validar: un endpoint nuevo que lo olvide se topa con esto igual.

### Cómo comprobarlo

```bash
npm run test:security
```

52 comprobaciones: arrancan el servidor de verdad como proceso aparte, le
hablan por HTTP con la ruta **sin normalizar**, y además del código de estado
miran el **cuerpo** buscando lo que no debe salir (datos de usuario, código
de `server.cjs`, configuración de git, `/etc/passwd`, `package.json`). Cubren
desarrollo, producción y `SERVE_STATIC=false` forzado.

## Verificaciones rápidas

```bash
# Secretos NO están en git
git ls-files .env.local firebase-service-account.json
# Resultado esperado: sin output

# Sin API keys hardcodeadas en el código
grep -rn "sk-ant-\|gsk_\|AIzaSy\|-----BEGIN PRIVATE" src/ --include="*.js"
# Resultado esperado: sin output

# Sin URL de Railway en el frontend
grep -rn "railway.app" src/ dist/ 2>/dev/null
# Resultado esperado: sin output
```
