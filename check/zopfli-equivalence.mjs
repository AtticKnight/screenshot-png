import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import oldFactory from '/tmp/screenshot-zopfli-baseline.cjs';
import { compressWithZopfli } from '../zopfli.js';

const baseline = await oldFactory();
function original(raw) {
  const p = baseline._malloc(raw.length || 1);
  try {
    baseline.HEAPU8.set(raw,p);
    const n = baseline._compress_zlib(p,raw.length,2);
    const q = baseline._result_pointer();
    return Buffer.from(baseline.HEAPU8.subarray(q,q+n));
  } finally { baseline._free(p); }
}
let state = 39102;
const next = () => (state = (Math.imul(state,1664525)+1013904223) >>> 0);
for (let test=0; test<52; test++) {
  const raw = Buffer.alloc(1 + next()%24575);
  const period = 3 + next()%700;
  for (let i=0; i<raw.length; i++) {
    const r = next();
    raw[i] = i >= period && ((r>>>16)%100) < (88+test%12) ? raw[i-period] : (r>>>24);
  }
  const current = compressWithZopfli(raw);
  assert.deepEqual(inflateSync(current),raw);
  assert.deepEqual(current,original(raw),'two-pass output on case '+test);
}
console.log('Matched the released scalar two-pass streams on all 52 independent cases.');
