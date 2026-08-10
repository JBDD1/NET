import sharp from 'sharp';
import { readFileSync } from 'fs';

// Master SVG from branding directory
const svgRaw = readFileSync('./branding/svg/logo.svg', 'utf8');
const SOURCE = Buffer.from(svgRaw);

const sizes = [
  { size: 16,   name: 'icon-16.png' },
  { size: 32,   name: 'icon-32.png' },
  { size: 48,   name: 'icon-48.png' },
  { size: 64,   name: 'icon-64.png' },
  { size: 120,  name: 'icon-120.png' },
  { size: 128,  name: 'icon-128.png' },
  { size: 152,  name: 'icon-152.png' },
  { size: 167,  name: 'icon-167.png' },
  { size: 180,  name: 'icon-180.png' },
  { size: 192,  name: 'icon-192.png' },
  { size: 256,  name: 'icon-256.png' },
  { size: 512,  name: 'icon-512.png' },
  { size: 1024, name: 'icon-1024.png' },
];

async function generate() {
  for (const { size, name } of sizes) {
    const density = size > 1024 ? Math.ceil(72 * size / 1024) : 96;
    await sharp(SOURCE, { density })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(`./${name}`);
    console.log(`${name} (${size}x${size})`);
  }
  console.log('\nTodos los iconos generados correctamente.');
}

generate().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
