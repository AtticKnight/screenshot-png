import assert from 'node:assert/strict';
import { extendMatch } from '../repack.js';

let random = 20261128;
function next() {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  return random;
}
let checks = 0;
for (let offset = 0; offset < 8; offset++) {
  const allocation = Buffer.alloc(8000 + offset);
  const raw = allocation.subarray(offset);
  for (let i = 0; i < raw.length; i++) {
    const block = (i / 400) | 0;
    raw[i] = block % 3 === 0 ? (i % 7) : block % 3 === 1 ? 96 : (next() >>> 24);
  }
  const words = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const runs = new Uint16Array(raw.length);
  for (let i = raw.length - 1; i >= 0; i--) {
    runs[i] = raw[i] === raw[i + 1] ? Math.min(258, runs[i + 1] + 1) : 1;
  }
  for (let trial = 0; trial < 24000; trial++) {
    const at = 1 + next() % (raw.length - 1);
    const dist = 1 + next() % Math.min(900, at);
    const max = Math.min(raw.length - at, next() % 259);
    let reference = 0;
    while (reference < max && raw[at + reference] === raw[at - dist + reference]) reference++;
    const known = next() % (reference + 1);
    assert.equal(extendMatch(raw, words, runs, at, dist, known, max), reference);
    checks++;
  }
}
console.log('Byte-oracle match length comparisons', checks);
