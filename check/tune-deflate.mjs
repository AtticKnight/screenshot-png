import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const profiles = {
  "wide": [
    800,
    5,
    2
  ],
  "early": [
    300,
    5,
    6
  ],
  "short": [
    180,
    4,
    6
  ],
  "deep": [
    900,
    10,
    8
  ]
};
const choice = profiles[process.argv[2]];
assert.ok(choice, 'Choose a named, reproducible search configuration.');
const [depth, passes, threshold] = choice;
const path = 'vendor/libdeflate.js';
const source = readFileSync(path, 'utf8');
const gitHash = createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex');
assert.equal(gitHash, 'd535ae0cb818dcfd429e24f34e567864a2fd79e9');
// These five fields initialize level 12 in upstream lib/deflate_compress.c.
// Keep the full 258-byte nice-match length and static-block limit.
const original = "     HEAP32[$1_1 + 16 >> 2] = 300;\n     HEAP32[$1_1 + 20 >> 2] = 258;\n     HEAP32[$1_1 >> 2] = 6;\n     $0_1 = $1_1 + 9011692 | 0;\n     HEAP32[$0_1 >> 2] = 1;\n     HEAP32[$0_1 + 4 >> 2] = 1e4;\n     $0_1 = $1_1 + 9011684 | 0;\n     HEAP32[$0_1 >> 2] = 10;\n     HEAP32[$0_1 + 4 >> 2] = 1;";
const tuned = original.replace('= 300;', '= ' + depth + ';')
  .replace('= 10;', '= ' + passes + ';')
  .replaceAll('= 1;', '= ' + threshold + ';');
assert.equal(source.split(original).length, 2);
writeFileSync(path, source.replace(original, () => tuned));
console.log('Initial parse dimensions', { depth, passes, threshold });
