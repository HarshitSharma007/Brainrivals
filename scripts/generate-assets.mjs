import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const artwork = readFileSync(resolve(root, 'public/icon.svg'));
const image = new Resvg(artwork, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108"><rect width="108" height="108" fill="#151626"/><image x="18" y="18" width="72" height="72" href="data:image/png;base64,${image.toString('base64')}"/></svg>`;
const outputs = [
  ['public/icon-192.png', 192, artwork],
  ['public/icon-512.png', 512, artwork],
  ['public/icon-maskable-512.png', 512, adaptive],
];

if (existsSync(resolve(root, 'android/app/src/main/res'))) {
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const directory = `android/app/src/main/res/mipmap-${density}`;
    outputs.push([`${directory}/ic_launcher.png`, 48 * scale, artwork]);
    outputs.push([`${directory}/ic_launcher_round.png`, 48 * scale, artwork]);
    outputs.push([`${directory}/ic_launcher_foreground.png`, 108 * scale, adaptive]);
  }
}

for (const [relative, size, source] of outputs) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Invalid icon dimensions: ${relative}`);
  const path = resolve(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}
console.log(`Generated and checked ${outputs.length} branded PNG icons.`);