/**
 * Finova — generador de iconos
 *
 * Fuente de verdad: branding/svg/*.svg -> PNG en la raiz Y en branding/icons/
 * (antes dos scripts generaban cada carpeta por separado y se desincronizaban;
 * ahora una sola pasada mantiene las dos identicas).
 *
 * Decisiones de calidad, todas medidas:
 *
 *  · SUPERSAMPLING — el SVG se rasteriza a 4x el tamano final y se reduce con
 *    lanczos3. Rasterizar directo al tamano final deja bordes con aliasing;
 *    renderizar grande y reducir promedia subpixeles y da bordes limpios.
 *
 *  · VARIANTE POR TAMANO — <=48px usa logo-small.svg (F centrada y mas grande,
 *    sin chip ni filete: ese detalle a 16-32px es ruido ilegible). >=64px usa
 *    el maestro completo.
 *
 *  · GRANO SOLO EN GRANDES — el degradado radial del fondo produce bandas
 *    concentricas visibles en 8 bits. Un grano monocromo las difumina, pero el
 *    ruido es incompresible: a 1024px multiplica el PNG por 5 (42 KB -> 226 KB).
 *    Medido y comparado con contraste amplificado x6: a 512px las bandas ya
 *    son imperceptibles a tamano real, asi que el grano se reserva para 1024px
 *    (que ademas no va en el precache del SW, solo en el manifest).
 *
 *  · SHARPEN suave en 64-256px — tras reducir mucho la imagen queda algo
 *    blanda; un sharpen ligero la devuelve nitida sin halos. En 512/1024 no
 *    hace falta y en <=48px generaria artefactos.
 *
 * Anadir un tamano nuevo = una linea en SIZES.
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const MASTER_TPL = readFileSync('./branding/svg/logo.svg', 'utf8');
const SMALL      = readFileSync('./branding/svg/logo-small.svg');

const SMALL_MAX    = 48;    // <= usa la variante simplificada
const GRAIN_MIN    = 1024;  // >= recibe grano anti-banding
const GRAIN_AMOUNT = 0.02;
const SUPERSAMPLE  = 4;
const MAX_RENDER   = 4096;  // techo de memoria

const SIZES    = [16, 32, 48, 64, 120, 128, 152, 167, 180, 192, 256, 512, 1024];
const OUT_DIRS = ['.', './branding/icons'];

/** El maestro lleva un marcador {{GRAIN}}; nunca debe quedar sin sustituir. */
function master(grain) {
  const svg = MASTER_TPL.replace('{{GRAIN}}', String(grain));
  if (svg.includes('{{GRAIN}}')) throw new Error('quedo un marcador {{GRAIN}} sin sustituir');
  return Buffer.from(svg);
}

async function renderIcon(size) {
  const src     = size <= SMALL_MAX ? SMALL : master(size >= GRAIN_MIN ? GRAIN_AMOUNT : 0);
  const render  = Math.min(size * SUPERSAMPLE, MAX_RENDER);
  const density = Math.max(72, Math.ceil(72 * render / 1024));

  let img = sharp(src, { density }).resize(size, size, { kernel: 'lanczos3' });
  if (size >= 64 && size <= 256) img = img.sharpen({ sigma: 0.6 });

  return img.png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
}

async function generate() {
  for (const dir of OUT_DIRS) mkdirSync(dir, { recursive: true });

  let total = 0;
  for (const size of SIZES) {
    const buf = await renderIcon(size);
    total += buf.length;
    for (const dir of OUT_DIRS) writeFileSync(`${dir}/icon-${size}.png`, buf);
    const tag = size <= SMALL_MAX ? 'small' : (size >= GRAIN_MIN ? 'master+grano' : 'master');
    console.log(`icon-${size}.png`.padEnd(17) + String(size).padStart(5) + 'px  ' +
                tag.padEnd(13) + (buf.length / 1024).toFixed(1).padStart(7) + ' KB');
  }

  // icon.svg se sirve TAL CUAL al navegador (favicon y logos de la UI a 34-68px):
  // sin grano, y sobre todo sin el marcador sin resolver.
  writeFileSync('./icon.svg', master(0));

  console.log(`\nicon.svg sincronizado (grano 0, se usa en tamanos pequenos)`);
  console.log(`${SIZES.length} tamanos x ${OUT_DIRS.length} carpetas — total ${(total / 1024).toFixed(0)} KB`);
}

generate().catch(err => { console.error('Error:', err.message); process.exit(1); });
