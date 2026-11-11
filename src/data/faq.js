'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — PREGUNTAS FRECUENTES (fuente única)

   La cargan TRES sitios: la FAQ de Ajustes, la página faq.html y el
   formulario de feedback. Si se duplicara el texto, las versiones acabarían
   divergiendo y una de ellas mentiría.

   REGLA: cada respuesta está comprobada contra el código, no contra lo que
   la app debería hacer. Si algo no se puede verificar, no se afirma. Los
   comentarios de cada entrada dicen DÓNDE se comprobó, para que al cambiar
   ese código alguien sepa que hay una respuesta que actualizar.
═══════════════════════════════════════════════════════════════ */

const FINOVA_FAQ = [
  {
    id: 'precio',
    q: '¿Es gratis Finova? ¿Qué incluye?',
    // Verificado: _LIMITS.ai.byUID = { free: 5, premium: 50 } en server.cjs.
    // La lista de espera responde "Te avisamos cuando llegue el plan Premium"
    // (handleWaitlist), así que Premium NO está disponible todavía.
    a: `Sí, y ahora mismo todo lo que ves es gratis: transacciones, cartera,
        objetivos, patrimonio, viajes, fiscalidad y copias de seguridad, sin
        límite y sin tarjeta.
        La única función con cupo es el Asesor IA, limitado a 5 consultas al
        día por cuenta, porque cada consulta tiene un coste real para nosotros.
        Hay un plan Premium en preparación que ampliará ese cupo, pero todavía
        no está disponible: si te apuntas a la lista de espera te avisamos
        cuando llegue.`,
    tags: ['precio', 'gratis', 'premium', 'coste', 'pago', 'plan'],
  },

  {
    id: 'datos',
    q: '¿Dónde se guardan mis datos? ¿Quién puede verlos?',
    // Verificado: storage.js guarda en localStorage (_getStorageKey) e
    // IndexedDB (finova_photos, finova_state). El servidor solo recibe un
    // blob cifrado AES-256-GCM (_encryptUserData en server.cjs) en
    // data/users/<uid>.json. No hay tabla de transacciones ni de activos.
    //
    // El último párrafo se añadió al implementar la monitorización: sin él,
    // esta respuesta decía «quién puede verlos» sin mencionar que hay dos
    // herramientas externas que reciben algo. Ver src/core/monitoring.js y
    // src/core/analytics.js, y el apartado 9 de privacidad.html.
    a: `En tu propio navegador. Finova es «local-first»: tus transacciones,
        cartera y objetivos viven en el almacenamiento de tu dispositivo, y las
        fotos de tickets en su base de datos local.
        Si inicias sesión, se guarda además una copia de seguridad en nuestro
        servidor, pero <strong>cifrada</strong> (AES-256-GCM) y como un único
        bloque: no tenemos una tabla con tus gastos, ni podemos consultar
        cuánto ganas o en qué lo gastas.
        Lo que sí guardamos en claro es tu correo y la fecha del último acceso,
        para poder darte soporte.
        Aparte de eso, usamos dos herramientas externas: una para enterarnos de
        los errores y otra para contar visitas, sin cookies.
        <strong>Ninguna de las dos recibe importes, movimientos ni saldos</strong>
        —se eliminan en tu navegador antes de enviar nada— y las dos se pueden
        apagar en <strong>Ajustes → Privacidad</strong>.
        Más en la política de privacidad:
        <a href="privacidad.html#s2">qué datos tratamos</a>.`,
    tags: ['datos', 'privacidad', 'guardan', 'cifrado', 'servidor', 'seguridad', 'ver',
           'errores', 'analitica', 'estadisticas', 'terceros', 'sentry'],
  },

  {
    id: 'ia',
    q: '¿Qué datos se envían al Asesor IA y cómo lo desactivo?',
    // Verificado: buildFinancialSnapshot() en ai.js incluye totales,
    // transacciones del mes y gasto por categoría (sin fotos: se excluyen
    // photo/photoId). toggleAiContext() alterna el botón "Con datos" /
    // "Sin datos" y _checkAiConsent() pide permiso la primera vez.
    a: `Cuando le preguntas algo, se le envía un resumen de tu situación:
        totales de efectivo e inversiones, los movimientos del mes en curso y
        tu gasto por categoría. No se envían las fotos de tickets.
        Puedes desactivarlo: en el Asesor IA, el botón
        <strong>«Con datos»</strong> lo cambia a <strong>«Sin datos»</strong> y
        a partir de ahí la IA responde sin ver nada tuyo.
        La primera vez te pedimos permiso explícito antes del primer envío, y
        si usas tu propia clave de API la conversación va directa al proveedor
        que elijas, sin pasar por nosotros.`,
    tags: ['ia', 'asesor', 'inteligencia artificial', 'desactivar', 'privacidad', 'claude', 'chatgpt'],
  },

  {
    id: 'importar',
    q: '¿Cómo importo mis movimientos del banco? ¿Qué formatos admite?',
    // Verificado: index.html csv-import-input acepta
    // .csv,.txt,.xls,.xlsx,.xlsm,.ods y ofx-import-input .ofx,.qfx,.ofc.
    // El importador detecta separador y codificación (_detectCsvEncoding).
    a: `En Transacciones, con el botón de importar. Admite los extractos en
        <strong>CSV y texto</strong> (<code>.csv</code>, <code>.txt</code>),
        <strong>hojas de cálculo</strong> (<code>.xls</code>,
        <code>.xlsx</code>, <code>.xlsm</code>, <code>.ods</code>) y
        <strong>OFX</strong> (<code>.ofx</code>, <code>.qfx</code>,
        <code>.ofc</code>).
        No hace falta preparar el archivo: Finova detecta sola el separador, la
        codificación y qué columna es la fecha, el concepto y el importe, así
        que los extractos de los bancos españoles suelen entrar tal cual.
        Antes de guardar nada te muestra una pantalla de revisión, y descarta
        los movimientos que ya tengas para no duplicarlos.`,
    tags: ['importar', 'banco', 'csv', 'excel', 'ofx', 'extracto', 'movimientos', 'formatos'],
  },

  {
    id: 'cartera-importar',
    q: '¿Puedo importar mi cartera desde el bróker?',
    // Verificado: portfolio-import.js con _pfSniffFormat (html/xml/json/
    // delimitado) y portfolio-import-input acepta 11 extensiones.
    a: `Sí. En Cartera, con el botón de importar, o desde Ajustes. Acepta lo
        que exportan la mayoría de brókers: CSV y TSV, hojas de cálculo, JSON,
        XML y tablas HTML.
        Detecta el formato por el contenido, no por la extensión, porque es muy
        común que un archivo llamado <code>.xls</code> sea en realidad una
        tabla HTML. También puedes pegar la tabla directamente.
        Si un valor ya está en tu cartera, no lo duplica: fusiona las dos
        posiciones calculando el precio medio de compra.`,
    tags: ['cartera', 'broker', 'importar', 'inversiones', 'posiciones'],
  },

  {
    id: 'precios',
    q: '¿Por qué no se actualizan los precios de mis acciones, o van con retraso?',
    // Verificado: script.js refresca cada 10 min (PRICE_REFRESH_MS) y solo si
    // hay tickers. Las cotizaciones vienen de Yahoo Finance vía /api/yahoo.
    a: `Las cotizaciones vienen de Yahoo Finance y se refrescan de forma
        automática cada 10 minutos, no en tiempo real. Puedes forzar una
        actualización con el botón de refrescar de la sección Cartera.
        Un retraso de unos minutos respecto al mercado es normal: son datos
        gratuitos y la mayoría de mercados los publican con demora.
        Si un valor concreto no se actualiza nunca, lo más probable es que su
        símbolo no sea el que espera Yahoo. Para las bolsas europeas hace falta
        el sufijo del mercado, por ejemplo <code>SAN.MC</code> para Santander
        en Madrid en lugar de <code>SAN</code>.`,
    tags: ['precios', 'cotizaciones', 'acciones', 'actualizar', 'retraso', 'yahoo', 'ticker'],
  },

  {
    id: 'sincronizar',
    q: '¿Cómo sincronizo mis datos entre dispositivos?',
    // Verificado: _debouncedServerSync (storage.js) sube el blob si hay
    // APP.uid; _loadUserDataFromServer lo baja si no hay datos locales.
    // Requiere correo verificado (REQUIRE_EMAIL_VERIFIED en server.cjs).
    a: `Iniciando sesión con la misma cuenta en los dos dispositivos. Mientras
        trabajas, Finova sube una copia cifrada de tus datos, y al entrar en un
        dispositivo nuevo se descarga sola.
        Para que la sincronización se active hace falta tener el correo
        verificado: es lo que nos permite devolverte el acceso si pierdes la
        contraseña.
        Ten en cuenta que no es colaboración en tiempo real: si editas en dos
        sitios a la vez sin recargar, gana lo último que se haya guardado. Lo
        más seguro es cerrar la app en un dispositivo antes de ponerte en el
        otro.`,
    tags: ['sincronizar', 'dispositivos', 'movil', 'ordenador', 'sync', 'varios'],
  },

  {
    id: 'backup',
    q: '¿Cómo hago una copia de seguridad y la restauro?',
    // Verificado: downloadBackup() genera finova-backup-<fecha>.json y
    // excluye las 4 API keys; la restauración filtra por BACKUP_ALLOWED_KEYS.
    a: `En Ajustes, con <strong>«Descargar backup»</strong>: se guarda un
        archivo <code>.json</code> con todos tus datos, que puedes conservar
        donde quieras. Tus claves de API no se incluyen a propósito.
        Para restaurar, usa el botón de importar backup del mismo sitio y
        elige ese archivo. Finova valida el contenido antes de aplicarlo, así
        que un archivo de otra app o corrupto no te destroza los datos.
        Es buena idea descargar uno antes de cualquier cambio grande, como una
        importación masiva.`,
    tags: ['backup', 'copia', 'seguridad', 'restaurar', 'exportar', 'json'],
  },

  {
    id: 'borrar-cuenta',
    q: '¿Cómo borro mi cuenta y todos mis datos?',
    // Verificado: src/utils/account-delete.js + POST /api/account/delete.
    // Exige escribir ELIMINAR, 5 s de espera y reautenticación.
    a: `En <strong>Ajustes → Zona de peligro → «Eliminar mi cuenta»</strong>.
        Se borra todo: tu cuenta, los datos de este dispositivo y la copia
        cifrada del servidor, incluidas las copias de sincronización.
        Para evitar borrados accidentales te pedimos escribir la palabra
        ELIMINAR, esperar unos segundos y volver a identificarte. Antes de
        confirmar puedes descargar una copia de todo.
        Es inmediato y no se puede deshacer: no hay papelera ni periodo de
        gracia, y después no podemos recuperar nada.
        Lo detalla la política de privacidad en
        <a href="privacidad.html#s7">eliminación de cuenta y datos</a>.`,
    tags: ['borrar', 'eliminar', 'cuenta', 'datos', 'rgpd', 'baja', 'darse de baja'],
  },

  {
    id: 'irpf',
    q: '¿Los cálculos de IRPF son fiables?',
    // Verificado: fiscal.js usa la escala estatal 2024 (art. 66 y art. 63
    // LIRPF, RDL 4/2024) y NO modela escalas autonómicas: no existe
    // selector de comunidad en el modelo de datos.
    a: `Son <strong>orientativos</strong>, para que te hagas una idea antes de
        hacer la declaración. Usan los tramos del <strong>ejercicio
        2024</strong>, la regla de los dos meses y el límite del 25 % para
        compensar pérdidas.
        Hay una limitación importante que conviene que sepas: Finova aplica una
        <strong>escala estatal única</strong> y no modela los tramos propios de
        cada comunidad autónoma, así que el resultado puede diferir del real
        según dónde vivas.
        No sustituyen a un asesor fiscal ni valen para presentar la
        declaración. Para eso, los datos oficiales son los de la Agencia
        Tributaria.`,
    tags: ['irpf', 'impuestos', 'fiscal', 'hacienda', 'declaracion', 'fiable', 'renta'],
  },

  {
    id: 'instalar',
    q: '¿Cómo instalo Finova como app en el móvil?',
    // Verificado: manifest.json con display standalone y las 4 meta de iOS
    // en index.html. No hay app en las tiendas.
    a: `Finova es una aplicación web instalable, así que no está en la App
        Store ni en Google Play: se instala desde el navegador y ocupa muy
        poco.
        En <strong>Android con Chrome</strong>, abre el menú de los tres puntos
        y elige «Instalar aplicación» o «Añadir a pantalla de inicio».
        En <strong>iPhone con Safari</strong>, pulsa el botón de compartir y
        luego «Añadir a pantalla de inicio» (en iOS solo funciona desde Safari,
        no desde Chrome).
        Una vez instalada se abre a pantalla completa, sin la barra del
        navegador.`,
    tags: ['instalar', 'app', 'movil', 'pwa', 'iphone', 'android', 'pantalla de inicio'],
  },

  {
    id: 'offline',
    q: '¿Funciona sin conexión?',
    // Verificado: sw.js con Cache First para el shell, Network First para
    // /api y página offline de respaldo. Las cotizaciones y la IA necesitan
    // red; el sync se reintenta al volver.
    a: `En buena parte, sí. Como tus datos están en el dispositivo, puedes
        abrir la app, consultar tus movimientos y seguir apuntando gastos sin
        conexión.
        Lo que necesita internet es lo que viene de fuera: las cotizaciones de
        tus inversiones, los tipos de cambio, el Asesor IA y la sincronización
        con el servidor.
        Los cambios que hagas sin conexión se guardan en el dispositivo y se
        suben solos cuando vuelvas a tener red.`,
    tags: ['offline', 'sin conexion', 'internet', 'avion', 'desconectado'],
  },

  {
    id: 'contrasena',
    q: 'He olvidado mi contraseña, ¿qué hago?',
    // Verificado: _renderResetForm/_submitPasswordReset en auth.js y
    // lpSendReset en landing.js, con sendPasswordResetEmail.
    a: `En la pantalla de inicio de sesión, pulsa
        <strong>«¿Has olvidado tu contraseña?»</strong>, escribe tu correo y te
        enviaremos un enlace para crear una nueva.
        Si no te llega en unos minutos, mira en la carpeta de spam: es donde
        suelen acabar los primeros correos de un remitente nuevo.
        Si entraste con Google, no tienes contraseña que recuperar: usa el
        botón «Continuar con Google».
        Y tranquilo: tus datos están en tu dispositivo, así que no se pierden
        por no poder entrar.`,
    tags: ['contrasena', 'password', 'olvidado', 'recuperar', 'acceso', 'entrar', 'login'],
  },

  {
    id: 'contacto',
    q: '¿Cómo contacto con vosotros?',
    // Verificado: el formulario de feedback (src/utils/feedback.js) y el
    // correo MyFinova1@gmail.com, que es el que aparece en toda la app.
    a: `Lo más rápido es el botón <strong>«Enviar feedback»</strong> del menú
        lateral o de Ajustes: puedes contarnos un fallo, pedir una función o
        preguntar lo que sea, y si dejas tu correo te respondemos.
        También puedes escribirnos directamente a
        <a href="mailto:MyFinova1@gmail.com">MyFinova1@gmail.com</a>.
        Somos un proyecto pequeño, así que no hay soporte 24/7, pero leemos
        todo lo que llega.`,
    tags: ['contacto', 'soporte', 'ayuda', 'email', 'correo', 'escribir', 'feedback'],
  },
];

/** Texto plano de una respuesta, para buscar sin que estorbe el HTML. */
function fvFaqPlain(entry) {
  return String(entry.a || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita acentos para que "contrasena" encuentre "contraseña". */
function fvFaqNorm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Filtra la FAQ por texto libre. Sin consulta, devuelve todo. */
function fvFaqSearch(query) {
  const q = fvFaqNorm(query).trim();
  if (!q) return FINOVA_FAQ;
  // Todas las palabras tienen que aparecer en algún sitio de la entrada, así
  // "borrar cuenta" no devuelve también las que solo hablan de cuentas.
  const words = q.split(/\s+/).filter(Boolean);
  return FINOVA_FAQ.filter(e => {
    const hay = fvFaqNorm(e.q + ' ' + fvFaqPlain(e) + ' ' + (e.tags || []).join(' '));
    return words.every(w => hay.includes(w));
  });
}
