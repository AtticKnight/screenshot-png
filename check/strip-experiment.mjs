import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { decodePng } from './kit/program/scorer/checker/png.mjs';
import { points } from './kit/program/scorer/checker/check.mjs';
import { encodeScreenshot } from '../strip-probe.mjs';

for (const dir of process.argv.slice(2)) {
  const data = resolve(dir), input = join(data, 'input');
  const manifest = JSON.parse(readFileSync(join(data, 'reference/manifest.json'), 'utf8'));
  const names = readdirSync(input).sort();
  assert.equal(names.length, 8);
  let totalSize=0, totalPoints=0;
  const start=performance.now();
  for (const name of names) {
    const file=readFileSync(join(input, name, 'image.png'));
    const info={variants:{}};
    const out=encodeScreenshot(file, info);
    const original=decodePng(file), result=decodePng(out);
    assert.ok(result.ok && original.ok);
    assert.equal(result.width, original.width);
    assert.equal(result.height, original.height);
    assert.deepEqual(Buffer.from(result.rgba), Buffer.from(original.rgba));
    const key=manifest.instances.find(r=>r.id===name).key;
    const score=points({'image.png':file},key,{'image.png':out}).points;
    totalSize+=out.length;totalPoints+=score;
    console.log('Strip comparison',dir,name,'bytes',out.length,'score',score.toFixed(2),JSON.stringify(info));
  }
  console.log('Strip total',dir,totalSize,Math.round(1000*totalPoints/names.length),'seconds',((performance.now()-start)/1000).toFixed(2));
}
