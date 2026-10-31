# Feedback — configuración manual

El botón de feedback y la FAQ ya funcionan sin tocar nada: el mensaje se guarda
en `data/feedback.jsonl` y se puede leer desde **Admin → Feedback de usuarios**.

Pero hay un problema que conviene resolver antes del lanzamiento.

---

## ⚠️ Lo primero: el disco del servidor es efímero

**El fichero no es un sitio fiable para guardar el feedback en tu hosting
actual.**

No hay ningún `railway.json` ni volumen declarado en el repositorio, y
`data/` está en `.gitignore`. Sin un volumen montado, Railway da al contenedor
un disco **efímero**: se borra en cada despliegue y en cada reinicio del
contenedor. El servidor te lo avisa al arrancar:

```
[FINOVA/Feedback] Disco efímero (sin volumen declarado): data/feedback.jsonl
se perderá al redesplegar. Configura FEEDBACK_WEBHOOK_URL como canal principal
```

Y el panel de admin muestra un aviso en rojo cuando detecta esa situación.

> **Nota honesta:** no he podido comprobar tu plan concreto de Railway ni si
> tienes un volumen añadido desde su interfaz (eso no se ve en el repositorio).
> La detección se basa en la variable `RAILWAY_VOLUME_MOUNT_PATH`, que Railway
> define cuando hay volumen. **Verifícalo en tu panel de Railway**: si ves un
> volumen montado, el fichero sí es fiable y puedes ignorar este apartado.

**Esto afecta también a lo que ya había**: `data/users/<uid>.json` (las copias
cifradas de los datos de los usuarios) vive en el mismo sitio. Es menos grave
porque la app es local-first y el navegador tiene la copia buena, pero conviene
que lo sepas.

### Las dos salidas

| | Qué hacer | Esfuerzo |
|---|---|---|
| **A. Webhook** (recomendada para empezar) | Apartado 1 de abajo. El feedback te llega a Discord o Telegram en el momento. | 10 minutos |
| **B. Volumen en Railway** | Añadir un volumen montado en `/app/data` desde el panel de Railway. | 5 minutos, puede tener coste |

Lo ideal es **las dos**: el webhook para enterarte al instante, y el volumen
para tener el histórico. Con el webhook configurado, el servidor responde
«recibido» aunque el disco falle, así que el mensaje del usuario nunca se
pierde por esto.

> **[VERIFICAR]** Si los volúmenes de Railway entran en su plan gratuito o
> tienen coste, y cuánto. Cambia con el tiempo: míralo en su panel de precios.

---

## 1. Webhook: que el feedback te llegue al momento

El servidor reenvía cada mensaje a `FEEDBACK_WEBHOOK_URL` si esa variable
existe. El mismo payload sirve para Discord, Slack, Make y Zapier, porque se
mandan los tres campos que cada uno espera (`content`, `text` y `feedback`).

Si el webhook falla, **no rompe nada**: se registra el fallo con
`console.error` y la petición del usuario sigue devolviendo éxito.

### Opción recomendada: Discord

Es la más rápida y no cuesta nada:

1. Crea un servidor de Discord para ti (o usa uno que ya tengas).
2. Crea un canal, por ejemplo `#finova-feedback`.
3. Ajustes del canal → **Integraciones** → **Webhooks** → *Nuevo webhook*.
4. Copia la URL del webhook. Tiene esta forma:
   `https://discord.com/api/webhooks/<id>/<token>`
5. En **Railway** → tu servicio → **Variables**, añade:
   ```
   FEEDBACK_WEBHOOK_URL=<la URL que acabas de copiar>
   ```
6. Vuelve a desplegar.

> Los nombres de los menús de Discord cambian de vez en cuando. Si no
> encuentras «Integraciones», dime qué ves y lo ajusto.

**La URL del webhook es un secreto**: cualquiera que la tenga puede publicar en
tu canal. Va en las variables de entorno de Railway, **nunca en el repositorio**.

### Alternativa: Telegram

Si prefieres recibirlo en el móvil, necesita un paso intermedio porque la API
de Telegram no acepta un POST con un JSON cualquiera: hace falta un servicio
como Make o un pequeño reenviador. Dímelo y lo monto.

### Cómo se ve lo que llega

Probado contra un servidor local que recibía los envíos. Esto es un mensaje
real tal y como llega al webhook:

```
**Algo no funciona**  ·  `a44d1c203fe4acc2`

El boton de guardar no responde en moviles

Responder a: a@b.es

`transactions · 1.0.0 · 375x700 · obsidian-brass / dark`
`Mozilla/5.0 Test`
Últimos errores:
· x is not a function @ script.js @ 42
```

Fíjate en lo que **no** hay: ni un importe, ni una transacción, ni un saldo, ni
el uid en claro.

---

## 2. Correo de aviso: NO está implementado

La variable `FEEDBACK_NOTIFY_EMAIL` se lee, pero **no envía nada**. No hay
ningún servicio de correo transaccional configurado en el proyecto, y simular
un envío que no ocurre sería peor que no tenerlo: creerías estar avisado y no
lo estarías.

El servidor te lo dice al arrancar si la pones:

```
[FINOVA/Feedback] FEEDBACK_NOTIFY_EMAIL está puesta pero NO hay servicio de
correo configurado: no se enviará ningún aviso
```

Si quieres avisos por correo, hay dos caminos:

1. **El webhook de Discord con notificaciones en el móvil** — gratis, y en la
   práctica cumple la misma función. Es lo que recomiendo.
2. **Montar un proveedor transaccional** (Resend, Brevo, Amazon SES…). Ya
   comparé sus costes en `AUTH_EMAIL_SETUP.md`, apartado 6, para los correos de
   verificación. Si acabas contratando uno para eso, reutilizarlo aquí es media
   hora de trabajo. Dímelo y lo conecto.

---

## 3. Variables de entorno — resumen

En **Railway** → tu servicio → **Variables**:

| Variable | ¿Obligatoria? | Para qué |
|---|---|---|
| `FEEDBACK_WEBHOOK_URL` | No, pero **muy recomendable** | Reenvía cada feedback a Discord/Slack/Make. Sin ella, solo queda el fichero (efímero) |
| `FEEDBACK_NOTIFY_EMAIL` | No | Reservada. Hoy no hace nada (ver apartado 2) |

Sin ninguna de las dos, el feedback sigue funcionando y guardándose en el
fichero. No hay nada que se rompa por no configurarlas.

---

## 4. Cómo leer el feedback

### Desde el panel de admin

**Admin → Feedback de usuarios.** Muestra los mensajes más recientes primero,
con filtro por tipo y un botón para marcarlos como leídos. Protegido con la
verificación de admin que ya existía (`_adminGuard` + `ADMIN_EMAILS`), así que
solo lo ve quien ya era administrador.

Los mensajes se pintan con `textContent`, nunca con `innerHTML`: el texto lo
escribe un desconocido, y con `innerHTML` un mensaje con etiquetas dentro se
ejecutaría en tu propio navegador.

### Desde el servidor, a mano

```bash
# Los 10 últimos, legibles
tail -10 data/feedback.jsonl | while read l; do echo "$l" | python -m json.tool; done

# Solo los fallos
grep '"type":"bug"' data/feedback.jsonl | wc -l
```

---

## 5. Qué se envía exactamente (y qué no)

Esto importa para la política de privacidad, y está fijado con tests que fallan
si alguien lo cambia.

**Siempre:** el tipo, el mensaje y cuánto tiempo estuvo abierto el formulario.

**Si el usuario lo pone:** su correo (precargado y editable) y una valoración de
1 a 5 (solo en el tipo «Otro»).

**Si deja marcada la casilla técnica** (marcada por defecto, desmarcable, con un
botón «Ver qué se envía» que muestra el JSON literal):

| Campo | Ejemplo |
|---|---|
| `version` / `build` | `1.0.0` / `finova-v27` |
| `section` | `transactions` (el nombre de la pantalla) |
| `theme` | `obsidian-brass / dark` |
| `ua`, `lang` | navegador y sistema, truncado a 300 caracteres |
| `screen`, `viewport`, `dpr` | `375x812`, `375x700`, `2` |
| `online`, `demo` | `true` / `false` |
| `errors` | los **últimos 5** errores: mensaje (200 caracteres), nombre del archivo y línea |

**Nunca, bajo ninguna circunstancia:** importes, transacciones, cartera,
saldos, objetivos, claves de API ni el uid en claro (se guarda un hash de 16
caracteres, que permite agrupar los mensajes de una persona sin saber quién es).

El servidor aplica **lista blanca** en los dos niveles: los campos del cuerpo y
los del informe técnico. Si mañana alguien añade un campo nuevo en el cliente
con datos dentro, el servidor lo descarta antes de llegar al disco.

El buffer de errores vive **en memoria, nunca en localStorage**: un error puede
arrastrar un fragmento de datos del usuario, y persistirlo sería guardar
información personal que nadie ha pedido guardar.

---

## 6. Antispam

- **Honeypot**: un campo invisible para personas. Si llega relleno, el mensaje
  se descarta y se responde **200** a propósito — decirle al bot que ha fallado
  solo le enseña a afinar el siguiente intento.
- **Tiempo mínimo** de 3 segundos entre abrir el formulario y enviar.
- **Límite**: 5 mensajes por hora por IP, y otros 5 por usuario. El segundo
  existe porque una IP compartida (una oficina, un operador móvil) no debe
  gastar el cupo de todos los que están detrás.

---

## 7. Lo que no he podido verificar

Soy honesto con esto:

1. **Tu plan de Railway y si tienes volumen.** No se ve en el repositorio.
   Compruébalo en su panel.
2. **El webhook contra Discord de verdad.** Lo probé contra un servidor local
   que recibía los envíos y comprobé el contenido exacto, pero no contra la API
   real de Discord: haría falta una URL de webhook tuya.
3. **El flujo de interfaz en un navegador.** No hay navegador en este entorno
   (sin Playwright ni Puppeteer). Lo recorrí en el código y lo cubrí con 27
   tests, pero nadie ha hecho clic: revisa a mano el modal en los 5 temas y a
   375 px, y que el foco vuelve al botón de origen al cerrar.
4. **La FAQ en `faq.html` se renderiza con JavaScript**, desde la misma fuente
   que la de dentro de la app (`src/data/faq.js`), que es lo que evita que las
   dos versiones acaben diciendo cosas distintas. El efecto secundario es que
   un buscador que no ejecute JS no indexará las respuestas. Si te importa el
   SEO de esa página, se arregla con un paso de build que la pre-renderice
   (media hora). Dímelo.
