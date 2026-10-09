import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// El maestro lleva un marcador {{GRAIN}} (grano anti-banding). Estas
// exportaciones son masters de diseno: no se sirven a usuarios y lo normal
// es reescalarlas hacia abajo, donde el grano no aporta. Ademas el ruido es
// incompresible y a 4096px disparaba el PNG a 3 MB. Se exportan limpias.
const GRAIN = 0;
const svgText = readFileSync(resolve(ROOT, 'svg/logo.svg'), 'utf8').replace('{{GRAIN}}', String(GRAIN));
if (svgText.includes('{{GRAIN}}')) throw new Error('quedo un marcador {{GRAIN}} sin sustituir');
const svgBuffer = Buffer.from(svgText);

function mkdir(dir) {
  mkdirSync(dir, { recursive: true });
}

async function render(size, outPath) {
  // For sizes larger than 1024, increase density to render the SVG at native resolution
  const density = size > 1024 ? Math.ceil(72 * size / 1024) : 96;
  await sharp(svgBuffer, { density })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function main() {
  mkdir(resolve(ROOT, 'png'));

  // High-res PNGs
  for (const size of [4096, 2048, 1024]) {
    const out = resolve(ROOT, `png/logo-${size}.png`);
    await render(size, out);
    console.log(`✓ png/logo-${size}.png`);
  }

  // Los iconos de app (16-1024) los genera scripts/generate-icons.js, que
  // usa la variante pequena para <=48px y supersampling. Duplicarlos aqui
  // con otro metodo los dejaria peores y desincronizados.

  console.log('\n✅ Exportaciones de logo en alta resolucion generadas.');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
