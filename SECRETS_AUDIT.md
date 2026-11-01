# Auditoría de secretos — repositorio e historial completo

**Fecha de la auditoría:** 1 de noviembre de 2026
**Alcance:** 120 commits alcanzables, 7 referencias (`main`, `develop`,
`rediseno-ui` y sus remotas), 158 ficheros versionados.

> **Ningún valor aparece en este documento.** Donde haría falta citar un
> secreto se escribe `<TAPADO>`. Las comprobaciones se hicieron con
> `--name-only`, recuentos y hashes SHA-256 truncados, nunca con `-p` ni
> imprimiendo contenido.

---

## Veredicto

**No hay ningún secreto real en el repositorio ni en su historial.**

No se ha commiteado nunca una cuenta de servicio, una clave privada, un
token de proveedor ni una clave de cifrado. Las cinco coincidencias de
patrón que aparecen son, todas, configuración pública o marcadores de
ejemplo, y cada descarte está justificado abajo.

---

## 1. Ficheros sensibles que hayan existido alguna vez

Buscados con `git log --all --diff-filter=A --name-only` sobre `.env`,
`.env.local`, `.env.server`, `.env.*.local`, `.env.staging`,
`*service-account*`, `*serviceAccount*`, `*service_account*`, `*adminsdk*`,
`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.cert`, `data/**`, `backups/*`,
`*.tar.gz`, `*.enc`, `*credential*`.

**Resultado: ninguna coincidencia.**

Comprobación inversa — todos los paths que han existido en cualquier commit,
filtrados por nombre sensible:

```
.env.development
.env.example
.env.production
.env.server.example
```

Los cuatro esperados, y nada más. Nunca ha habido en el repositorio un
`data/`, un `backups/`, un `.pem` ni una cuenta de servicio.

---

## 2. Patrones de clave en el contenido de cualquier commit

Buscados con `git log --all -G"<regex>"` (sin `-p`).

| Patrón | Commits |
|---|---|
| Anthropic (prefijo + 20 o más) | 1 |
| Groq (prefijo + 20 o más) | 1 |
| Google `A·I·z·a` + 35 | 4 |
| `BEGIN PRIVATE KEY` | 1 |
| OpenAI `sk-proj-` | — |
| GitHub PAT (clásico y fino) | — |
| AWS `A·K·I·A` + 16 | — |
| Clave de cifrado de 64 hex | — |
| Webhook de Slack o Discord | — |
| Stripe `sk_live_` | — |
| JWT largo | — |

### Clasificación de cada coincidencia

| commit(s) | fecha | ruta | línea | tipo | long. | veredicto |
|---|---|---|---|---|---|---|
| `1fd56e1`, `6def69d` | 2026-06-18 | `src/auth/auth.js` | 16 | Clave cliente de Google | 39 | **pública por diseño** |
| `4bc0bdb`, `d84fcc9`, `69eba80`, HEAD | 2026-08-11 | `.env.development` | 5 | Clave cliente de Google | 39 | **pública por diseño** |
| `4bc0bdb`, `d84fcc9`, `69eba80`, HEAD | 2026-08-11 | `.env.production` | 6 | Clave cliente de Google | 39 | **pública por diseño** |
| `4bc0bdb`, `69eba80` | 2026-08-11 | `SETUP.md` | 28 | Clave cliente de Google | 39 | **pública por diseño** |
| `4bc0bdb`, `d84fcc9`, `6def69d`, `69eba80`, HEAD | 2026-08-11 | `landing.js` | 7 / 9 | Clave cliente de Google | 39 | **pública por diseño** |
| `69eba80` | 2026-09-17 | `.env.server.example` | 33 | Cabecera `BEGIN PRIVATE KEY` | 27 | **placeholder** |
| `1fd56e1` … HEAD (5 commits) | 2026-06-18 | `Iniciar Finova.bat` | 24 | Groq | 36 | **placeholder** |
| `1fd56e1` … HEAD (5 commits) | 2026-06-18 | `Iniciar Finova.bat` | 28 | Anthropic | 37 | **placeholder** |

### Por qué se descarta cada una

**La clave `A·I·z·a` (39 caracteres) es UNA sola, en 5 sitios.** Verificado
comparando SHA-256 de los valores: una única huella (`98f36bee…`) en
`.env.production`, `.env.development`, `landing.js`,
`1fd56e1:src/auth/auth.js` y `4bc0bdb:SETUP.md`. En `.env.production` está
declarada como `VITE_FIREBASE_API_KEY`.

Es la **clave cliente de Firebase**, pública por diseño: va en el bundle de
cualquier aplicación web y cualquiera puede leerla con el inspector del
navegador. La seguridad la dan las reglas de Firebase y la lista de dominios
autorizados, no el secreto de la clave. El propio `SECURITY.md` del proyecto
ya tiene una sección explicando esto («¿Por qué las Firebase client keys son
seguras en el código?»).

Dato útil: en `HEAD` ya **no** está en `src/auth/auth.js` — el valor
incrustado como respaldo se retiró en algún momento y ahora solo vive en los
`.env` y en `landing.js`.

**`.env.server.example:33` — solo la cabecera, sin clave.** La línea es
`FIREBASE_PRIVATE_KEY=-----BEGIN ... <TAPADO>`. Comprobado sobre el fichero:
tiene las marcas `BEGIN` y `END PRIVATE KEY`, pero **no contiene ningún
base64 de 40 caracteres o más** en todo el fichero. Es la plantilla vacía que
debe estar en un `.example`.

**`Iniciar Finova.bat:24` y `:28` — líneas comentadas con relleno.** Son
líneas `REM` (comentario de lote de Windows) con el formato de la variable y
un valor de relleno. El clasificador las descartó por tres señales
independientes: línea comentada, relleno de `x`, y **solo 4 caracteres
distintos** en el valor — nadie genera una clave así.

---

## 3. Barrido genérico, sin depender de prefijos conocidos

Los patrones de arriba solo encuentran claves de proveedores con prefijo
reconocible. Un secreto propio (una clave de cifrado, una contraseña, un
webhook) no casaría con ninguno, así que se hizo un segundo barrido: **toda
asignación a una variable cuyo nombre acabe en `KEY`, `SECRET`, `TOKEN`,
`PASSWORD`, `PASSWD`, `CREDENTIAL`, `WEBHOOK`, `SALT` o `SEED` con un valor
de 16 caracteres o más**, en cualquier commit.

5 commits coincidían, en 10 ficheros. Clasificados:

| ruta | variable | veredicto | por qué |
|---|---|---|---|
| `.env.development` / `.env.production` | `VITE_FIREBASE_API_KEY` | pública por diseño | la clave cliente de arriba |
| `Iniciar Finova.bat` | `FINOVA_GROQ_KEY`, `FINOVA_CLAUDE_KEY` | no es un secreto | líneas comentadas |
| `server.cjs`, `server.js` | `FINOVA_AI_KEY`, `FINOVA_GROQ_KEY`, `GC_SECRET_ID`, `GC_SECRET_KEY`, `FEEDBACK_WEBHOOK_URL`, `HEALTH_DEEP_SECRET` | no es un secreto | el «valor» es `process.env.X`, una referencia al entorno, no un literal |
| `src/core/script.js`, `src/core/storage.js` | `HISTORY_KEY` | no es un secreto | nombre de una clave de `localStorage` |
| `src/core/monitoring.js` | `OPT_OUT_KEY` | no es un secreto | nombre de una clave de `localStorage` |

**Ninguna asignación con un valor literal de aspecto real.** Todo el consumo
de secretos del servidor va por `process.env`, que es como debe ser.

---

## 4. Los `.env` versionados a propósito

`.env.development` (39 líneas) y `.env.production` (40 líneas). Comprobados
sin imprimir valores: **las 13 variables de cada uno empiezan por `VITE_`.**

```
VITE_ANALYTICS_ID          VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_ANALYTICS_SRC         VITE_FIREBASE_PROJECT_ID
VITE_APP_ENV               VITE_FIREBASE_STORAGE_BUCKET
VITE_APP_URL               VITE_RELEASE
VITE_FIREBASE_API_KEY      VITE_SENTRY_DSN
VITE_FIREBASE_APP_ID       VITE_SERVER_URL
VITE_FIREBASE_AUTH_DOMAIN
```

Cero variables `FINOVA_*`, `FIREBASE_PRIVATE_KEY`, `*_SECRET` o `*_TOKEN`.
El prefijo `VITE_` es significativo: Vite solo expone al navegador las
variables con ese prefijo, así que por construcción **nada de estos ficheros
es secreto** — todo acaba en el bundle de todas formas. El DSN de Sentry
también es público por diseño (solo permite enviar eventos, no leerlos).

---

## 5. Lo que esta auditoría NO puede afirmar

**Solo cubre lo que hay en esta copia local.** Si alguna vez existió una rama
o un commit que ya no es alcanzable desde ninguna referencia local, no
aparece aquí. En particular:

- **Commits colgantes** (`git reflog`, objetos sin referencia) no se han
  barrido. Un `git commit` con un secreto seguido de `git reset --hard`
  deja el objeto en el repositorio local hasta que pase el recolector, y
  **si ese commit llegó a GitHub, sigue accesible por su hash** aunque no
  esté en ninguna rama.
- **Forks y clones.** Si alguien clonó el repositorio en algún momento,
  tiene su propia copia del historial.
- **Pull requests cerrados.** GitHub conserva los commits de un PR aunque la
  rama se borre.

Si el repositorio ha sido público en algún momento, lo anterior importa. Si
siempre ha sido privado y solo tú lo has clonado, el riesgo es
prácticamente nulo — y de todas formas **no se ha encontrado ningún secreto
que rotar**.

**No se ha consultado la API de GitHub.** El estado de secret scanning, push
protection y protección de rama no se puede comprobar desde aquí: queda como
guía manual en [ROTATE_SECRETS.md](ROTATE_SECRETS.md).
