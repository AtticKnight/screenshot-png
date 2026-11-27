import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodeScreenshot } from '../encoder.js';
import { decodePng } from './kit/program/scorer/checker/png.mjs';
import { points } from './kit/program/scorer/checker/check.mjs';
const root = 'check/kit/practice', source = join(root,'input');
const cases = JSON.parse(readFileSync(join(root,'reference/manifest.json'),'utf8')).instances;
let total = 0, bytes = 0;
const start = performance.now();
for (const name of readdirSync(source).sort()) {
  const raw = readFileSync(join(source,name,'image.png'));
  const when = performance.now(), encoded = encodeScreenshot(raw);
  const a = decodePng(raw), b = decodePng(encoded);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(Buffer.from(a.rgba),Buffer.from(b.rgba));
  const score = points({'image.png':raw},cases.find(x=>x.id===name).key,{'image.png':encoded}).points;
  console.log('Zopfli case',name,'seconds',((performance.now()-when)/1000).toFixed(2),'bytes',encoded.length,'points',score.toFixed(2));
  total += score; bytes += encoded.length;
}
console.log('Zopfli total score',Math.round(total*1000/cases.length),'bytes',bytes,'seconds',((performance.now()-start)/1000).toFixed(2));
