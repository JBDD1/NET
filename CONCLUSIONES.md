# Conclusiones — cierre de auditoría de seguridad y calidad · Finova

**Fecha:** 3 de noviembre de 2026
**Naturaleza de esta sesión:** cierre. **No se corrigió nada**; solo se verificó,
con pruebas reales ejecutadas aquí, qué quedó resuelto de las últimas rondas y
qué sigue pendiente. Cada conclusión lleva su evidencia (salida de comando, test,
o `archivo:línea`). Lo que depende de producción/Firebase/navegador se marca como
**no verificable desde aquí** en vez de darlo por bueno o por malo.

Documentos de partida leídos: AUDIT_PROGRESS.md, PENTEST_API.md, PENTEST_AUTH.md,
PENTEST_CLIENT.md, FISCAL_AUDIT.md, SECRETS_AUDIT.md, SECURITY.md, DEPLOY.md,
ROTATE_SECRETS.md. No se repitieron las auditorías; se verificaron sus conclusiones.

---

## Resuelto y verificado

Todo lo de esta sección lo comprobé yo en esta sesión con una prueba real.

1. **Ficheros estáticos del servidor — blindados.** `node --test
   tests/static-guard.test.cjs` → **52/52 pass**. En modo producción «no se sirve
   ningún estático», «las rutas sensibles siguen denegadas» (`/data/users/*.json`,
   `/server.cjs`, `/.git/config`, `/.env.production`, rutas con `../` y
   codificadas → 404), y el toggle `SERVE_STATIC=false` apaga los estáticos
   incluso fuera de producción.

2. **Build reproducible y limpio.** `npm run build` → `✓ built`, y
   `scripts/verify-dist.cjs` → **«dist/ es desplegable»** (81 ficheros, 7 HTML, 45
   .js). Existe `dist/src/` con el JS **minificado** (p. ej. `dist/src/auth/
   auth-shared.js`: una sola línea, 5305 bytes). **0** `console.log/debug/info` en
   todo `dist/` (quedan 7 `console.error/warn`, legítimos). verify-dist exige
   `drop_console` en modo producción.

3. **Servidor listo para producción.** `PORT = Number(process.env.PORT) || 3000`
   ([server.cjs:41](server.cjs#L41)); `GET /api/health`
   ([server.cjs:4187](server.cjs#L4187)) y `/api/health/deep`
   ([4299](server.cjs#L4299)); apagado ordenado `process.on('SIGTERM', …
   _gracefulShutdown)` ([4529](server.cjs#L4529)) + SIGINT + uncaughtException +
   unhandledRejection; `DATA_DIR` configurable
   (`process.env.DATA_DIR ? path.resolve(...) : …`, [server.cjs:92](server.cjs#L92)).

4. **No hay guardado en claro silencioso ni fuga de errores.**
   - Arranqué de verdad `NODE_ENV=production … node server.cjs` **sin
     FINOVA_ENC_KEY**: el proceso **aborta el arranque** avisando que guardaría en
     claro y exigiendo `ALLOW_PLAINTEXT_DATA=true` para forzarlo. No sigue en claro
     por su cuenta.
   - `e.message`/`err.message` dentro de `res.end`/`JSON.stringify`: **0 reales**.
     La única coincidencia es un **comentario** que documenta que se quitó
     ([server.cjs:3924](server.cjs#L3924)). El `report.errors` del borrado de
     cuenta va a `console.error` del servidor ([3206](server.cjs#L3206)); el
     cliente recibe un mensaje **fijo** ([3210](server.cjs#L3210)).

5. **Fiscalidad correcta y honesta.** `irpf.test.js` → **49/49 pass**.
   `calcCuota(300000, escala del ahorro 2026)` = **71880** (ejecutado contra la
   escala real del código, `_AHORRO_2025` reutilizada para 2026,
   [fiscal.js:67,147](src/sections/fiscal.js#L67)). La UI muestra **«Estimación
   orientativa · ejercicio ${year}»** ([fiscal.js:293](src/sections/fiscal.js#L293)),
   **«no sustituye a Renta WEB ni a un asesor fiscal»** ([312](src/sections/fiscal.js#L312))
   y un aviso explícito cuando el ejercicio no tiene tablas propias
   ([317-319](src/sections/fiscal.js#L317)).

6. **Secretos fuera del repo y hook que bloquea.** `git ls-files | grep -E
   "service-account|\.env$|\.pem$"` → **vacío (0)**. `.gitignore` cubre
   `firebase-service-account.json`, `*service-account*.json`, `*.pem` y variantes
   de `.env`. Prueba real del hook: creé un `firebase-service-account.json` falso,
   lo preparé con `git add -f` y ejecuté `node scripts/check-secrets.cjs` →
   **COMMIT BLOQUEADO, exit 1**, y **no imprime el valor** del secreto. Fichero de
   prueba eliminado después.

7. **Recuento de hallazgos de los tres pentests** (sin repetir ataques):

   | Informe | Corregidos | Pendientes |
   |---|---|---|
   | PENTEST_API | 3 (2 Baja + 1 Informativa) | 0 |
   | PENTEST_AUTH | 1 (Baja) | 1 (Informativa) |
   | PENTEST_CLIENT | 0 | 3 (1 Media/Alta + 2 Baja) |
   | **Total** | **4** | **4** |

8. **Suite completa en verde** (evidencia de esta sesión): `npm test` → **992
   pass**, 23 skipped, 32 suites, 0 fail. `npm run test:security` → **115 pass**,
   0 fail. Incluye `account-delete.test.js`, `account-delete-client.test.js` y
   `feedback.test.js`.

9. **Del punto 8 (fuera de rondas), lo que SÍ tiene evidencia aquí:**
   - **Verificación de email:** código presente —
     `cred.user.sendEmailVerification(...)`
     ([auth.js:415](src/auth/auth.js#L415)) y la app lee
     `user.emailVerified` ([auth.js:91,114](src/auth/auth.js#L114)).
   - **Borrado de cuenta:** `_deleteAccountData` ([server.cjs:2943](server.cjs#L2943))
     + 2 ficheros de test en verde.
   - **Feedback / FAQ:** `handleFeedback` ([server.cjs:3437](server.cjs#L3437)),
     ruta `/api/feedback`, `feedback.test.js` en verde, `faq.html` + `src/data/faq.js`
     presentes.
   - **Monitorización:** Sentry integrado en servidor
     ([server.cjs:566](server.cjs#L566)) y cliente (`src/core/monitoring.js`);
     Umami en la CSP.
   - **Logo / iconos:** set completo (`icon-16…1024.png` + `icon.svg`), referenciado
     en `manifest.json`.
   - **Reglas de Firebase:** **no hay** `firestore.rules`, `database.rules.json` ni
     `firebase.json` — **porque la app no usa Firestore/RTDB**: los datos viven en
     el servidor propio (`DATA_DIR`) y Firebase solo se usa para Auth. No es un
     olvido; no aplica.

---

## Pendiente

Con el motivo de cada uno.

- **[PENTEST_CLIENT H1 · Media/Alta] CSP servida vs 120 `onclick=` en línea.** *No
  se puede verificar en este entorno* (no hay navegador): la CSP sin
  `'unsafe-inline'` bloquearía los manejadores en línea, incluido el login
  (`_submitLogin`, sin `addEventListener` de respaldo). Reportado **sin tocar** a
  propósito (las dos correcciones son arriesgadas a ciegas). Ver «No verificable».

- **[PENTEST_CLIENT H2 · Baja] CSP duplicada** en `server.cjs` (`_CSP`,
  [L583](server.cjs#L583)) y `vercel.json` ([L16](vercel.json#L16)); ya difieren en
  `connect-src`. *Prompt de unificación no ejecutado.*

- **[PENTEST_CLIENT H3 · Baja] Scripts de CDN sin SRI** (`chart.js@4.4.0`,
  `firebase 10.12.0`, anclados pero sin `integrity=`). *No ejecutado* (requiere
  calcular y verificar hashes en navegador).

- **[PENTEST_AUTH H2 · Informativa] Códigos de sync legados sin dueño registrado.**
  *Se dejó sin tocar por compatibilidad* (invalidarlos rompe a quien ya los usa);
  mitigado por entropía de 48 bits.

- **[NUEVO en esta auditoría · a decidir] Los backups de sync se guardan EN CLARO
  en el servidor.** El cliente sube `JSON.stringify(exportable)` sin cifrar
  ([script.js:3307](src/core/script.js#L3307)) y el servidor lo escribe tal cual,
  `_writeFileAtomic(destinoSync, data)` **sin** `_encryptUserData`
  ([handleSyncUpload, server.cjs:2751](server.cjs#L2751)) — a diferencia de
  user-data, que sí se cifra ([2558](server.cjs#L2558)). El propio código lo
  reconoce en comentarios ([2790](server.cjs#L2790), [2873](server.cjs#L2873)).
  *Encontrado roto, no tocado* (regla de esta sesión).

- **Páginas legales duplicadas.** Siguen existiendo las dos parejas:
  `privacidad.html` (43 KB) + `privacy.html` (14 KB), y `terminos.html` +
  `terms.html`. *Prompt de unificación no ejecutado.*

- **URL provisional `jbdd1.github.io`.** 22 apariciones en `faq.html`,
  `index.html`, `landing.html`, `server.cjs` y `vercel.json`. *Dominio propio no
  comprado todavía* (coincide con la nota de memoria).

- **`npm audit`: 26 vulnerabilidades (4 bajas, 22 moderadas).** Todas en
  herramientas de **build/test/servidor** (minimatch/glob/deepmerge vía
  `@sentry/bundler-plugins`, `jest`, `firebase-admin`); **ninguna llega al
  navegador**. *Pendiente de una tarea de mantenimiento* (`npm audit fix --force`
  es *breaking*, no se ejecutó).

- **Icono `icon-64` con diseño distinto al resto** (flagged en AUDIT_PROGRESS). *No
  verificable aquí* (es visual); decisión de diseño pendiente.

---

## No verificable desde aquí

Depende de producción, Firebase real o un navegador. Para cada uno, el comando o
acción exacta que **tú** debes ejecutar:

- **CSP vs login en el navegador (CLIENT H1).** Abre la app **servida con su CSP**
  (producción / Vercel / `server.cjs`, **no** `npm run dev`, que no manda la
  cabecera), abre la consola de DevTools y pulsa «Iniciar sesión». Busca
  `Refused to execute inline event handler because it violates … Content Security
  Policy`. Si aparece, el login por email/contraseña y la mayoría de botones están
  rotos en producción (Google sí funcionaría).

- **Flujo de verificación de email.** Necesita un proyecto Firebase real. Regístrate
  con un email real en la app desplegada y comprueba que (a) llega el correo de
  verificación y (b) la app aplica el bloqueo de `emailVerified` donde debe.

- **Borrado de cuenta en el lado de Firebase Auth.** `revokeRefreshTokens` /
  `deleteUser` solo corren con el Admin SDK. Despliega con
  `GOOGLE_APPLICATION_CREDENTIALS` apuntando a la service account y borra una cuenta
  de prueba; confirma que desaparece de Firebase Auth.

- **Revocación de tokens (AUTH).** Igual: necesita Admin SDK real para medir que
  `verifyIdToken(token, true)` rechaza un token revocado.

- **IDOR positivo con tokens reales (API/AUTH).** Emite dos tokens legítimos de
  Firebase (usuario A y B) y prueba que B no puede leer datos de A con un `?uid=`
  distinto. Aquí solo se verificó por lectura del código y por rechazo de tokens
  falsos.

- **Monitorización recibiendo eventos.** Despliega con el DSN de Sentry y el
  `ANALYTICS_ORIGIN` de Umami y confirma que un error de prueba y una visita
  aparecen en sus paneles.

- **Disco efímero / volumen de `DATA_DIR`.** El servidor avisa de que `DATA_DIR`
  dentro del proyecto es efímero. En el hosting real, confirma que hay un volumen
  persistente montado y que `DATA_DIR` apunta a él (si no, los datos de usuario se
  pierden en cada despliegue).

---

## Riesgo si se lanza hoy tal cual

De más a menos grave, honestamente:

1. **La app podría estar rota en producción por la CSP (CLIENT H1).** Si la CSP se
   aplica tal como se sirve, el login por email/contraseña y la mayoría de botones
   `onclick=` **no responden**; solo funcionaría el acceso con Google. Es lo más
   grave **porque está sin confirmar** y afecta al uso básico. Una comprobación de
   2 minutos en el navegador lo resuelve en un sentido o en otro.

2. **Los backups de sync quedan en claro en el disco del servidor.** Si el volumen/
   `DATA_DIR` se expone (hosting mal configurado, una copia filtrada, un backup del
   disco), esos ficheros revelan la economía completa de un usuario **en texto
   plano** — mientras que user-data sí estaría cifrado. Mitigado por códigos de 48
   bits atados al uid (en los nuevos), pero es una asimetría real de cifrado en
   reposo.

3. **Códigos de sync legados sin dueño (AUTH H2).** Un autenticado que conociera o
   adivinara un código previo al registro de propiedad podría descargarlo. Riesgo
   bajo (48 bits + 10 intentos/min hacen inviable la fuerza bruta).

4. **Dos políticas de privacidad y dos de términos en paralelo.** No es una brecha
   de seguridad, pero sí un riesgo legal/de coherencia: dos documentos que pueden
   contradecirse y ambos publicados.

5. **Operativo/imagen:** URL provisional `jbdd1.github.io` en producción, scripts de
   CDN sin SRI, y pérdida de datos si el volumen persistente no está montado. Bajos,
   pero conviene cerrarlos antes de un lanzamiento público.

Nota: los controles de fondo (control de acceso por token, cifrado en reposo de
user-data, rate limiting, bloqueo de cuenta, no-XSS, estáticos bloqueados, arranque
que aborta sin clave) **están verificados y aguantan**. El riesgo de hoy no está en
el núcleo del servidor, sino en la capa cliente (H1) y en un par de asimetrías.

---

## Siguiente paso recomendado

**Haz la comprobación de 2 minutos de la CSP en el navegador (riesgo #1).** Abre la
build de producción servida con su CSP, consola de DevTools, pulsa «Iniciar sesión»
y mira si salta la violación de CSP. Es lo único que decide si la app **funciona o
no** en producción; todo lo demás es de severidad menor o ya está verificado. Si se
confirma el bloqueo, el arreglo correcto es migrar los manejadores a
`addEventListener`/`data-action` (empezando por el login), **no** añadir
`'unsafe-inline'` a la CSP.
