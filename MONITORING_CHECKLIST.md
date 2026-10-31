# Revisión diaria — los primeros 30 días

Diez minutos al día. No más: si tardas más, es que algo necesita arreglarse en
vez de mirarse.

La idea es sencilla: **en el lanzamiento no sabes qué se va a romper**, así que
durante un mes miras los cuatro sitios donde se ve. A partir del día 30, una
vez a la semana.

> Cada apartado tiene un **umbral de actuación**: el número que convierte
> «curioso» en «hay que hacer algo hoy». Sin umbrales, mirar paneles es un
> pasatiempo.

---

## La rutina (10 minutos)

### 1 · Sentry — errores nuevos · 3 min

Ordena por **«Last seen»** y mira solo lo que haya aparecido desde ayer.

| Qué ves | Qué significa | Actúa si… |
|---|---|---|
| Un error nuevo con **1 evento** | Casualidad o un navegador raro | Anótalo, no lo toques |
| Un error nuevo con **5 o más usuarios afectados** | Es real y le pasa a gente | **Hoy** |
| Un error con **más eventos que usuarios × 10** | Está en un bucle | **Hoy**: un bucle puede agotar la cuota del mes |
| Cualquier error en `donde: fiscalidad` o `donde: import-csv` | Cálculos o datos del usuario | **Hoy**: son los que erosionan la confianza |
| Un error en `donde: sync-subida` que afecta a **más de 2 usuarios** | Puede que nadie tenga copia en el servidor | **Hoy** |

**Mira la etiqueta `donde`.** Todos los errores que capturamos a mano la llevan:
`cargar-datos`, `import-csv`, `fiscalidad`, `sync-subida`, `asesor-ia`. Te dice
qué parte del producto duele sin leer la traza.

**Si ves un dato de un usuario sin redactar** (un importe, un correo, un IBAN):
**para y arréglalo antes que nada**. Es un incidente de privacidad, no un bug.

### 2 · UptimeRobot — caídas · 1 min

Mira solo si hay algo en rojo o algún aviso desde ayer.

| Qué ves | Actúa si… |
|---|---|
| Caídas de **menos de 2 minutos**, aisladas | No: suele ser un redespliegue |
| Una caída de **más de 5 minutos** | **Hoy**: mira los logs de Railway a esa hora |
| **Más de 3 caídas cortas** en un día | **Hoy**: el servidor se está reiniciando solo, probablemente por memoria |
| El monitor de Railway rojo y el de Vercel verde | El proxy está sirviendo caché. **Hoy** |
| Disponibilidad mensual **por debajo del 99 %** | **Esta semana**: son más de 7 horas caído al mes |

### 3 · Analítica — visitas y embudo · 3 min

| Métrica | Qué miras | Actúa si… |
|---|---|---|
| Visitantes del día | La tendencia, no el número | Cae más del 50 % dos días seguidos |
| `registro_completado` | Cuántos de los que entran se registran | **Menos del 2 %** de las visitas: el problema está en la landing o en el registro |
| `primer_transaccion` / `registro_completado` | Si los registrados llegan a usar la app | **Menos del 40 %**: el primer uso está roto o es confuso |
| `importacion_csv_ok` | Si la importación funciona de verdad | Cero en una semana con registros: nadie consigue importar |
| `asesor_ia_usado` | Si la IA se usa | Sube mucho: mira el coste antes de que te sorprenda |
| `cuenta_borrada` | Bajas | **2 o más en un día**: pregúntate qué pasó ese día |

**El embudo que importa en el lanzamiento** es
`visita → registro_completado → primer_transaccion`. Si alguien se registra y
no crea una transacción, no ha visto para qué sirve Finova.

### 4 · Logs de Railway — picos · 3 min

Busca estos cuatro patrones. El servidor los escribe a propósito para que se
puedan buscar:

| Busca | Qué significa | Actúa si… |
|---|---|---|
| `429 en` | Alguien está tocando un límite | **Más de 20 al día**: o hay abuso, o un límite está mal calibrado y molesta a usuarios normales |
| `Token inválido` / 401 | Sesiones caducadas (normal) o alguien probando | **Más de 50 al día desde la misma IP**: el antifuerza-bruta ya la bloquea, pero compruébalo |
| `Origen rechazado` | La CSP o el CORS rechazan algo | **Cualquiera repetido**: suele ser que `ALLOWED_ORIGIN` no coincide con tu dominio real |
| `[FINOVA][ERROR]` | Un 500 | Cualquiera que no esté ya en Sentry |
| `Disco efímero` | El aviso del arranque | Si sigue saliendo, el feedback se pierde en cada despliegue |

**Ojo con los 429 y los 401**: son los dos que más fácilmente esconden un
problema de producto detrás de lo que parece un problema de seguridad. Un
usuario legítimo al que el rate limit corta la sincronización ve «no se guarda»
y se va sin decir nada.

---

## Una vez a la semana (15 min más)

- **Sentry → Releases.** ¿Ha subido la tasa de errores con el último
  despliegue? Si sí, mira qué cambió.
- **Cuota de Sentry.** ¿A qué ritmo vas del límite del mes? Si a mitad de mes
  llevas más del 60 %, hay un error en bucle que hay que silenciar o arreglar.
- **Admin → Feedback de usuarios.** Léelo todo. En el lanzamiento, un mensaje de
  feedback vale más que cien visitas.
- **Admin → Retención.** D1, D7 y D30. Los objetivos que marca el propio panel
  son >20 %, >10 % y >5 %. *(Ojo: ahora mismo esos datos solo se recogen en
  local — ver `MONITORING_SETUP.md`, apartado 4.5.)*
- **`npm audit`.** Sobre todo si han salido versiones nuevas de Sentry.

---

## Cuándo dejar de hacer esto

A los **30 días**, si durante la última semana se cumple todo:

- Ningún error nuevo que afecte a más de 2 usuarios.
- Disponibilidad por encima del 99,5 %.
- Ningún pico de 429 ni de 401 sin explicar.

Entonces pasa a **una revisión semanal** y confía en las alertas:

- UptimeRobot te avisa de las caídas.
- Sentry te puede avisar por correo de los errores **nuevos** (configúralo:
  alertas solo para «issue nuevo», no para cada evento, o te saturarás y
  dejarás de leerlas).

**Lo que no deberías dejar de mirar nunca:** el feedback de los usuarios. Es el
único canal que te dice lo que los paneles no pueden.

---

## Qué hacer el primer día que algo se rompe

Un orden que evita dar vueltas:

1. **¿Está caído?** → UptimeRobot. Si sí, logs de Railway de esa hora.
2. **¿Falla para todos o para uno?** → Sentry, número de usuarios afectados.
3. **¿Es nuevo?** → Sentry, «First seen». Si coincide con un despliegue, ya
   sabes qué lo causó.
4. **¿Qué parte?** → la etiqueta `donde` del error.
5. **¿Lo ha notado alguien?** → Admin → Feedback.

Si tras esos cinco pasos no sabes qué pasa, usa el botón **«Probar error»** de
Admin → Monitorización para confirmar que la cadena hasta Sentry sigue viva.
Un panel vacío puede significar «no hay errores» o «no llegan los informes», y
son cosas muy distintas.
