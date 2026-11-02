#!/usr/bin/env node
'use strict';

/**
 * Finova — check-secrets.cjs
 *
 * Guardia de pre-commit. Revisa SOLO lo que está en el área de preparación y
 * bloquea el commit si encuentra un secreto.
 *
 * ── Regla absoluta: NUNCA imprime el valor ──
 * Solo ruta, número de línea y tipo. El escáner anterior (en shell) hacía
 * `echo "$MATCHES" | head -3`, es decir, escribía la clave encontrada en la
 * terminal — y de ahí al scrollback, a una captura o a un log de CI. Un
 * detector de secretos que imprime el secreto es un detector que los
 * filtra.
 *
 * ── Tres fallos del escáner anterior que esto corrige ──
 *
 * 1. Imprimía el valor (lo de arriba).
 *
 * 2. Usaba `--diff-filter=A`, que solo mira ficheros NUEVOS. Un secreto
 *    pegado en un fichero que ya existía no se escaneaba: el caso más
 *    probable en la práctica, porque las claves se añaden a un .env o a un
 *    server.cjs que ya está ahí. Aquí se usa ACM (añadido, copiado,
 *    modificado).
 *
 * 3. No exigía longitud mínima, así que `sk-ant-api` bastaba para bloquear.
 *    Durante el desarrollo de esta misma auditoría bloqueó dos commits por
 *    los EJEMPLOS escritos en un comentario. Eso no es un detalle estético:
 *    un detector que grita con los ejemplos se desactiva con --no-verify, y
 *    desde ese momento no detecta nada. Aquí cada patrón tiene longitud
 *    mínima y hay una lista de formas de ejemplo que se descartan.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (_) {
    return '';
  }
};

/* ─── 1. Ficheros prohibidos por NOMBRE ────────────────────────── */

/*
 * Se bloquean aunque NO estén en .gitignore. Las dos defensas son distintas:
 * .gitignore evita que un fichero entre por descuido; esto evita que entre a
 * propósito con `git add -f`, que es como entran de verdad los secretos.
 */
const NOMBRES_PROHIBIDOS = [
  { re: /(^|\/)firebase-service-account\.json$/i, que: 'cuenta de servicio de Firebase' },
  { re: /service[-_]?account/i,                   que: 'cuenta de servicio' },
  { re: /firebase[-_]?adminsdk/i,                 que: 'credencial de Firebase Admin' },
  { re: /(^|\/)google-credentials/i,              que: 'credencial de Google' },
  { re: /(^|\/)gcloud-/i,                         que: 'credencial de gcloud' },
  { re: /\.(pem|key|p12|pfx|cert|crt|keystore|jks)$/i, que: 'clave o certificado' },
  { re: /(^|\/)id_rsa($|\.)/i,                    que: 'clave SSH' },
  { re: /\.(sqlite3?|db|dump|sql)$/i,             que: 'base de datos o volcado' },
  { re: /\.(enc|tar\.gz|tgz)$/i,                  que: 'archivo cifrado o comprimido' },
  { re: /(^|\/)backups?\//i,                      que: 'copia de seguridad' },
  { re: /(^|\/)data\//i,                          que: 'datos de usuario' },
];

/*
 * Los únicos .env que pueden estar versionados. Todo lo demás que empiece
 * por .env se bloquea.
 *
 * Los cuatro permitidos solo contienen variables VITE_*, que acaban en el
 * bundle del navegador de todas formas: la configuración cliente de Firebase
 * y el DSN de Sentry son públicos por diseño (ver SECURITY.md). Aun así, el
 * contenido de estos ficheros SÍ se escanea igual que el de cualquier otro:
 * estar permitido por nombre no exime de la revisión de patrones.
 */
const ENV_PERMITIDOS = new Set([
  '.env.example', '.env.server.example', '.env.development', '.env.production',
]);

/* ─── 2. Patrones de contenido ─────────────────────────────────── */

/*
 * Los prefijos se montan por concatenación para que este fichero no contenga
 * la cadena literal: si no, el propio escáner se detectaría a sí mismo y
 * bloquearía el commit que lo añade. Ya pasó una vez en este proyecto.
 */
const PATRONES = [
  { que: 'clave de Anthropic', re: new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{24,}', 'g') },
  { que: 'clave de OpenAI',    re: new RegExp('sk-' + 'proj-[A-Za-z0-9_-]{24,}', 'g') },
  { que: 'clave de OpenAI',    re: new RegExp('sk-' + '[A-Za-z0-9]{32,}', 'g') },
  { que: 'clave de Groq',      re: new RegExp('g' + 'sk_[A-Za-z0-9]{24,}', 'g') },
  { que: 'token de GitHub',    re: new RegExp('g' + 'hp_[A-Za-z0-9]{30,}', 'g') },
  { que: 'token de GitHub',    re: new RegExp('g' + 'ithub_pat_[A-Za-z0-9_]{30,}', 'g') },
  { que: 'clave de AWS',       re: new RegExp('A' + 'KIA[0-9A-Z]{16}', 'g') },
  { que: 'clave de Stripe',    re: new RegExp('s' + 'k_live_[A-Za-z0-9]{20,}', 'g') },
  // La clave privada NO se busca aquí: necesita mirar el fichero completo y
  // exigir cuerpo. Ver _buscarClavePrivada más abajo.
  { que: 'webhook de Slack o Discord', re: /hooks\.(?:slack|discord)\.com\/[A-Za-z0-9/_-]{24,}/g },
  // Clave de cifrado simétrico: 64 hex asignados a una variable de cifrado.
  { que: 'clave de cifrado (64 hex)', re: /\b(?:ENC(?:RYPTION)?_KEY|FINOVA_ENC_KEY|MASTER_KEY|SECRET_KEY)\s*[:=]\s*["'`]?([0-9a-fA-F]{64})\b/g },
  // Cualquier variable de nombre sensible con un valor literal largo.
  {
    que: 'secreto asignado a una variable',
    re: /\b[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|WEBHOOK)[A-Z0-9_]*\s*[:=]\s*["'`]([A-Za-z0-9_/+=.-]{24,})["'`]/g,
    grupo: 1,
  },
];

/*
 * La clave CLIENTE de Firebase (prefijo A-I-z-a) NO está en la lista a
 * propósito. Es pública por diseño: va en el bundle de cualquier app web, y
 * la seguridad la dan las reglas de Firebase y los dominios autorizados, no
 * su secreto. Está en .env.development, .env.production y landing.js desde
 * el primer commit. Incluirla haría que CADA commit que toque esos ficheros
 * se bloqueara, y la guardia duraría una semana.
 */

/**
 * Clave privada PEM. Se busca aparte del resto por dos motivos.
 *
 * 1. Hay que exigir CUERPO, no solo la cabecera. Un `-----BEGIN PRIVATE
 *    KEY-----` suelto, sin base64 detrás, es exactamente lo que lleva una
 *    plantilla `.env.*.example` — y bloquear por eso es un falso positivo
 *    sobre un fichero que SÍ debe estar versionado. Pasó de verdad: esta
 *    guardia bloqueó el commit que añadía DEPLOY.md por la plantilla de
 *    `.env.server.example`, que no contiene ninguna clave.
 *
 * 2. Hay que mirar el fichero COMPLETO, no línea a línea. Un PEM aparece de
 *    dos formas, y las dos son reales:
 *      · En un .env o un .json de cuenta de servicio, en UNA línea con los
 *        saltos escapados como «\n» literales.
 *      · En un fichero suelto, repartido en varias líneas de verdad.
 *    Un escaneo por líneas solo ve la cabecera en el segundo caso.
 *
 * Devuelve el número de línea de la cabecera, o 0 si no hay clave.
 */
function _buscarClavePrivada(contenido) {
  const re = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
  let m;
  while ((m = re.exec(contenido))) {
    // A partir de la cabecera, ¿hay una tirada de base64 larga cerca? Un
    // cuerpo de clave real empieza en la línea siguiente; 120 caracteres de
    // margen cubren los saltos escapados, las comillas y algún espacio.
    const trozo = contenido.slice(m.index + m[0].length, m.index + m[0].length + 200);
    // Se admite \n literal (dos caracteres) o salto real entre medias.
    if (/[A-Za-z0-9+/=]{40,}/.test(trozo.slice(0, 120))) {
      return contenido.slice(0, m.index).split('\n').length;
    }
  }
  return 0;
}

/** ¿Este valor es obviamente un ejemplo y no una clave? */
function esEjemplo(valor, linea) {
  const l = String(linea);
  if (/\.\.\./.test(valor)) return true;
  if (/[<>]/.test(valor)) return true;
  if (/x{4,}/i.test(valor)) return true;
  // Pocos caracteres distintos: nadie genera una clave así.
  if (new Set(valor).size <= 5) return true;
  if (/tu[_-]?clave|your[_-]?key|placeholder|aqui|here|ejemplo|example|sample|COMPLETAR|TODO|FIXME|dummy|fake|REPLACE|CHANGE_?ME/i.test(l)) return true;
  // Línea comentada en los formatos que usa el proyecto.
  if (/^\s*(?:\/\/|\*|#|REM\b|::|<!--)/i.test(l)) return true;
  return false;
}

/* ─── 3. Recorrido de lo que está en staging ───────────────────── */

const enStaging = git('diff', '--cached', '--name-only', '--diff-filter=ACM')
  .split('\n').map(s => s.trim()).filter(Boolean);

if (!enStaging.length) {
  console.log('[check-secrets] No hay nada en el área de preparación.');
  process.exit(0);
}

const hallazgos = [];
const EXT_BINARIA = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp4|mp3|pdf|zip|gz|7z|exe|dll)$/i;

for (const fichero of enStaging) {
  const base = fichero.split('/').pop();

  /* Por nombre */
  for (const { re, que } of NOMBRES_PROHIBIDOS) {
    if (re.test(fichero)) {
      hallazgos.push({ fichero, linea: null, que: `fichero prohibido: ${que}` });
      break;
    }
  }
  if (/^\.env/.test(base) && !ENV_PERMITIDOS.has(fichero) && !ENV_PERMITIDOS.has(base)) {
    hallazgos.push({ fichero, linea: null, que: 'fichero .env no permitido en el repositorio' });
  }

  /* Por contenido */
  if (EXT_BINARIA.test(fichero)) continue;
  // Se lee la versión EN STAGING, no la del disco: si el fichero se editó
  // después de `git add`, lo que se va a commitear es la de staging.
  const contenido = git('show', `:${fichero}`);
  if (!contenido) continue;
  if (contenido.length > 8 * 1024 * 1024) continue;
  if (contenido.includes('\0')) continue;   // binario sin extensión conocida

  const lineaPem = _buscarClavePrivada(contenido);
  if (lineaPem) hallazgos.push({ fichero, linea: lineaPem, que: 'clave privada (PEM con cuerpo)' });

  const lineas = contenido.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea.length > 4000) continue;      // línea minificada: ruido
    for (const p of PATRONES) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(linea))) {
        const valor = p.grupo ? m[p.grupo] : m[0];
        if (!valor) continue;
        if (esEjemplo(valor, linea)) continue;
        hallazgos.push({ fichero, linea: i + 1, que: p.que });
      }
    }
  }
}

/* ─── 4. Informe ───────────────────────────────────────────────── */

if (!hallazgos.length) {
  console.log(`[check-secrets] ${enStaging.length} fichero(s) revisado(s). Sin secretos detectados.`);
  process.exit(0);
}

// Deduplicar: el mismo tipo en la misma línea solo se dice una vez.
const unicos = [...new Map(hallazgos.map(h => [`${h.fichero}|${h.linea}|${h.que}`, h])).values()];

console.error('');
console.error('[check-secrets] COMMIT BLOQUEADO — posible secreto en el área de preparación:');
console.error('');
for (const h of unicos) {
  console.error(`  · ${h.fichero}${h.linea ? `:${h.linea}` : ''} — ${h.que}`);
}
console.error('');
console.error('  (el valor NO se muestra a propósito: míralo tú en esa línea)');
console.error('');
console.error('  Si es un falso positivo:');
console.error('    1. Mejor: cambia el ejemplo para que se reconozca como tal');
console.error('       (añade «...», «<>» o la palabra «ejemplo» en la línea).');
console.error('    2. Si no: git commit --no-verify  — y di en el mensaje por qué.');
console.error('');
console.error('  Si es un secreto DE VERDAD y ya lo habías commiteado antes,');
console.error('  rotarlo es obligatorio: ver ROTATE_SECRETS.md.');
console.error('');
process.exit(1);
