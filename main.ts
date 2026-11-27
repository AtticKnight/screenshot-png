import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeScreenshot } from './encoder.js';

const input = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const name of readdirSync(input, { withFileTypes: true }).filter(p => p.isDirectory()).map(p => p.name).sort()) {
  const original = readFileSync(join(input, name, 'image.png'));
  const compressed = encodeScreenshot(original);
  mkdirSync(join(output, name), { recursive: true });
  writeFileSync(join(output, name, 'image.png'), compressed);
}
