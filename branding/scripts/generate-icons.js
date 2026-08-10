import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const svgBuffer = readFileSync(resolve(ROOT, 'svg/logo.svg'));

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
  mkdir(resolve(ROOT, 'icons'));

  // High-res PNGs
  for (const size of [4096, 2048, 1024]) {
    const out = resolve(ROOT, `png/logo-${size}.png`);
    await render(size, out);
    console.log(`✓ png/logo-${size}.png`);
  }

  // App icons
  for (const size of [16, 32, 48, 64, 120, 128, 152, 167, 180, 192, 256, 512, 1024]) {
    const out = resolve(ROOT, `icons/icon-${size}.png`);
    await render(size, out);
    console.log(`✓ icons/icon-${size}.png`);
  }

  console.log('\n✅ Todos los iconos generados correctamente.');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
