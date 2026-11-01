# Rotación de secretos

Documento de referencia. **No ejecuta nada** y no contiene ningún valor.

Estado a 1 de noviembre de 2026: la auditoría de
[SECRETS_AUDIT.md](SECRETS_AUDIT.md) **no encontró ningún secreto
commiteado**, así que ahora mismo no hay nada que rotar por filtración. Esto
es la guía para cuando haga falta: una filtración, la salida de alguien del
equipo, o la rotación periódica que conviene hacer de todas formas.

---

## Orden de rotación, si hubiera una filtración

Si alguna vez hay que rotar todo, el orden importa:

1. **Cuenta de servicio de Firebase** — da acceso administrativo a los
   usuarios. Es la más grave.
2. **`FINOVA_PROXY_SECRET`** — abre la API entera.
3. **Claves de proveedores de IA** — coste económico directo.
4. **Credenciales de GoCardless** — acceso a datos bancarios.
5. **`HEALTH_DEEP_SECRET`** y **`FEEDBACK_WEBHOOK_URL`** — impacto menor.
6. **`FINOVA_ENC_KEY`** — **la última, y solo con un plan de migración.**
   Ver la advertencia al final.

---

## Cuenta de servicio de Firebase

Variables: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`.

**Dónde se crea.** Consola de Firebase → el proyecto → configuración del
proyecto → pestaña de cuentas de servicio → generar nueva clave privada.
Descarga un JSON. *No estoy seguro de los nombres exactos de los menús en la
versión actual de la consola: verifícalos al entrar.*

**Dónde se usa.** `server.cjs`, con `firebase-admin`: verificación de tokens
con comprobación de revocación, `revokeRefreshTokens` y `deleteUser` en el
borrado de cuenta. Si no está configurada, el servidor avisa
(«Firebase Admin no configurado — verificación JWT propia sin revocación») y
sigue funcionando con verificación local, sin revocación.

**Cómo rotarla.**
1. Genera la clave nueva (la vieja sigue válida: pueden coexistir).
2. Carga las tres variables en Railway. `FIREBASE_PRIVATE_KEY` lleva saltos
   de línea: Railway acepta el valor con `\n` literales, y el código lo
   normaliza.
3. Reinicia y comprueba que el aviso de arriba **no** aparece en los logs.
4. Solo entonces, borra la clave antigua en la consola de Firebase.

**Qué se rompe al rotar.** Nada, si se hace en ese orden. Si se borra la
vieja antes de cargar la nueva: se pierde la revocación de tokens y el
borrado de cuenta en servidor hasta que se arregle. Los usuarios **no**
pierden la sesión.

**No descargues el JSON al directorio del proyecto.** `.gitignore` cubre
`firebase-service-account.json`, `*service-account*.json`,
`*firebase-adminsdk*.json`, `serviceAccount*.json` y
`google-credentials*.json`, y el hook de pre-commit lo bloquea aunque uses
`git add -f`. Pero lo seguro es no tenerlo nunca en el directorio.

---

## `FINOVA_PROXY_SECRET`

**Dónde se crea.** Lo generas tú: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

**Dónde se usa.** `server.cjs` lo exige en las peticiones que llegan a través
del proxy de Vercel (`api/[...path].js`). Es lo que impide que alguien llame
al servidor de Railway directamente, saltándose el proxy.

**Cómo rotarlo.** Cárgalo en Railway **y** en Vercel al mismo tiempo. Las dos
partes tienen que coincidir.

**Qué se rompe.** Mientras no coincidan, **la API entera devuelve 403**. Es
el que menos margen tiene: cámbialo en los dos sitios en la misma ventana.
Nota de la auditoría anterior: `/api/health` responde **antes** de esta
comprobación, a propósito, para que los monitores externos sigan viendo el
servidor.

---

## Claves de proveedores de IA

Variables: `FINOVA_GROQ_KEY`, `FINOVA_CLAUDE_KEY`.

**Dónde se crean.** En la consola de cada proveedor (Groq Cloud, Anthropic).
*No doy nombres de menú: cambian a menudo.*

**Dónde se usan.** `server.cjs` las lee para el Asesor IA **del servidor**,
el que funciona sin que el usuario ponga su propia clave. Si no están, el
servidor avisa («Sin FINOVA_GROQ_KEY ni FINOVA_CLAUDE_KEY — IA del servidor
no disponible») y el Asesor IA solo funciona para quien haya puesto su clave
en los ajustes de la app.

**Cómo rotarlas.** Crea la nueva, cárgala en Railway, reinicia, comprueba
`/api/ai-status`, y revoca la vieja.

**Qué se rompe.** El Asesor IA del servidor, hasta que se cargue la nueva.
Los usuarios con su propia clave no se enteran.

**Las claves de los usuarios son otra cosa y no se rotan desde aquí.** Viven
en el `localStorage` del navegador de cada uno (`claudeApiKey`,
`openaiApiKey`, `geminiApiKey`, `groqApiKey` en `APP`). Si sospechas una
filtración del lado del cliente, el aviso tiene que ir a los usuarios: solo
ellos pueden rotarlas.

---

## Credenciales de GoCardless (banca abierta)

Variables: `FINOVA_GC_SECRET_ID`, `FINOVA_GC_SECRET_KEY`.

**Dónde se crean.** Panel de GoCardless Bank Account Data.

**Dónde se usan.** `server.cjs`, en los endpoints de conexión bancaria
(`src/utils/bank-connect.js` en el cliente). Los identificadores de las
solicitudes se guardan en `data/bank_requisitions.json`.

**Cómo rotarlas.** Crea el par nuevo en el panel, cárgalo, reinicia.

**Qué se rompe.** Las **solicitudes ya creadas** pueden quedar inutilizables:
los usuarios con una conexión bancaria activa tendrían que volver a
autorizarla. Compruébalo con una cuenta de prueba antes de rotar en
producción.

---

## `HEALTH_DEEP_SECRET` y `FEEDBACK_WEBHOOK_URL`

**`HEALTH_DEEP_SECRET`**: lo generas tú; protege `/api/health/deep`, que
expone estado interno. Rotarlo solo rompe el monitor que lo use (hay que
actualizar la URL en UptimeRobot o equivalente).

**`FEEDBACK_WEBHOOK_URL`**: la da el servicio de destino (Slack, Discord, un
endpoint propio). **La URL ES el secreto**: quien la tenga puede publicar en
ese canal. Para rotarla, borra el webhook viejo en el servicio y crea uno
nuevo. Mientras no esté configurada, el feedback solo se guarda en disco —
y en Railway el disco es **efímero** sin volumen declarado, así que se
perdería en el siguiente despliegue.

---

## `FINOVA_ENC_KEY` — leer esto antes de tocarla

**Dónde se crea.** La generas tú:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
(64 caracteres hexadecimales = 32 bytes).

**Dónde se usa.** `server.cjs` líneas 1920–1945. Cifra con **AES-256-GCM**
el JSON de cada usuario en `data/users/*.json`.

### El problema: no hay identificador de clave en el sobre

El formato guardado es:

```
enc1:<base64 de  iv(12) + tag(16) + datos cifrados >
```

`enc1` es la versión del **formato**, no de la **clave**. No hay ningún campo
que diga con qué clave se cifró cada fichero.

**Consecuencia directa: si cambias `FINOVA_ENC_KEY` sin migrar, todos los
ficheros ya cifrados quedan ilegibles para siempre.** No es una degradación
suave: GCM verifica la etiqueta de autenticación, así que `_decryptUserData`
**lanza una excepción** con la clave equivocada. Y como no hay identificador
de clave, el servidor no puede ni detectar que el problema es ese.

Para los usuarios significa perder sus datos del servidor. Los datos locales
de su navegador siguen ahí (Finova es local-first), así que la recuperación
pasaría por que cada uno vuelva a subir desde su dispositivo — pero eso
depende de que no hayan limpiado el navegador.

### Cómo rotarla de verdad

No se puede hacer solo cambiando la variable. Hace falta migrar:

1. **Copia de seguridad de `data/users/` antes de nada.** En Railway, sin
   volumen declarado el disco es efímero: comprueba primero si hay volumen.
2. Escribe un script que, **con las dos claves cargadas**, lea cada fichero,
   lo descifre con la vieja y lo vuelva a escribir con la nueva.
3. Ejecútalo con el servidor **parado**, o con un bloqueo: si un usuario
   guarda a mitad de la migración, su fichero puede quedar escrito con la
   clave vieja después de haber sido migrado.
4. Verifica leyendo unos cuantos ficheros con solo la clave nueva cargada.
5. Solo entonces, retira la clave vieja.

### Mejora recomendada, para que esto no vuelva a doler

Añadir el identificador de clave al sobre: `enc2:<kid>:<base64…>`, con
`_decryptUserData` eligiendo la clave por `kid` y aceptando `enc1:` como la
clave antigua. Con eso la rotación pasa a ser gradual y sin parada: los
ficheros se van migrando al guardarse. **No está implementado.**

### Y un caso que conviene conocer

Si `FINOVA_ENC_KEY` **no** está configurada, `_encryptUserData` devuelve el
texto tal cual: los datos se guardan **en claro**. Y `_decryptUserData` pasa
de largo cualquier cosa que no empiece por `enc1:`, así que funciona igual.
Es una degradación deliberada y razonable, pero significa que `data/users/`
puede tener una mezcla de ficheros cifrados y en claro según cuándo se
escribieron. Un script de migración tiene que contemplarlo.

---

## Lo que tienes que activar tú en GitHub

No puedo comprobar ni cambiar nada de esto desde aquí: no he consultado la
API de GitHub. **No doy nombres exactos de menú donde no estoy seguro** —
la interfaz de GitHub cambia a menudo. La ruta general es
**Settings → Code security** (en algunas versiones aparece como
«Code security and analysis»).

### 1. Secret scanning y push protection

Busca **Secret scanning** y, dentro, **Push protection**. Lo primero avisa de
secretos ya subidos; lo segundo **bloquea el push** antes de que entren.

**Verifica si tu plan lo permite en un repositorio privado.** Durante mucho
tiempo fue exclusivo de GitHub Advanced Security (plan de pago) para repos
privados, y gratuito solo en públicos. GitHub ha ido ampliando la
disponibilidad gratuita, así que **no afirmo cuál es la situación hoy**:
entra y mira si la opción aparece activable o te pide una licencia.

Si no está disponible, el hook de pre-commit de este repositorio cubre el
caso local — pero solo el local: no protege de un push hecho desde otra
máquina o desde la web de GitHub.

### 2. Alertas de Dependabot

En la misma pantalla, **Dependabot alerts**. Actívalo, y también
**Dependabot security updates** si está. El proyecto tiene `firebase-admin`,
`@sentry/*` y `sharp`, que arrastran bastantes dependencias transitivas.

### 3. Protección de la rama `main`

**Settings → Branches**, regla para `main`. Lo que de verdad aporta aquí:

- Exigir un pull request antes de fusionar.
- **Prohibir el force push** — esto es lo importante: evita que un
  historial reescrito borre el rastro de algo.
- Prohibir el borrado de la rama.
- Exigir que las comprobaciones pasen (cuando haya CI).

Ten en cuenta que trabajas en `rediseno-ui`, no en `main`. Si proteges
`main` con «exigir pull request», la fusión final tendrá que ir por PR.

### 4. Si el repositorio ha sido público alguna vez

Entonces hay que asumir que **todo el historial ha sido leído por
rastreadores automáticos**, aunque ahora sea privado. En ese caso rota por
precaución, aunque esta auditoría no haya encontrado nada: el coste de rotar
es bajo y el de equivocarse no.

---

## Si algún día hay que limpiar el historial

**No hace falta ahora**, y no lo he hecho. Si en el futuro se cuela un
secreto de verdad, las opciones son:

| Opción | Cómo | Riesgo |
|---|---|---|
| **No limpiar, solo rotar** | Rotar el secreto y seguir | El valor viejo queda en el historial para siempre, pero ya no sirve para nada. **Es casi siempre la respuesta correcta.** |
| `git filter-repo` | Reescribe el historial quitando el fichero o la cadena | Cambia TODOS los hashes posteriores. Obliga a force push y a que todos los clones se rehagan. Los PR y los commits referenciados por hash quedan roto |
| Repositorio nuevo | Empezar de cero con un commit limpio | Se pierden historial, issues y PR |

**Rotar siempre es obligatorio; limpiar el historial casi nunca lo es.** Un
secreto que estuvo en un repositorio hay que darlo por comprometido
independientemente de que se borre después: puede estar en un clon, en un
fork, en la caché de GitHub o en el índice de un rastreador. Reescribir el
historial da una falsa sensación de seguridad y cuesta mucho.

Si decides reescribir, **pídemelo explícitamente**: no voy a tocar el
historial, hacer force push ni borrar ramas por iniciativa propia.
