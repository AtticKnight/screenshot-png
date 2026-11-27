import assert from 'node:assert/strict';
import { constants, deflateSync, inflateSync } from 'node:zlib';
import { repack } from '../repack.js';

let seed = 91823;
function nextByte() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 24;
}

const samples = [Buffer.alloc(0), Buffer.from([90]), Buffer.alloc(40000), Buffer.from('abracadabra_'.repeat(3000))];
for (const size of [3, 17, 256, 513, 8192, 32769, 131100, 210000]) {
  const noise = Buffer.allocUnsafe(size);
  const repeated = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) {
    noise[i] = nextByte();
    repeated[i] = i > 50 && nextByte() % 8 ? repeated[i - 1 - nextByte() % 49] : nextByte();
  }
  samples.push(noise, repeated);
}

const encodings = [
  { level: 0 },
  { level: 1 },
  { level: 9 },
  { level: 9, strategy: constants.Z_FIXED },
  { level: 1, strategy: constants.Z_HUFFMAN_ONLY },
];
let checked = 0;
for (const raw of samples) {
  for (const options of encodings) {
    const packed = deflateSync(raw, options);
    const result = repack(raw, packed);
    assert.ok(result.length <= packed.length);
    assert.deepEqual(inflateSync(result), raw);
    checked++;
  }
}
console.log('DEFLATE round trips across stored, fixed and dynamic blocks', checked);
