import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import * as previous from '../vendor/libdeflate-unchanged.js';
import * as current from '../vendor/libdeflate.js';

function encoder(mod) {
  assert.ok(mod.prepare(12));
  const heap = Buffer.from(mod.memory.buffer);
  return bytes => {
    heap.set(bytes,mod.input_pointer());
    const size = mod.compress_image(bytes.length);
    assert.ok(size>0);
    return Buffer.from(heap.subarray(mod.output_pointer(),mod.output_pointer()+size));
  };
}
const first=encoder(previous), second=encoder(current);
let random=501272311;
function next(){random=(Math.imul(random,1664525)+1013904223)>>>0;return random;}
let cases=0, total=0;
for (const length of [0,1,2,3,4,31,256,4096,32768,190001,960703,4*1024*1024]) {
  for (const type of ['runs','mixed','wide']) {
    const bytes=Buffer.alloc(length);
    for(let i=0;i<bytes.length;i++){
      const sample=next()>>>24;
      bytes[i]=type==='runs' ? (i>>>5)%41 : type==='mixed' && (i&4095)>20 ? ((i>>>3)^(i>>>11))&255 : sample;
    }
    const expected=first(bytes), answer=second(bytes);
    assert.deepEqual(answer,expected);
    assert.deepEqual(inflateSync(answer),bytes);
    cases++; total+=length;
  }
}
console.log('Exact matching compressed output and decode',cases,'cases',total,'source bytes');
