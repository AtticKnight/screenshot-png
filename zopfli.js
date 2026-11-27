import createZopfli from './vendor/zopfli.cjs';
const engine = await createZopfli();

export function compressWithZopfli(input) {
  const start = engine._malloc(input.length || 1);
  if (!start) return undefined;
  try {
    engine.HEAPU8.set(input, start);
    const size = engine._compress_zlib(start,input.length,2);
    if (!size) return undefined;
    const result = engine._result_pointer();
    return Buffer.from(engine.HEAPU8.subarray(result,result+size));
  } finally {
    engine._free(start);
  }
}
