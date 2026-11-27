import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { decodePng } from './kit/program/scorer/checker/png.mjs';
import { points } from './kit/program/scorer/checker/check.mjs';

const kit = resolve('check/kit');
const input = join(kit, 'practice/input');
const names = readdirSync(input).sort();
assert.equal(names.length, 8);
const manifest = JSON.parse(readFileSync(join(kit, 'practice/reference/manifest.json'), 'utf8'));
console.log('Reference manifest preview', JSON.stringify(manifest).slice(0, 730));

function execute(entry, dest) {
  const output = resolve('check', dest);
  mkdirSync(output, { recursive: true });
  const started = performance.now();
  execFileSync(process.execPath, [entry], {
    env: { ...process.env, MAKEFUN_INPUT_DIR: input, MAKEFUN_OUTPUT_DIR: output },
    stdio: 'inherit',
    timeout: 60_000,
  });
  console.log(dest, 'seconds', ((performance.now() - started) / 1000).toFixed(3));
  return output;
}

const outputs = [execute('main.ts','first'), execute('main.ts','second')];
const house = execute(join(kit,'baselines/fixed-paeth/main.ts'), 'house');
let bytes = 0, houseBytes = 0, sum = 0, houseSum = 0, scores = 0;
for (const name of names) {
  const png = readFileSync(join(input,name,'image.png'));
  const read = (directory) => readFileSync(join(directory,name,'image.png'));
  const actual = read(outputs[0]), baseline = read(house);
  assert.deepEqual(actual,read(outputs[1]),name + ' deterministic bytes');
  const decoded = decodePng(actual), original = decodePng(png);
  assert.ok(decoded.ok, decoded.why);
  assert.ok(original.ok, original.why);
  assert.equal(decoded.width,original.width);
  assert.equal(decoded.height,original.height);
  assert.deepEqual(Buffer.from(decoded.rgba),Buffer.from(original.rgba),name + ' pixel equality');
  const row = Array.isArray(manifest) ? manifest.find(x=>x.id===name) : (Array.isArray(manifest.instances) ? manifest.instances.find(x=>x.id===name) : manifest[name]);
  const key = row?.key ?? row;
  let detail = '';
  if (key?.floor_bytes) {
    const score = value => points({'image.png':png},key,{'image.png':value}).points;
    const ours = score(actual), theirs = score(baseline);
    sum += ours; houseSum += theirs; scores++;
    detail = ' points ' + ours.toFixed(2) + ' house ' + theirs.toFixed(2);
  }
  bytes += actual.length;
  houseBytes += baseline.length;
  console.log('Checked',name,'bytes',actual.length,'house',baseline.length,detail);
}
console.log('Total bytes',bytes,'house',houseBytes);
if (scores === names.length) console.log('Practice score',Math.round(1000*sum/scores),'house',Math.round(1000*houseSum/scores));
