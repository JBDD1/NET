# Correos de autenticación — configuración manual

Todo lo que el código **no puede hacer por sí mismo**: la consola de Firebase y
el DNS del dominio. El código ya está preparado para todo lo de abajo.

> **Antes de ejecutar nada:** la consola de Firebase cambia de sitio los menús
> con cierta frecuencia. Los nombres que aparecen aquí son los que tenían la
> última vez que se documentaron, pero **verifícalos contra la consola y la
> documentación oficial antes de seguir los pasos**. Si un menú no está donde
> dice aquí, no lo busques a ciegas: dime qué ves y lo ajusto.
>
> Documentación de referencia:
> - Plantillas de correo: https://firebase.google.com/docs/auth/custom-email-handler
> - Dominios autorizados y ajustes: https://firebase.google.com/docs/auth/web/start
> - Política de contraseñas: https://cloud.google.com/identity-platform/docs/password-policy

**Última actualización:** 31 de octubre de 2026

---

## Resumen: qué tienes que hacer

| # | Tarea | Dónde | Imprescindible |
|---|---|---|---|
| 1 | Pegar las 2 plantillas de correo en español | Consola Firebase | **Sí** |
| 2 | Poner remitente «Finova» y responder-a `MyFinova1@gmail.com` | Consola Firebase | **Sí** |
| 3 | Añadir el dominio a dominios autorizados | Consola Firebase | **Sí** (al desplegar) |
| 4 | Subir la política de contraseñas a 8 caracteres | Consola Firebase | Sí (coherencia) |
| 5 | Revisar la protección contra enumeración de correos | Consola Firebase | Sí |
| 6 | Fijar `VITE_APP_URL` cuando haya dominio propio | Vercel | Cuando lo compres |
| 7 | Decidir cómo enviar los correos (ver apartado 6) | — | Para que no caigan en spam |
| 8 | Registros DNS SPF / DKIM / DMARC | Porkbun | Solo si haces el 7 |
| 9 | Probar la entregabilidad de verdad | Gmail/Outlook/iCloud | **Sí** |

---

## 1. Plantillas de correo (copiar y pegar)

**Ruta en la consola:** Firebase Console → tu proyecto → **Authentication** →
pestaña **Templates** (en español suele aparecer como «Plantillas»). Hay un
desplegable con los tipos de correo y un icono de lápiz para editar cada uno.

Firebase sustituye estas variables al enviar:

| Variable | Qué pone |
|---|---|
| `%LINK%` | El enlace de acción (obligatoria) |
| `%EMAIL%` | El correo del destinatario |
| `%DISPLAY_NAME%` | El nombre del usuario |
| `%APP_NAME%` | El nombre público del proyecto |

> El nombre público se cambia en **Project settings** → **General** → *Public-facing
> name*. Ponlo como **Finova** o `%APP_NAME%` dirá algo como «project-387946044101».

### Ajustes comunes a las dos plantillas

- **Sender name / Nombre del remitente:** `Finova`
- **Reply-to / Responder a:** `MyFinova1@gmail.com`
- **From:** ver el apartado 6 — por defecto será
  `noreply@finova-92100.firebaseapp.com`.

### 1.1 Verificación de correo

**Asunto:**

```
Confirma tu correo en Finova
```

**Cuerpo:**

```
Hola %DISPLAY_NAME%:

Para terminar de crear tu cuenta en Finova, confirma que esta dirección es tuya:

%LINK%

El enlace caduca en unas horas. Si caduca, entra en Finova y pulsa «Reenviar
correo» para recibir uno nuevo.

Si no has creado ninguna cuenta en Finova, ignora este mensaje: sin confirmar
el correo, la cuenta no se activa.

Finova — tu asistente financiero personal
Responder a este correo llega a MyFinova1@gmail.com
```

### 1.2 Restablecer contraseña

**Asunto:**

```
Restablecer tu contraseña de Finova
```

**Cuerpo:**

```
Hola:

Hemos recibido una solicitud para cambiar la contraseña de la cuenta de Finova
asociada a %EMAIL%. Puedes crear una contraseña nueva aquí:

%LINK%

El enlace caduca en una hora y solo se puede usar una vez.

Si no has sido tú, ignora este correo. Tu contraseña actual sigue siendo válida
y no hace falta que hagas nada.

Finova — tu asistente financiero personal
Responder a este correo llega a MyFinova1@gmail.com
```

### Por qué están redactadas así

Los filtros de spam puntúan el texto, no solo el remitente. Estas plantillas
evitan a propósito:

- **Mayúsculas sostenidas** y signos de exclamación repetidos.
- Palabras que disparan filtros en correo transaccional: «gratis», «oferta»,
  «urgente», «haz clic aquí ahora».
- Imágenes, botones de colores y HTML cargado: texto plano con un enlace puntúa
  mejor y se ve igual en todos los clientes.
- Un único enlace. Varios enlaces en un correo de verificación es un patrón
  típico de phishing y los filtros lo saben.

Las dos incluyen la línea de «si no has sido tú» que pedía el encargo, y las dos
dicen a dónde va la respuesta, que es lo que hace que un correo no parezca
automático y hostil.

---

## 2. Dominios autorizados

**Ruta:** Authentication → **Settings** → **Authorized domains**.

Los enlaces de los correos vuelven a la URL que el código pasa en
`actionCodeSettings` (ver `src/auth/auth-shared.js`). **Si ese dominio no está
en esta lista, Firebase rechaza el envío** con `auth/unauthorized-continue-uri`
— y el usuario no recibe nada.

Tiene que estar:

- `localhost` (ya está por defecto)
- El dominio de Vercel donde esté desplegada la app
- Tu dominio propio, cuando lo compres

> `127.0.0.1` **no vale** y no hace falta añadirlo: Firebase Auth solo acepta
> `localhost`. El código ya redirige de `127.0.0.1` a `localhost`
> (`auth.js`, y también `landing.js`).

---

## 3. Política de contraseñas

**Ruta:** Authentication → **Settings** → **Password policy**.

El cliente ya exige **8 caracteres** (`FV_PASSWORD_MIN` en
`src/auth/auth-shared.js`), pero el mínimo de Firebase por defecto es **6**.
Ahora mismo el cliente es más estricto que el servidor: es seguro, pero
incoherente. Súbelo a 8 en la consola para que coincidan.

Si además activas requisitos de mayúsculas, números o símbolos, **dímelo**: hay
que reflejarlos en `fvPasswordProblem()`, o Firebase rechazará contraseñas que
el cliente ha dado por buenas y el usuario verá un error que no esperaba.

---

## 4. Protección contra enumeración de correos

**Ruta:** Authentication → **Settings** → **User actions** (puede aparecer
como «Acciones del usuario»), opción **Email enumeration protection**.

**Déjala activada.** Es lo que hace que Firebase no distinga entre «esa cuenta
no existe» y «la contraseña es incorrecta» a nivel de API.

El código ya no filtra esa información por su lado:

- `auth/user-not-found` y `auth/wrong-password` devuelven **el mismo texto**
  («Correo o contraseña incorrectos»).
- El formulario de recuperación responde **siempre** «Si existe una cuenta con
  ese correo…», tanto si existe como si no.

Hay 5 tests que lo fijan (`src/tests/auth-email.test.js`), así que si alguien lo
rompe en el futuro, la suite se pone roja.

> Con esta protección activada, Firebase devuelve `auth/invalid-credential` en
> vez de `auth/wrong-password`. Los dos códigos están en el mapa y dan el mismo
> mensaje, así que funciona igual con la opción puesta o quitada.

---

## 5. `VITE_APP_URL`

Ahora mismo está **vacía** en `.env.production` a propósito: el código cae a
`location.origin`, así que el enlace del correo devuelve al usuario al mismo
sitio desde el que se registró. Es lo correcto mientras no haya un dominio
canónico.

Cuando compres el dominio:

1. Ponlo en Vercel → Project → Settings → Environment Variables:
   `VITE_APP_URL=https://tudominio.com` (**sin barra final**).
2. Añade ese dominio a los dominios autorizados (apartado 2).
3. Vuelve a desplegar: es una variable de build, no de ejecución.

---

## 6. Entregabilidad: que los correos no caigan en spam

Aquí está la parte importante y donde hay que tomar una decisión.

### El problema real

Firebase Authentication envía los correos desde
`noreply@finova-92100.firebaseapp.com`, un dominio **compartido con todos los
proyectos de Firebase**. Eso significa:

- No controlas su reputación. Si otros proyectos envían spam, te afecta.
- **No puedes publicar SPF, DKIM ni DMARC para un dominio que no es tuyo.** Los
  registros DNS que pondrías en Porkbun no tienen ningún efecto sobre los
  correos que salen del dominio de Firebase.
- Gmail y Outlook tratan con desconfianza el primer correo de un remitente
  desconocido, y es justo el correo de verificación.

**Sé honesto conmigo mismo aquí: no estoy seguro de hasta dónde llega hoy la
personalización del remitente en Firebase Authentication.** Históricamente la
consola permite cambiar el *nombre* del remitente, el *responder-a* y el
*dominio del enlace*, pero **no el dominio del `From:` con DKIM propio**, salvo
pasando a Identity Platform o enviando tú los correos. Puede haber cambiado.
**Compruébalo en la consola y en la documentación antes de decidir**, y dime qué
opciones te aparecen de verdad en la pestaña de plantillas.

### Las dos opciones

#### Opción A — Dejar los correos de Firebase (coste 0)

Lo que sí puedes hacer sin tocar DNS ni pagar nada:

1. Poner el nombre del remitente a `Finova` y el responder-a a
   `MyFinova1@gmail.com` (apartado 1).
2. Poner un *Public-facing name* decente (apartado 1).
3. Usar las plantillas de arriba, que están escritas para no disparar filtros.
4. Avisar al usuario de que mire en spam — **ya lo hace la app**: la pantalla
   «Revisa tu correo» lo dice explícitamente, y los mensajes de recuperación
   también.

Es suficiente para empezar. Una parte de los correos irá a spam en Gmail, y por
eso la app no bloquea la exploración de la app: solo la IA y la sincronización.

#### Opción B — Enviar tú los correos desde tu dominio (lo que de verdad arregla la entregabilidad)

El servidor genera el enlace con el Admin SDK y envía el correo con un
proveedor transaccional, con tu dominio y tu DKIM:

```js
// En server.cjs, con el Admin SDK ya inicializado:
const link = await _adminSDK.auth().generateEmailVerificationLink(email, {
  url: APP_URL + '/index.html', handleCodeInApp: false,
});
// …y el correo lo envías tú con la plantilla de arriba.
```

**Costes reales, para que decidas tú (no he contratado nada):**

| Proveedor | Plan gratuito | Primer plan de pago | Nota |
|---|---|---|---|
| **Resend** | 3.000 correos/mes, 100/día | ~20 $/mes (50.000) | El más simple de integrar; DKIM en 3 registros |
| **Brevo** (ex Sendinblue) | 300/día, sin caducidad | ~9 €/mes | Empresa europea, cómodo para RGPD |
| **Amazon SES** | 3.000/mes el primer año | ~0,10 $/1.000 | El más barato con volumen; configuración más áspera |
| **Postmark** | 100/mes de prueba | ~15 $/mes | La mejor reputación de entrega; sin plan gratuito real |
| **SendGrid** | 100/día | ~20 $/mes | Reputación de IP compartida irregular últimamente |

**Mi recomendación:** **Resend** si vas a por la opción B. 3.000 correos al mes
gratis sobran de largo para empezar (son 3.000 registros), la verificación de
dominio son tres registros DNS, y la integración es una llamada HTTP. Si el
proyecto crece mucho, Amazon SES es cuatro veces más barato pero cuesta un día
de trabajo configurarlo bien.

**No contrates nada todavía.** Dime si quieres la opción B y hago la integración
en el servidor; la cuenta la creas tú.

### Registros DNS en Porkbun (solo para la opción B)

**Ruta en Porkbun:** entra en tu cuenta → **Domain Management** → la fila de tu
dominio → **DNS** (o el botón de «Details» y luego la pestaña de DNS).

> Los valores exactos de DKIM **te los da el proveedor que elijas** cuando
> verificas el dominio. No los inventes ni los copies de aquí: cada proveedor
> genera una clave distinta.

**1. SPF** — dice qué servidores pueden enviar en tu nombre.

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Host | *(vacío, o `@`)* |
| Answer | `v=spf1 include:<el-que-te-dé-el-proveedor> ~all` |

⚠️ **Solo puede haber UN registro SPF por dominio.** Si ya tienes uno, no añadas
otro: edita el existente y mete el `include:` dentro. Dos registros SPF hacen
que la comprobación falle del todo, que es peor que no tener ninguno.

**2. DKIM** — la firma criptográfica. El proveedor te dará uno o varios
registros con esta forma:

| Campo | Valor |
|---|---|
| Type | `TXT` o `CNAME`, según el proveedor |
| Host | `resend._domainkey` (ejemplo — el tuyo lo da el proveedor) |
| Answer | La clave pública que te dé el proveedor |

**3. DMARC** — le dice a Gmail qué hacer si SPF y DKIM fallan.

Empieza **en modo observación**, no en rechazo:

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Host | `_dmarc` |
| Answer | `v=DMARC1; p=none; rua=mailto:MyFinova1@gmail.com; fo=1` |

`p=none` no bloquea nada: solo pide informes. Déjalo así **dos o tres semanas**,
mira los informes que te lleguen, y cuando confirmes que todo tu correo
legítimo pasa SPF y DKIM, endurece a `p=quarantine` y más tarde a `p=reject`.
Poner `p=reject` el primer día es la forma más rápida de que tus propios correos
desaparezcan sin que te enteres.

**Propagación:** Porkbun suele aplicar los cambios en minutos, pero da margen de
hasta 24-48 h antes de dar por fallida una comprobación.

---

## 7. Cómo comprobar la entregabilidad de verdad

Esto **solo se puede comprobar en producción, con correos reales**. No hay forma
de simularlo.

### 7.1 Prueba manual en los tres proveedores que importan

Regístrate con una cuenta real de cada uno y anota dónde cae el correo:

| Proveedor | Cuenta de prueba | ¿Bandeja o spam? | ¿Cuánto tardó? |
|---|---|---|---|
| Gmail | | | |
| Outlook / Hotmail | | | |
| iCloud | | | |

Gmail y Outlook son los dos que más usuarios tienen en España; iCloud es el más
estricto de los tres y el que primero te dirá si algo va mal.

**Mira siempre en spam antes de concluir que el correo no ha llegado.** Y en
Gmail, comprueba también la pestaña «Promociones»: un correo transaccional que
cae ahí es casi tan malo como el spam, porque el usuario no lo mira.

### 7.2 Puntuación con mail-tester

1. Entra en https://www.mail-tester.com y copia la dirección que te da (es de
   un solo uso).
2. Provoca un envío a esa dirección: lo más fácil es usar el formulario de
   «¿Has olvidado tu contraseña?» con esa dirección. Da lo mismo que no exista
   la cuenta… **salvo que con la protección contra enumeración activada
   Firebase no envía nada a direcciones no registradas**. Así que regístrate
   con la dirección de mail-tester y usa el correo de verificación, que sí sale.
3. Vuelve a mail-tester y mira la puntuación.

**Qué esperar de forma realista:**

- Con la **opción A** (correos de Firebase): entre 5 y 7 sobre 10. Te dirá que
  el dominio del remitente no coincide con el tuyo y que no hay DKIM propio.
  Eso **no se puede arreglar** sin pasar a la opción B.
- Con la **opción B** bien configurada: 9 o 10 sobre 10.

Si sacas menos de 5 en la opción A, hay algo más mal (una plantilla con
lenguaje de spam, el *Public-facing name* sin poner) y merece mirarlo.

### 7.3 Google Postmaster Tools (opción B, a medio plazo)

Si acabas enviando desde tu dominio, da de alta el dominio en
https://postmaster.google.com. Es gratis y te dice el porcentaje de correos que
Gmail marca como spam, que es el único dato fiable de si vas bien.

---

## 8. Lo que ya hace el código (no tienes que tocarlo)

Para que sepas qué está cubierto y no lo busques en la consola:

- **Idioma:** `languageCode = 'es'` en los dos sistemas de auth, así que los
  correos salen en español sin tocar nada.
- **Enlaces de vuelta:** `actionCodeSettings` en los cuatro envíos
  (verificación y restablecimiento, en la app y en la landing).
- **Página de destino:** se usa el **manejador por defecto de Firebase**
  (`/__/auth/action`), que no hay que configurar y se muestra en español
  porque el código fija `languageCode = 'es'`. Como los cuatro envíos pasan
  `actionCodeSettings.url`, Firebase recibe un `continueUrl` y la página de
  acción debe ofrecer un enlace de vuelta a la app tras cambiar la contraseña.
  **Esto es lo único de este apartado que no he podido comprobar**: requiere un
  correo real. Al hacer la prueba del apartado 7.1, fíjate en si aparece ese
  enlace de vuelta; si no sale, dímelo y monto una página de acción propia
  (es un cambio contenido: una página que lea `mode`, `oobCode` y
  `continueUrl` de la URL y llame a `confirmPasswordReset`).
- **Mensajes:** un único mapa de errores en `src/auth/auth-shared.js`, cargado
  por `index.html` y por `landing.html`. 22 códigos traducidos, ninguno revela
  si una cuenta existe, ninguno muestra el código crudo salvo como último
  recurso.
- **Pantalla «Revisa tu correo»:** con reenvío (60 s de espera entre envíos),
  «Ya lo he verificado», «Explorar la app mientras tanto», «Usar otra cuenta» y
  aviso de spam.
- **Verificación desde otro dispositivo:** al volver a la pestaña se refresca el
  estado solo, sin pedir cerrar sesión.
- **Bloqueo de funciones sin verificar:** Asesor IA y sincronización, en el
  cliente y **también en el servidor** (`REQUIRE_EMAIL_VERIFIED`, por defecto
  `true`). La descarga de datos se deja abierta a propósito, para que quien
  verifique en otro dispositivo pueda recuperar lo suyo.

### La válvula de escape

Si un día los correos dejan de llegar en un proveedor concreto y la gente se
queda sin poder sincronizar, puedes desactivar el bloqueo del servidor sin
desplegar código: en Railway, variable de entorno

```
REQUIRE_EMAIL_VERIFIED=false
```

Solo la cadena exacta `false` lo desactiva: una variable vacía o mal escrita
deja el bloqueo activo, que es la dirección segura del fallo.
